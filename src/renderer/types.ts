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

export type ActionKind = 'tts' | 'overlay' | 'log' | 'query_blindbox' | 'query_wallet'

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
// 0.7.0 起 position 从枚举 4 角改为任意 { x, y } 百分比
export interface DanmuBoardPosition {
  x: number // 0-100 (%)
  y: number // 0-100 (%)
}
export interface DanmuBoardConfig {
  enabled: boolean
  position: DanmuBoardPosition
  maxLines: number
  fontSize: number
  showGift: boolean
}

// 游戏卡片位置（抽奖 / 投票 / 竞猜 / 赛马 共用一个坐标，进行中 + 结果卡都用这个位置）
export interface GameCardPosition {
  x: number
  y: number
}
export interface GameCardConfig {
  position: GameCardPosition
}

// 竞猜
export interface GuessingOption {
  key: string
  label: string
}
export interface GuessingPreset {
  id: string
  name: string
  title: string
  options: GuessingOption[]
  enrollSec: number
  defaultBet: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}
export interface GiftDepositConfig {
  enabled: boolean
  rmbToCoinRate: number
  includeSilver: boolean
}
export interface GuessingGlobalConfig {
  currencyName: string
  initialBalance: number
  giftDeposit: GiftDepositConfig
  presets: GuessingPreset[]
}
export interface GuessingConfig {
  title: string
  options: GuessingOption[]
  enrollSec: number
  defaultBet: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}
export interface GuessingWinner {
  uname: string
  bet: number
  payout: number
}
export type GuessingState =
  | { phase: 'idle' }
  | {
      phase: 'enrolling'
      config: GuessingConfig
      startedAt: number
      endsAt: number
      pool: number
      bets: Record<string, number>
      bettorCount: number
    }
  | {
      phase: 'settling'
      config: GuessingConfig
      pool: number
      bets: Record<string, number>
      bettorCount: number
    }
  | {
      phase: 'done'
      config: GuessingConfig
      winnerKey: string
      winners: GuessingWinner[]
      pool: number
      bets: Record<string, number>
    }
export interface WalletEntry {
  uname: string
  balance: number
  totalBet: number
  totalWon: number
  totalDeposited: number
  lastActiveAt: number
}

// 赛马
export interface Horse {
  key: string
  name: string
  emoji: string
}
export interface HorseRaceConfig {
  horses: Horse[]
  enrollSec: number
  raceSec: number
  defaultBet: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}
export interface HorseRanking {
  horseKey: string
  position: number
  rank: number
}
export interface HorseRaceWinner {
  uname: string
  bet: number
  payout: number
}
export type HorseRaceState =
  | { phase: 'idle' }
  | {
      phase: 'enrolling'
      config: HorseRaceConfig
      startedAt: number
      endsAt: number
      enrollments: Record<string, number>
      bets: Record<string, number>
      pool: number
      bettorCount: number
    }
  | {
      phase: 'racing'
      config: HorseRaceConfig
      startedAt: number
      positions: Record<string, number>
      enrollments: Record<string, number>
      bets: Record<string, number>
      pool: number
      bettorCount: number
    }
  | {
      phase: 'done'
      config: HorseRaceConfig
      endedAt: number
      rankings: HorseRanking[]
      enrollments: Record<string, number>
      bets: Record<string, number>
      pool: number
      bettorCount: number
      winners: HorseRaceWinner[]
      winnerBettors: string[]
    }

// 互动投票
export interface VotingOption {
  key: string
  label: string
}
export interface VotingConfig {
  title: string
  options: VotingOption[]
  durationSec: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
  allowChangeVote: boolean
}
export type VotingState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      config: VotingConfig
      startedAt: number
      endsAt: number
      counts: Record<string, number>
      totalVotes: number
    }
  | {
      phase: 'done'
      config: VotingConfig
      endedAt: number
      counts: Record<string, number>
      totalVotes: number
      winnerKey: string | null
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

  // 游戏卡片位置
  getGameCard: () => Promise<GameCardConfig>
  patchGameCard: (patch: Partial<GameCardConfig>) => Promise<GameCardConfig>

  // 弹幕抽奖
  lotteryStart: (config: LotteryConfig) => Promise<LotteryState>
  lotteryCancel: () => Promise<LotteryState>
  lotteryDrawNow: () => Promise<LotteryState>
  lotteryReset: () => Promise<LotteryState>
  lotteryStatus: () => Promise<LotteryState>
  lotteryGetPreset: () => Promise<LotteryConfig>
  lotterySavePreset: (preset: LotteryConfig) => Promise<LotteryConfig>
  onLotteryStatus: (cb: (s: LotteryState) => void) => () => void

  // 互动投票
  votingStart: (config: VotingConfig) => Promise<VotingState>
  votingCancel: () => Promise<VotingState>
  votingEndNow: () => Promise<VotingState>
  votingReset: () => Promise<VotingState>
  votingStatus: () => Promise<VotingState>
  votingGetPreset: () => Promise<VotingConfig>
  onVotingStatus: (cb: (s: VotingState) => void) => () => void

  // 赛马
  horseRaceStart: (config: HorseRaceConfig) => Promise<HorseRaceState>
  horseRaceCancel: () => Promise<HorseRaceState>
  horseRaceStartNow: () => Promise<HorseRaceState>
  horseRaceReset: () => Promise<HorseRaceState>
  horseRaceStatus: () => Promise<HorseRaceState>
  horseRaceGetPreset: () => Promise<HorseRaceConfig>
  onHorseRaceStatus: (cb: (s: HorseRaceState) => void) => () => void

  // 竞猜
  guessingStart: (config: GuessingConfig) => Promise<GuessingState>
  guessingLockNow: () => Promise<GuessingState>
  guessingSettle: (winnerKey: string) => Promise<GuessingState>
  guessingCancel: () => Promise<GuessingState>
  guessingReset: () => Promise<GuessingState>
  guessingStatus: () => Promise<GuessingState>
  guessingGetConfig: () => Promise<GuessingGlobalConfig>
  guessingPatchConfig: (patch: Partial<GuessingGlobalConfig>) => Promise<GuessingGlobalConfig>
  guessingTopBalance: (limit?: number) => Promise<WalletEntry[]>
  onGuessingStatus: (cb: (s: GuessingState) => void) => () => void

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
