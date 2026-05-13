// 渲染端用到的类型镜像（避免直接 import 主进程文件）

export type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'validating'; roomInput: string }
  | { state: 'connecting'; roomId: number }
  | { state: 'connected'; roomId: number }
  | { state: 'reconnecting'; roomId: number; message?: string }
  | { state: 'error'; code: string; message: string }

export type EventKind =
  | 'viewer.enter'
  | 'danmu.received'
  | 'gift.received'
  | 'follow.received'
  | 'guard.bought'
  | 'super.chat'
  | 'blindbox.opened'

export type ActionKind = 'tts' | 'overlay' | 'log' | 'query_blindbox'

export interface RuleTemplate {
  text: string
}

export interface ActionSpec {
  kind: ActionKind
  template?: RuleTemplate
  overlayPayload?: Record<string, unknown>
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
  cooldownSec: number
  perUserCooldownSec: number
  actions: ActionSpec[]
}

export interface TTSConfig {
  enabled: boolean
  voice: string
  rate: string
  volume: string
}

export interface VoiceOption {
  value: string
  label: string
}

export interface LogEntry {
  timestamp: number
  ruleId: string | null
  ruleName: string | null
  eventKind: EventKind
  uname: string | null
  text: string
}

export interface OverlayState {
  port: number
  url: string
  fatalError: string | null
  retrying: boolean
}

export interface BilibiliAuth {
  sessdata: string
  uid: string
  buvid: string
}

// 类型化 window.api，避免 renderer 各处 cast
export interface ApiSurface {
  startConnection: (roomId: string) => Promise<{ ok: boolean; roomId: number }>
  stopConnection: () => Promise<{ ok: boolean }>
  getStatus: () => Promise<ConnectionStatus>

  getRoom: () => Promise<{ id: string }>
  setRoomId: (id: string) => Promise<{ id: string }>

  getBilibiliAuth: () => Promise<BilibiliAuth>
  patchBilibiliAuth: (patch: Partial<BilibiliAuth>) => Promise<BilibiliAuth>

  getTts: () => Promise<TTSConfig>
  patchTts: (patch: Partial<TTSConfig>) => Promise<TTSConfig>
  ttsTest: (text?: string) => Promise<{ ok: boolean }>
  ttsVoiceList: () => Promise<VoiceOption[]>

  getOverlayPort: () => Promise<number>
  getOverlayUrl: () => Promise<string>
  getOverlayStatus: () => Promise<OverlayState>
  retryOverlay: () => Promise<OverlayState>
  onOverlayStatus: (cb: (s: OverlayState) => void) => () => void

  // 弹幕悬浮窗
  danmuOverlayOpen: () => Promise<{ enabled: boolean }>
  danmuOverlayClose: () => Promise<{ enabled: boolean }>
  danmuOverlayToggle: () => Promise<{ enabled: boolean }>
  danmuOverlayStatus: () => Promise<{ enabled: boolean }>
  getDanmuOverlaySettings: () => Promise<{ opacity: number; fontSize: number }>
  onDanmuOverlayStatus: (cb: (s: { enabled: boolean }) => void) => () => void
  onDanmuOverlayEvent: (cb: (item: unknown) => void) => () => void

  ruleList: () => Promise<Rule[]>
  ruleUpsert: (rule: Rule) => Promise<Rule[]>
  ruleDelete: (id: string) => Promise<Rule[]>

  logRecent: (limit?: number) => Promise<LogEntry[]>
  logClear: () => Promise<{ ok: boolean }>

  onLog: (cb: (entry: LogEntry) => void) => () => void
  onStatus: (cb: (s: ConnectionStatus) => void) => () => void
}

declare global {
  interface Window {
    api: ApiSurface
  }
}
