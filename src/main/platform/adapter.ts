// PlatformAdapter 接口 + 标准事件类型
// 边界：所有平台（B 站 / 抖音 / 虎牙）都要把它们的原生事件转成 StandardEvent

export type EventKind =
  | 'viewer.enter'
  | 'danmu.received'
  | 'gift.received'
  | 'follow.received'
  | 'guard.bought'
  | 'super.chat'

export interface UserInfo {
  uid: string
  uname: string
  avatar?: string
  isAdmin?: boolean
  guardLevel?: number // 0=无 1=总督 2=提督 3=舰长
}

export interface ViewerEnterPayload {
  // 进房没有额外 payload，user 信息已在 event.user
  // 留对象形态保持 schema 统一，方便未来加扩展字段（如来源标签）
}

export interface DanmuPayload {
  content: string
}

export interface GiftPayload {
  giftId: number
  giftName: string
  num: number
  price: number // 单价，单位 RMB（已除以 1000）
  coinType: 'gold' | 'silver'
}

export interface FollowPayload {}

export interface GuardBuyPayload {
  guardLevel: number
  price: number // 单位 RMB
  giftName: string
}

export interface SuperChatPayload {
  message: string
  price: number // 单位 RMB
  durationSec: number
}

export type StandardEvent =
  | { kind: 'viewer.enter'; platform: string; timestamp: number; user: UserInfo; payload: ViewerEnterPayload }
  | { kind: 'danmu.received'; platform: string; timestamp: number; user: UserInfo; payload: DanmuPayload }
  | { kind: 'gift.received'; platform: string; timestamp: number; user: UserInfo; payload: GiftPayload }
  | { kind: 'follow.received'; platform: string; timestamp: number; user: UserInfo; payload: FollowPayload }
  | { kind: 'guard.bought'; platform: string; timestamp: number; user: UserInfo; payload: GuardBuyPayload }
  | { kind: 'super.chat'; platform: string; timestamp: number; user: UserInfo; payload: SuperChatPayload }

export type EventListener = (e: StandardEvent) => void

// 平台连接时可选的登录态参数。MVP 阶段只 BilibiliAdapter 用；
// 未来抖音/虎牙 adapter 各自有 options 类型，目前不抽象成 generic
export interface BilibiliConnectOptions {
  sessdata?: string
  uid?: string | number
  buvid?: string
}

// Adapter 生命周期事件，主进程根据这些信号刷新连接状态徽章
export type AdapterStatusEvent =
  | { kind: 'opened'; roomId: number }
  | { kind: 'closed'; intended: boolean } // intended=true 表示用户主动 disconnect；false 表示被动断线
  | { kind: 'error'; message: string }

export type StatusListener = (e: AdapterStatusEvent) => void

export interface PlatformAdapter {
  readonly platform: 'bilibili' | 'douyin' | 'huya'
  readonly isConnected: boolean
  connect(roomId: string | number, options?: BilibiliConnectOptions): Promise<void>
  disconnect(): Promise<void>
  on(listener: EventListener): () => void
  onStatus(listener: StatusListener): () => void
  // 让 adapter 触发底层 ws 的 reconnect（不重新走 connect 流程，保留当前 roomId 和 options）
  reconnect(): void
}
