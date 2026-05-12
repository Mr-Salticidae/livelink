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

export interface PlatformAdapter {
  readonly platform: 'bilibili' | 'douyin' | 'huya'
  readonly isConnected: boolean
  connect(roomId: string | number): Promise<void>
  disconnect(): Promise<void>
  on(listener: EventListener): () => void
}
