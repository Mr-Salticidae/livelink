import { startListen, type MessageListener, type MsgHandler, type User } from 'blive-message-listener'
import type {
  EventListener,
  PlatformAdapter,
  StandardEvent,
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

function toUserInfo(u: User): UserInfo {
  return {
    uid: String(u.uid),
    uname: u.uname,
    avatar: u.face,
    isAdmin: u.identity?.room_admin ?? false,
    guardLevel: u.identity?.guard_level ?? 0
  }
}

export class BilibiliAdapter implements PlatformAdapter {
  readonly platform = 'bilibili' as const
  private listener: MessageListener | null = null
  private listeners = new Set<EventListener>()
  private connectedRoomId: number | null = null

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

  private emit(e: StandardEvent): void {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch (err) {
        console.error('[BilibiliAdapter] listener threw', err)
      }
    }
  }

  async connect(roomInput: string | number): Promise<void> {
    if (this.listener && !this.listener.closed) {
      throw new AdapterAlreadyConnectedError()
    }

    const { roomId } = await resolveRoomId(roomInput)

    const handler: MsgHandler = {
      onOpen: () => console.log(`[BilibiliAdapter] connected to room ${roomId}`),
      onClose: () => console.log(`[BilibiliAdapter] connection closed for room ${roomId}`),
      onError: (err) => console.error('[BilibiliAdapter] error', err),

      onIncomeDanmu: (msg) => {
        this.emit({
          kind: 'danmu.received',
          platform: 'bilibili',
          timestamp: msg.timestamp,
          user: toUserInfo(msg.body.user),
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
            user: toUserInfo(msg.body.user),
            payload: {}
          })
        } else if (action === 'follow') {
          this.emit({
            kind: 'follow.received',
            platform: 'bilibili',
            timestamp: msg.body.timestamp ?? msg.timestamp,
            user: toUserInfo(msg.body.user),
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
          user: toUserInfo(msg.body.user),
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
          user: toUserInfo(msg.body.user),
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
          user: toUserInfo(msg.body.user),
          payload: {
            message: msg.body.content,
            price: msg.body.price,
            durationSec: msg.body.time
          }
        })
      }
    }

    this.listener = startListen(roomId, handler)
    this.connectedRoomId = roomId
  }

  async disconnect(): Promise<void> {
    if (this.listener && !this.listener.closed) {
      this.listener.close()
    }
    this.listener = null
    this.connectedRoomId = null
    this.listeners.clear()
  }
}
