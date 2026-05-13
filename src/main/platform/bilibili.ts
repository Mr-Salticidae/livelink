import { startListen, type MessageListener, type MsgHandler, type User } from 'blive-message-listener'
import type {
  AdapterStatusEvent,
  BilibiliConnectOptions,
  EventListener,
  PlatformAdapter,
  StandardEvent,
  StatusListener,
  UserInfo
} from './adapter'
import { AdapterAlreadyConnectedError, RoomApiError, RoomNotFoundError } from './errors'

interface RoomInfoResponse {
  code: number
  message?: string
  msg?: string
  data?: {
    room_id: number
    short_id: number
    uid: number
    live_status: number // 0 未开播 1 直播中 2 轮播
  }
}

const ROOM_INFO_API = 'https://api.live.bilibili.com/room/v1/Room/get_info'

// 接受房间号或链接，抠出数字。允许短号。
export function parseRoomInput(input: string | number): number {
  if (typeof input === 'number') return input
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  // 从链接中抠出第一段数字（B 站直播间链接形如 live.bilibili.com/21452505[?...]）
  const match = trimmed.match(/(\d{3,})/)
  if (!match) throw new RoomNotFoundError(input)
  return Number(match[1])
}

// 解析房间号 → 真实房间号 + 直播状态。短号在响应里会被还原
export async function resolveRoomId(input: string | number): Promise<{ roomId: number; isLive: boolean }> {
  const candidate = parseRoomInput(input)
  let resp: Response
  try {
    resp = await fetch(`${ROOM_INFO_API}?room_id=${candidate}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 LiveLink/0.1.0' }
    })
  } catch (err) {
    throw new RoomApiError('调用 B 站房间 API 失败（网络问题？）', err)
  }
  if (!resp.ok) {
    throw new RoomApiError(`B 站房间 API HTTP ${resp.status}`)
  }
  const json = (await resp.json()) as RoomInfoResponse
  if (json.code !== 0 || !json.data) {
    throw new RoomNotFoundError(candidate, json.message ?? json.msg)
  }
  return { roomId: json.data.room_id, isLive: json.data.live_status === 1 }
}

function toUserInfo(u: User, currentRoomId: number | null): UserInfo {
  const badge = u.badge
  // is_same_room 由 lib 自己算好（badge.anchor.is_same_room 可能 undefined 在老版本里），
  // 兜底比对 anchor.room_id === currentRoomId
  const isAnchor =
    badge?.anchor?.is_same_room ??
    (currentRoomId != null && badge?.anchor?.room_id === currentRoomId) ??
    false
  return {
    uid: String(u.uid),
    uname: u.uname,
    avatar: u.face,
    isAdmin: u.identity?.room_admin ?? false,
    guardLevel: u.identity?.guard_level ?? 0,
    fansMedal: badge
      ? {
          level: badge.level ?? 0,
          name: badge.name ?? '',
          isAnchor: Boolean(isAnchor),
          isLighted: badge.active ?? false
        }
      : undefined
  }
}

// cmd 直方图节流间隔。诊断辅助：每 30s 把收到的 cmd 频次打到主进程 console，
// 跳蛛先生填了 SESSDATA 还是收不到弹幕时用来排查 B 站到底推了哪些 cmd
const CMD_HISTOGRAM_FLUSH_MS = 30_000

export class BilibiliAdapter implements PlatformAdapter {
  readonly platform = 'bilibili' as const
  private listener: MessageListener | null = null
  private listeners = new Set<EventListener>()
  private statusListeners = new Set<StatusListener>()
  private connectedRoomId: number | null = null
  // disconnect() 调 listener.close() 前置 true，让 onClose 知道这次是用户主动停
  private expectClose = false
  // 诊断：收到的 cmd 频次（30s flush 一次）
  private cmdHistogram = new Map<string, number>()
  private histogramFlushTimer: NodeJS.Timeout | null = null

  get isConnected(): boolean {
    return this.listener != null && !this.listener.closed
  }

  get currentRoomId(): number | null {
    return this.connectedRoomId
  }

  on(cb: EventListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private emit(e: StandardEvent): void {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch (err) {
        console.error('[BilibiliAdapter] listener threw', err)
      }
    }
  }

  private emitStatus(e: AdapterStatusEvent): void {
    for (const l of this.statusListeners) {
      try {
        l(e)
      } catch (err) {
        console.error('[BilibiliAdapter] status listener threw', err)
      }
    }
  }

  reconnect(): void {
    if (!this.listener) {
      this.emitStatus({ kind: 'error', message: '没有活跃连接，无法 reconnect' })
      return
    }
    try {
      this.listener.reconnect()
    } catch (err) {
      this.emitStatus({ kind: 'error', message: String((err as Error)?.message ?? err) })
    }
  }

  async connect(roomInput: string | number, options?: BilibiliConnectOptions): Promise<void> {
    if (this.listener && !this.listener.closed) {
      throw new AdapterAlreadyConnectedError()
    }

    const { roomId } = await resolveRoomId(roomInput)

    // 构造 startListen 的 ws options。底层是 KeepLiveTCP（TCP 直连），但 lib 在 init() 里
    // 会用 ws.headers 发 HTTP 预请求拿 host_list / key / buvid，登录态就是这样间接生效的。
    // 仅在填了 sessdata 时启用，避免空字段污染请求头
    const sessdata = options?.sessdata?.trim()
    const wsOptions: Record<string, unknown> | undefined = sessdata
      ? {
          headers: { Cookie: `SESSDATA=${sessdata}` },
          ...(options?.uid ? { uid: Number(options.uid) } : {}),
          ...(options?.buvid?.trim() ? { buvid: options.buvid.trim() } : {})
        }
      : undefined

    const handler: MsgHandler = {
      onOpen: () => {
        console.log(`[BilibiliAdapter] connected to room ${roomId}`)
        this.emitStatus({ kind: 'opened', roomId })
      },
      onClose: () => {
        const intended = this.expectClose
        this.expectClose = false
        console.log(`[BilibiliAdapter] connection closed for room ${roomId} (intended=${intended})`)
        this.emitStatus({ kind: 'closed', intended })
      },
      onError: (err) => {
        console.error('[BilibiliAdapter] error', err)
        this.emitStatus({ kind: 'error', message: String(err?.message ?? err) })
      },

      onIncomeDanmu: (msg) => {
        this.emit({
          kind: 'danmu.received',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: toUserInfo(msg.body.user, roomId),
          payload: { content: msg.body.content }
        })
      },

      onUserAction: (msg) => {
        // blive-message-listener 把进房 / 关注 / 分享 / 点赞合到一个 hook
        const action = msg.body.action
        if (action === 'enter') {
          this.emit({
            kind: 'viewer.enter',
            platform: 'bilibili',
            timestamp: msg.body.timestamp ?? msg.timestamp,
            user: toUserInfo(msg.body.user, roomId),
            payload: {}
          })
        } else if (action === 'follow') {
          this.emit({
            kind: 'follow.received',
            platform: 'bilibili',
            timestamp: msg.body.timestamp ?? msg.timestamp,
            user: toUserInfo(msg.body.user, roomId),
            payload: {}
          })
        }
        // share / like / unknown 不映射，留 P1+ 扩展
      },

      onGift: (msg) => {
        this.emit({
          kind: 'gift.received',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: toUserInfo(msg.body.user, roomId),
          payload: {
            giftId: msg.body.gift_id,
            giftName: msg.body.gift_name,
            num: msg.body.amount,
            price: msg.body.price / 1000, // lib 给的 price 是 *1000
            coinType: msg.body.coin_type
          }
        })
      },

      onGuardBuy: (msg) => {
        this.emit({
          kind: 'guard.bought',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: toUserInfo(msg.body.user, roomId),
          payload: {
            guardLevel: msg.body.guard_level,
            price: msg.body.price,
            giftName: msg.body.gift_name
          }
        })
      },

      onIncomeSuperChat: (msg) => {
        this.emit({
          kind: 'super.chat',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: toUserInfo(msg.body.user, roomId),
          payload: {
            message: msg.body.content,
            price: msg.body.price,
            durationSec: msg.body.time
          }
        })
      },

      // 诊断：所有原始 cmd 计入直方图。SESSDATA 填了仍收不到弹幕时，看主进程 console
      // 的 30s 直方图就能判断 B 站到底推了什么 cmd（DANMU_MSG 是否在列）
      raw: {
        msg: (m: { cmd?: string }) => {
          const cmd = m?.cmd ?? 'unknown'
          this.cmdHistogram.set(cmd, (this.cmdHistogram.get(cmd) ?? 0) + 1)
          this.scheduleHistogramFlush()
        }
      }
    }

    // startListen 第三参数类型是 MessageListenerTCPOptions { ws?: TCPOptions }
    // 我们用 Record<string, unknown> 构造 wsOptions 避开 lib 内部嵌套类型，传入时 cast
    this.listener = startListen(
      roomId,
      handler,
      wsOptions ? ({ ws: wsOptions } as Parameters<typeof startListen>[2]) : undefined
    )
    this.connectedRoomId = roomId
  }

  async disconnect(): Promise<void> {
    this.expectClose = true // 让随后 listener.close() 触发的 onClose 拿到 intended=true
    if (this.listener && !this.listener.closed) {
      this.listener.close()
    }
    this.listener = null
    this.connectedRoomId = null
    // 清掉诊断直方图状态，避免下次 connect 时把上次的统计带过来
    if (this.histogramFlushTimer) {
      clearTimeout(this.histogramFlushTimer)
      this.histogramFlushTimer = null
    }
    this.cmdHistogram.clear()
    // 不清 this.listeners / this.statusListeners：那些是主进程级别的订阅，
    // 跨 connect/disconnect 周期保持。清掉会导致再 connect 后事件 / 状态断流。
  }

  private scheduleHistogramFlush(): void {
    if (this.histogramFlushTimer) return
    this.histogramFlushTimer = setTimeout(() => {
      this.histogramFlushTimer = null
      if (this.cmdHistogram.size === 0) return
      const entries = [...this.cmdHistogram.entries()].sort((a, b) => b[1] - a[1])
      console.log(`[BilibiliAdapter] cmd histogram (last ${CMD_HISTOGRAM_FLUSH_MS / 1000}s):`)
      for (const [cmd, count] of entries) {
        console.log(`  ${cmd}: ${count}`)
      }
      this.cmdHistogram.clear()
    }, CMD_HISTOGRAM_FLUSH_MS)
  }
}
