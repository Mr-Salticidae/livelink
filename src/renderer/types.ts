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
  // 分事件音色覆盖（key 是 EventKind，value 是 voice）
  perEventVoice?: Partial<Record<EventKind, string>>
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

// OBS 弹幕信息板
export type DanmuBoardPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export interface DanmuBoardConfig {
  enabled: boolean
  position: DanmuBoardPosition
  maxLines: number
  fontSize: number
  showGift: boolean
}

// 弹幕抽奖
export interface LotteryConfig {
  prize: string
  keyword: string
  winnerCount: number
  durationSec: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}

export interface LotteryWinner {
  uid: string
  uname: string
}

export type LotteryState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      config: LotteryConfig
      startedAt: number
      endsAt: number
      participantCount: number
    }
  | {
      phase: 'done'
      config: LotteryConfig
      endedAt: number
      participantCount: number
      winners: LotteryWinner[]
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
  ttsTest: (text?: string, voice?: string) => Promise<{ ok: boolean }>
  ttsVoiceList: () => Promise<VoiceOption[]>

  getOverlayPort: () => Promise<number>
  getOverlayUrl: () => Promise<string>
  getOverlayStatus: () => Promise<OverlayState>
  retryOverlay: () => Promise<OverlayState>
  onOverlayStatus: (cb: (s: OverlayState) => void) => () => void

  // 弹幕悬浮窗
  danmuOverlayOpen: () => Promise<{ enabled: boolean; pinned: boolean }>
  danmuOverlayClose: () => Promise<{ enabled: boolean; pinned: boolean }>
  danmuOverlayToggle: () => Promise<{ enabled: boolean; pinned: boolean }>
  danmuOverlayPinToggle: () => Promise<{ enabled: boolean; pinned: boolean }>
  danmuOverlayStatus: () => Promise<{ enabled: boolean; pinned: boolean }>
  getDanmuOverlaySettings: () => Promise<{ opacity: number; fontSize: number }>
  onDanmuOverlayStatus: (cb: (s: { enabled: boolean; pinned: boolean }) => void) => () => void
  onDanmuOverlayPinned: (cb: (s: { pinned: boolean }) => void) => () => void
  onDanmuOverlayEvent: (cb: (item: unknown) => void) => () => void
  onDanmuOverlayRoomStats: (
    cb: (stats: { watchedNum: number; watchedText: string }) => void
  ) => () => void

  // OBS 弹幕信息板
  getDanmuBoard: () => Promise<DanmuBoardConfig>
  patchDanmuBoard: (patch: Partial<DanmuBoardConfig>) => Promise<DanmuBoardConfig>

  // 弹幕抽奖
  lotteryStart: (config: LotteryConfig) => Promise<LotteryState>
  lotteryCancel: () => Promise<LotteryState>
  lotteryDrawNow: () => Promise<LotteryState>
  lotteryReset: () => Promise<LotteryState>
  lotteryStatus: () => Promise<LotteryState>
  lotteryGetPreset: () => Promise<LotteryConfig>
  lotterySavePreset: (preset: LotteryConfig) => Promise<LotteryConfig>
  onLotteryStatus: (cb: (s: LotteryState) => void) => () => void

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
