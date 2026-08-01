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
import {
  AdapterAlreadyConnectedError,
  HandshakeFailedError,
  RoomApiError,
  RoomNotFoundError
} from './errors'
import { fetchBuvid, fetchDanmuInfo, invalidateDanmuInfo } from './bilibili-api'

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

// 房间信息查询超时。断网时 fetch 默认会挂很久（DNS + TCP 各自的系统级超时），
// 不设上限的话"开始"按钮会卡死好几十秒，重连循环也会被拖住
const ROOM_INFO_TIMEOUT_MS = 10_000

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
      headers: { 'User-Agent': 'Mozilla/5.0 LiveLink/0.1.0' },
      signal: AbortSignal.timeout(ROOM_INFO_TIMEOUT_MS)
    })
  } catch (err) {
    const name = (err as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new RoomApiError(`调用 B 站房间 API 超时（${ROOM_INFO_TIMEOUT_MS}ms）`, err)
    }
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

// ─── 连接健壮性参数 ───────────────────────────────────────────
//
// 握手判定：startListen() 是同步返回的，TCP 连上（open）也不代表握手成功——
// 鉴权包被拒时服务端才关连接。真正的"连上了"信号是 CONNECT_SUCCESS，
// 对应 tiny-bilibili-ws 的 `live` 事件。超时没等到就算这次失败
const HANDSHAKE_TIMEOUT_MS = 15_000

// 我们自己发心跳的间隔。
// tiny-bilibili-ws 的心跳链是"收到回包才排下一次"（HEARTBEAT_REPLY 里才
// this.timeout = setTimeout(heartbeat)），只要丢一个回包，心跳就永久停摆，
// 连接静默变死而不触发 close —— UI 会一直显示"已连接"却再也收不到弹幕。
// 所以把 lib 的 heartbeatTime 调得很长让它休眠，改由这里无条件定时发
const HEARTBEAT_INTERVAL_MS = 30_000
const LIB_HEARTBEAT_IDLE_MS = 10 * 60_000

// 静默看门狗：超过这个时间没有任何下行流量（弹幕 / 心跳回包）就判这条连接已死。
// 健康连接每 30s 至少有一个心跳回包，75s ≈ 连丢 2 个回包
const ACTIVITY_TIMEOUT_MS = 75_000
const ACTIVITY_CHECK_MS = 15_000

// tiny-bilibili-ws 的 LiveClient / tcpSocket 的内部形态。
// 需要强拆连接时用得到——lib 的 close() 只在 live===true 时才真的关闭，
// 连接已经断掉的时候它是个空操作（直接 return false），
// 这正是"停止之后底层还在偷偷重连"的原因，必须自己动手拆
interface RawLiveClient {
  close_func_called?: boolean
  timeout?: NodeJS.Timeout
  closed?: boolean
  live?: boolean
  tcpSocket?: {
    writable?: boolean
    end?: () => void
    destroy?: () => void
    removeAllListeners?: () => void
  }
  on?: (event: string, cb: (...args: unknown[]) => void) => unknown
  off?: (event: string, cb: (...args: unknown[]) => void) => unknown
  removeAllListeners?: () => void
}

export class BilibiliAdapter implements PlatformAdapter {
  readonly platform = 'bilibili' as const
  private listener: MessageListener | null = null
  private listeners = new Set<EventListener>()
  private statusListeners = new Set<StatusListener>()
  private connectedRoomId: number | null = null
  // 最近一次 connect 的登录态参数，重连时原样复用
  private connectOptions: BilibiliConnectOptions | null = null
  // 握手成功（收到 CONNECT_SUCCESS）到连接关闭之间为 true
  private alive = false
  // 连接世代。每次 teardown/disconnect 自增，所有回调都带着自己那一代的号，
  // 对不上就直接 return。这样即使底层有僵尸 listener 残留，它也再也发不出事件，
  // 取代了原来那个会被错误的 close 消费掉的 expectClose 布尔
  private generation = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
  private activityTimer: NodeJS.Timeout | null = null
  private lastActivityAt = 0
  // 诊断：收到的 cmd 频次（30s flush 一次）
  private cmdHistogram = new Map<string, number>()
  private histogramFlushTimer: NodeJS.Timeout | null = null

  get isConnected(): boolean {
    // 不能用 listener.closed：lib 的 closed 字段在 socket 关闭后要等
    // RECONNECT_TIME 才置位，中间那几秒是错的。用自己维护的握手状态
    return this.listener != null && this.alive
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

  /**
   * 重连 = 彻底拆掉旧连接 + 用全新 token 重新建立，而不是调 listener.reconnect()。
   *
   * lib 的 reconnect() 只会重连到 init() 当时闭包里那个 host/port，并且复用
   * this.options.key —— token 一旦失效，它重连一万次也永远失败。必须重建。
   *
   * 返回的 Promise 在握手真正成功后才 resolve，失败则 reject，
   * 上层据此排下一次退避重试，不需要再拿定时器猜结果。
   */
  async reconnect(): Promise<void> {
    const roomId = this.connectedRoomId
    if (roomId == null) {
      throw new Error('没有可重连的房间（还没成功连接过）')
    }
    const options = this.connectOptions ?? undefined
    this.teardownListener()
    await this.openListener(roomId, options)
  }

  async connect(roomInput: string | number, options?: BilibiliConnectOptions): Promise<void> {
    if (this.listener) {
      throw new AdapterAlreadyConnectedError()
    }

    const { roomId } = await resolveRoomId(roomInput)
    this.connectedRoomId = roomId
    this.connectOptions = options ? { ...options } : null

    try {
      await this.openListener(roomId, options)
    } catch (err) {
      // 首次连接失败不留半开状态，也不保留 roomId——UI 会显示错误让用户重新点开始
      this.teardownListener()
      this.connectedRoomId = null
      this.connectOptions = null
      throw err
    }
  }

  /**
   * 真正建立一条连接：取全新握手 token → startListen → 等 CONNECT_SUCCESS。
   * connect() 和 reconnect() 共用。
   */
  private async openListener(roomId: number, options?: BilibiliConnectOptions): Promise<void> {
    const gen = ++this.generation
    const sessdata = options?.sessdata?.trim() || undefined

    // 每次都取一份全新的弹幕服务器 token。这是整个修复的核心：
    // 不这么做的话，lib 会一直复用它模块级缓存里那份永不过期的旧 token
    const danmu = await fetchDanmuInfo(roomId, { sessdata })
    if (gen !== this.generation) return // 拉 token 期间被 disconnect 了

    // buvid：用户配置优先；没配就现取一个。取不到不致命
    let buvid = options?.buvid?.trim() || ''
    if (!buvid) buvid = (await fetchBuvid({ sessdata })) ?? ''
    if (gen !== this.generation) return

    const wsOptions: Record<string, unknown> = {
      // 关掉 lib 自带的 keepalive。它是个没有次数上限、没有退避、
      // 且无法从外部停止的 5s 死循环——"停止"之后还在后台重连的元凶。
      // 重连策略由 LiveLink 自己掌握
      keepalive: false,
      // 用我们刚取的新 token。lib 里是 `this.options.key || (this.options.key = token)`，
      // 我们先占上，它就不会再拿缓存里的旧 token 覆盖
      key: danmu.token,
      // 让 lib 的心跳链休眠，改由本类的 heartbeatTimer 无条件驱动
      heartbeatTime: LIB_HEARTBEAT_IDLE_MS,
      ...(buvid ? { buvid } : {}),
      ...(options?.uid ? { uid: Number(options.uid) } : {}),
      ...(sessdata ? { headers: { Cookie: `SESSDATA=${sessdata}` } } : {})
    }

    const handler: MsgHandler = {
      onOpen: () => {
        if (gen !== this.generation) return
        // 注意：这只是 TCP 连上了，鉴权还没过。真正的"已连接"看 `live` 事件，
        // 在 waitForHandshake 里处理。这里只记时间，别急着报 opened
        this.markActivity()
        console.log(`[BilibiliAdapter] tcp ready for room ${roomId} (等待鉴权)`)
      },
      onClose: () => {
        if (gen !== this.generation) return
        console.log(`[BilibiliAdapter] connection closed for room ${roomId}`)
        this.alive = false
        this.stopTimers()
        // 走到这里必然是被动断线：主动 disconnect 会先自增 generation，
        // 上面那行 gen 检查就已经把回调拦掉了
        this.emitStatus({ kind: 'closed', intended: false })
      },
      onError: (err) => {
        if (gen !== this.generation) return
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

      // 直播间累计看过人数变化（B 站直播间顶部"X 人看过"）。
      // 高频推送（每数秒一次），不进 Logs 页 / 规则引擎，仅供弹幕悬浮窗等 UI 实时刷新
      onWatchedChange: (msg) => {
        this.emit({
          kind: 'room.stats',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: { uid: '0', uname: '' }, // room.stats 没有具体 user，占位
          payload: {
            watchedNum: msg.body.num,
            watchedText: msg.body.text_small
          }
        })
      },

      // 诊断：所有原始 cmd 计入直方图。SESSDATA 填了仍收不到弹幕时，看主进程 console
      // 的 30s 直方图就能判断 B 站到底推了什么 cmd（DANMU_MSG 是否在列）
      //
      // 同时这里也是盲盒事件解析点：blive-message-listener 0.5.x 的 GiftMsg
      // 不暴露 blind_gift 字段，要自己看 SEND_GIFT.data.blind_gift 非空时发 blindbox.opened
      raw: {
        msg: (m: { cmd?: string; data?: unknown }) => {
          if (gen !== this.generation) return
          // 任何一条下行消息都算"这条连接还活着"，喂给静默看门狗
          this.markActivity()
          const cmd = m?.cmd ?? 'unknown'
          this.cmdHistogram.set(cmd, (this.cmdHistogram.get(cmd) ?? 0) + 1)
          this.scheduleHistogramFlush()

          if (cmd === 'SEND_GIFT') {
            this.tryEmitBlindBox(m.data, roomId)
          }
        }
      }
    }

    // startListen 第三参数类型是 MessageListenerTCPOptions { ws?: TCPOptions }
    // 我们用 Record<string, unknown> 构造 wsOptions 避开 lib 内部嵌套类型，传入时 cast
    const listener = startListen(roomId, handler, {
      ws: wsOptions
    } as Parameters<typeof startListen>[2])
    this.listener = listener
    this.connectedRoomId = roomId

    try {
      await this.waitForHandshake(listener, gen)
    } catch (err) {
      // 握手被拒 = 这份 token 确实不能用了。作废缓存，保证下一次重连一定回源取新的。
      // （用"握手失败"而不是"时间到了"来判断失效，既不会连不上，也不会去捶 B 站接口）
      invalidateDanmuInfo(roomId)
      // 把这条半死连接拆干净再抛，绝不能留着让它在后台自己转
      if (gen === this.generation) {
        this.teardownListener()
      }
      throw err
    }
    if (gen !== this.generation) return

    this.alive = true
    this.markActivity()
    this.startHeartbeat(gen)
    this.startActivityWatchdog(gen)
    console.log(`[BilibiliAdapter] connected to room ${roomId}`)
    this.emitStatus({ kind: 'opened', roomId })
  }

  /**
   * 等 CONNECT_SUCCESS（lib 的 `live` 事件）。
   * TCP 连上不等于连接成功——鉴权失败时服务端是先接受连接再关掉的，
   * 用 onOpen 判定"已连接"会让 UI 先绿一下再掉线
   */
  private waitForHandshake(listener: MessageListener, gen: number): Promise<void> {
    const raw = listener.live as unknown as RawLiveClient
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err: Error | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        raw.off?.('live', onLive)
        raw.off?.('close', onClose)
        if (err) reject(err)
        else resolve()
      }
      const onLive = (): void => finish(null)
      const onClose = (): void =>
        finish(
          new HandshakeFailedError(
            '连上了 B 站弹幕服务器但握手被拒（token 失效或未登录），已丢弃这条连接'
          )
        )
      const timer = setTimeout(
        () => finish(new HandshakeFailedError(`握手超时（${HANDSHAKE_TIMEOUT_MS}ms 没收到确认）`)),
        HANDSHAKE_TIMEOUT_MS
      )
      if (gen !== this.generation) {
        finish(new HandshakeFailedError('连接已被取消'))
        return
      }
      raw.on?.('live', onLive)
      raw.on?.('close', onClose)
    })
  }

  private markActivity(): void {
    this.lastActivityAt = Date.now()
  }

  /**
   * 自己驱动心跳。不依赖 lib 那条"收到回包才排下一次"的链——
   * 丢一个回包它就永久停摆，连接会静默死掉而不报 close
   */
  private startHeartbeat(gen: number): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (gen !== this.generation) return
      try {
        this.listener?.heartbeat()
      } catch (err) {
        console.warn('[BilibiliAdapter] heartbeat failed', err)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  /**
   * 静默看门狗。断网时 TCP 可能长时间处于半开状态（没有 RST，socket 不报 close），
   * 表现就是 UI 一直"已连接"却再也收不到任何弹幕。
   * 超过 ACTIVITY_TIMEOUT_MS 没有下行流量就主动判死，交给上层重连
   */
  private startActivityWatchdog(gen: number): void {
    this.stopActivityWatchdog()
    this.activityTimer = setInterval(() => {
      if (gen !== this.generation) return
      const idleMs = Date.now() - this.lastActivityAt
      if (idleMs < ACTIVITY_TIMEOUT_MS) return
      console.warn(
        `[BilibiliAdapter] ${Math.round(idleMs / 1000)}s 没有任何下行数据，判定连接已死，触发重连`
      )
      this.alive = false
      this.stopTimers()
      const dead = this.listener
      this.listener = null
      if (dead) this.hardCloseListener(dead)
      // roomId / connectOptions 保留，好让上层直接 reconnect()
      this.generation++ // 让这条死连接残留的回调彻底失效
      this.emitStatus({ kind: 'closed', intended: false })
    }, ACTIVITY_CHECK_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private stopActivityWatchdog(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer)
      this.activityTimer = null
    }
  }

  private stopTimers(): void {
    this.stopHeartbeat()
    this.stopActivityWatchdog()
  }

  /**
   * 强拆一条底层连接。
   *
   * 为什么不能只调 listener.close()——实测复现过的两条路径：
   *
   * 1) 断线后 5 秒内点"停止"：lib 的 close 事件处理里是
   *      if (keepalive && !close_func_called) {
   *        let t = setTimeout(() => { …; this.socket.reconnect() }, 5000)
   *      }
   *    那个 t 是处理函数里的局部变量，close() 根本拿不到、也就取消不了
   *    （close() 只 clearTimeout(this.timeout)，那是心跳定时器）。
   *    于是 5 秒后它照样重连，close_func_called 在计时器里压根没再检查。
   *
   * 2) 断线超过 5 秒后点"停止"：此时 live 已被置 false，而
   *      close(){ return this.live ? (…真正关闭…, true) : false }
   *    直接返回 false，什么都不做。
   *
   * 两条路都留下一条停不掉的僵尸连接，而 LiveLink 这边已经把引用丢了。
   * 所以这里绕开 close()，直接把 socket 和监听逐层拆干净
   */
  private hardCloseListener(listener: MessageListener): void {
    const raw = listener.live as unknown as RawLiveClient
    try {
      raw.close_func_called = true // 万一 keepalive 被打开，这个标志能挡住重连分支
      if (raw.timeout) clearTimeout(raw.timeout) // lib 自己的心跳定时器
    } catch (err) {
      console.warn('[BilibiliAdapter] hardClose: 清 lib 内部状态失败', err)
    }
    try {
      const sock = raw.tcpSocket
      if (sock) {
        sock.removeAllListeners?.() // 先摘监听，destroy 就不会再冒出 close/error 事件
        if (sock.writable) sock.end?.()
        sock.destroy?.()
      }
    } catch (err) {
      console.warn('[BilibiliAdapter] hardClose: 关闭 socket 失败', err)
    }
    try {
      raw.removeAllListeners?.()
    } catch (err) {
      console.warn('[BilibiliAdapter] hardClose: 摘 LiveClient 监听失败', err)
    }
    raw.closed = true
    raw.live = false
  }

  /** 拆掉当前连接但保留 roomId / options，供重连复用 */
  private teardownListener(): void {
    this.generation++ // 存量回调立即失效
    this.stopTimers()
    this.alive = false
    const dead = this.listener
    this.listener = null
    if (dead) this.hardCloseListener(dead)
  }

  async disconnect(): Promise<void> {
    this.teardownListener()
    this.connectedRoomId = null
    this.connectOptions = null
    // 清掉诊断直方图状态，避免下次 connect 时把上次的统计带过来
    if (this.histogramFlushTimer) {
      clearTimeout(this.histogramFlushTimer)
      this.histogramFlushTimer = null
    }
    this.cmdHistogram.clear()
    // 不清 this.listeners / this.statusListeners：那些是主进程级别的订阅，
    // 跨 connect/disconnect 周期保持。清掉会导致再 connect 后事件 / 状态断流。
  }

  // 从 SEND_GIFT.data 抽 blind_gift 信息。raw msg 没经过 lib 的字段归一化，
  // 字段命名按 B 站协议 snake_case；blind_gift 在不同时期版本字段名有过微调
  // （original_gift_* vs blind_gift_id 等），优先按文档伪代码命名，逐字段兜底
  private tryEmitBlindBox(data: unknown, roomId: number): void {
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, unknown>
    const blind = d['blind_gift']
    if (!blind || typeof blind !== 'object') return
    const b = blind as Record<string, unknown>

    const blindBoxId = num(b['original_gift_id']) ?? num(b['blind_gift_id']) ?? 0
    const blindBoxName = str(b['original_gift_name']) ?? '盲盒'
    const costRaw = num(b['original_gift_price']) ?? num(b['price']) ?? 0
    const rewardGiftId = num(d['gift_id']) ?? 0
    const rewardGiftName = str(d['gift_name']) ?? '未知礼物'
    const rewardPriceRaw = num(d['price']) ?? 0
    const rewardNum = num(d['num']) ?? num(d['amount']) ?? 1

    // 价格 B 站统一 ×1000，除以 1000 还原成 RMB
    const costPerBox = costRaw / 1000
    const rewardPricePerItem = rewardPriceRaw / 1000
    const netGainPerBox = rewardPricePerItem * rewardNum - costPerBox

    // user 来自 SEND_GIFT.data 顶层字段，没有完整 badge 信息但 uid/uname 总是有
    const uid = String(num(d['uid']) ?? 0)
    const uname = str(d['uname']) ?? '观众'
    const face = str(d['face']) ?? undefined
    // medal_info 是 B 站协议里 SEND_GIFT 携带的礼物粉丝牌信息，用它构造 fansMedal
    const medalInfo = d['medal_info']
    const medal =
      medalInfo && typeof medalInfo === 'object' ? (medalInfo as Record<string, unknown>) : null
    const medalLevel = medal ? (num(medal['medal_level']) ?? 0) : 0
    const medalName = medal ? (str(medal['medal_name']) ?? '') : ''
    const medalAnchorRoom = medal ? (num(medal['anchor_roomid']) ?? 0) : 0
    const medalLighted = medal ? Boolean(num(medal['is_lighted'])) : false

    this.emit({
      kind: 'blindbox.opened',
      platform: 'bilibili',
      timestamp: num(d['timestamp']) ? num(d['timestamp'])! * 1000 : Date.now(),
      user: {
        uid,
        uname,
        avatar: face,
        guardLevel: num(d['guard_level']) ?? 0,
        fansMedal: medal
          ? {
              level: medalLevel,
              name: medalName,
              isAnchor: medalAnchorRoom > 0 && medalAnchorRoom === roomId,
              isLighted: medalLighted
            }
          : undefined
      },
      payload: {
        blindBoxId,
        blindBoxName,
        costPerBox,
        rewardGiftId,
        rewardGiftName,
        rewardPricePerItem,
        rewardNum,
        netGainPerBox
      }
    })
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

// 从 unknown 容错读 number / string
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
function str(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  return undefined
}
