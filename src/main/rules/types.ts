import type { EventKind } from '../platform/adapter'

export interface RuleTemplate {
  text: string // 占位符：{uname} {giftName} {num} {content} {guardLevel} {price} 等
}

export type ActionKind = 'tts' | 'overlay' | 'log' | 'query_blindbox' | 'query_wallet'

export interface ActionSpec {
  kind: ActionKind
  template?: RuleTemplate // tts / log 用
  overlayPayload?: Record<string, unknown> // overlay 透传字段（dispatcher 会注入完整事件信息）
}

export type RuleMatch =
  | { kind: 'always' }
  | { kind: 'keyword'; keywords: string[]; mode: 'any' | 'all' }
  | { kind: 'regex'; pattern: string }
  | { kind: 'fans_medal'; minLevel: number; requireAnchor: boolean }

export interface Rule {
  id: string
  name: string
  enabled: boolean
  trigger: EventKind
  match: RuleMatch
  cooldownSec: number // 全局冷却，0 = 无
  perUserCooldownSec: number // 单用户冷却，0 = 无
  actions: ActionSpec[]
}
