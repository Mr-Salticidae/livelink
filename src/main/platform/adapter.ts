// PlatformAdapter 接口 + 标准事件类型
// 边界：所有平台（B 站 / 抖音 / 虎牙）都要把它们的原生事件转成 StandardEvent

export type EventKind =
  | 'viewer.enter'
  | 'danmu.received'
  | 'gift.received'
  | 'follow.received'
  | 'guard.bought'
  | 'super.chat'
  | 'blindbox.opened'

export interface UserInfo {
  uid: string
  uname: string
  avatar?: string
  isAdmin?: boolean
  guardLevel?: number // 0=无 1=总督 2=提督 3=舰长
  // 粉丝牌信息。注意：B 站协议上，进房事件 (INTERACT_WORD) 里 user.badge 往往是空，
  // 只有弹幕 / 礼物事件 user.badge 才完整。"按粉丝牌过滤进房欢迎" 的命中率因此受限——
  // 需要在 UI 上提醒用户这是已知 caveat
  fansMedal?: {
    level: number // 牌子等级
    name: string // 牌子名称
    isAnchor: boolean // 是否本直播间主播的牌子（关键过滤维度）
    isLighted: boolean // 牌子是否点亮
  }
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

// 盲盒事件。blive-message-listener 0.5.x 的 GiftMsg 不暴露 blind_gift 字段，
// 实际从 raw.msg 监听 SEND_GIFT 且 m.data.blind_gift 非空里解析。
//
// B 站协议层（实测 + 社区资料）SEND_GIFT.blind_gift 关键字段：
//   original_gift_id   开的是哪种盲盒（如"心动盲盒"对应固定 id）
//   original_gift_name 盲盒中文名
//   original_gift_price 盲盒原价（×1000，即每次开盒花费的电池数 / 千分位）
//   gift_action        "投喂" 等
//   gift_tip_price     提示价格（少见，可能不存在）
// SEND_GIFT 主体字段（不在 blind_gift 内）：
//   gift_id            实际中奖的礼物 id
//   gift_name          中奖礼物名
//   price              中奖礼物单价（×1000）
//   num                中奖数量（盲盒一般一发一次，但小心心连击例外）
// 注意：blind_gift 在 B 站不同时期字段名有过微调，代码里做 fallback 容错读取。
export interface BlindBoxPayload {
  blindBoxId: number // original_gift_id；偶有缺失记 0
  blindBoxName: string // original_gift_name
  costPerBox: number // 单次开盒花费（RMB，已 / 1000）
  rewardGiftId: number // 中奖礼物 id
  rewardGiftName: string
  rewardPricePerItem: number // 中奖礼物单价（RMB，已 / 1000）
  rewardNum: number
  netGainPerBox: number // 净盈亏 = reward 总价 - cost（RMB）
}

export type StandardEvent =
  | { kind: 'viewer.enter'; platform: string; timestamp: number; user: UserInfo; payload: ViewerEnterPayload }
  | { kind: 'danmu.received'; platform: string; timestamp: number; user: UserInfo; payload: DanmuPayload }
  | { kind: 'gift.received'; platform: string; timestamp: number; user: UserInfo; payload: GiftPayload }
  | { kind: 'follow.received'; platform: string; timestamp: number; user: UserInfo; payload: FollowPayload }
  | { kind: 'guard.bought'; platform: string; timestamp: number; user: UserInfo; payload: GuardBuyPayload }
  | { kind: 'super.chat'; platform: string; timestamp: number; user: UserInfo; payload: SuperChatPayload }
  | { kind: 'blindbox.opened'; platform: string; timestamp: number; user: UserInfo; payload: BlindBoxPayload }

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
