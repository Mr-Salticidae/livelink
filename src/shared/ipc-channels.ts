// 主进程 ↔ 渲染端 IPC 通道名集中定义，避免魔法字符串散落
export const IpcChannels = {
  // 连接控制
  AppStart: 'app:start',
  AppStop: 'app:stop',
  AppStatus: 'app:status',
  AppStatusUpdate: 'app:status-update', // 主→渲染 push

  // 配置
  ConfigGetRoom: 'config:room:get',
  ConfigSetRoom: 'config:room:set',
  ConfigGetTts: 'config:tts:get',
  ConfigPatchTts: 'config:tts:patch',
  ConfigGetOverlayPort: 'config:overlay:port',
  ConfigGetBilibiliAuth: 'config:auth:bilibili:get',
  ConfigPatchBilibiliAuth: 'config:auth:bilibili:patch',

  // 规则
  RuleList: 'rule:list',
  RuleUpsert: 'rule:upsert',
  RuleDelete: 'rule:delete',

  // TTS
  TtsTest: 'tts:test',
  TtsVoiceList: 'tts:voice-list',

  // Overlay
  OverlayUrl: 'overlay:url',
  OverlayStatus: 'overlay:status',
  OverlayRetry: 'overlay:retry',
  OverlayStatusUpdate: 'overlay:status-update',

  // 弹幕悬浮窗（独立 BrowserWindow，给单屏主播全屏游戏时瞟弹幕用）
  DanmuOverlayOpen: 'danmu-overlay:open',
  DanmuOverlayClose: 'danmu-overlay:close',
  DanmuOverlayToggle: 'danmu-overlay:toggle',
  DanmuOverlayPinToggle: 'danmu-overlay:pin-toggle',
  DanmuOverlayStatus: 'danmu-overlay:status',
  DanmuOverlayStatusUpdate: 'danmu-overlay:status-update',
  DanmuOverlayPinnedUpdate: 'danmu-overlay:pinned-update', // 主→子窗 pinned 状态推送
  DanmuOverlayGetSettings: 'danmu-overlay:get-settings',
  DanmuOverlayEvent: 'danmu-overlay:event', // 主→子窗 push 弹幕 / 礼物事件
  DanmuOverlayRoomStats: 'danmu-overlay:room-stats', // 主→子窗 push 在线人数

  // OBS 弹幕信息板
  DanmuBoardGet: 'danmu-board:get',
  DanmuBoardPatch: 'danmu-board:patch',
  DanmuBoardConfigPush: 'danmu-board:config-push', // 主→overlay namespace 推送 settings 变更

  // 游戏卡片位置（抽奖 / 投票 / 竞猜 / 赛马 共用，主播 Home 页拖动）
  GameCardGet: 'game-card:get',
  GameCardPatch: 'game-card:patch',
  GameCardConfigPush: 'game-card:config-push', // 主→overlay namespace 推送位置变更

  // 弹幕抽奖
  LotteryStart: 'lottery:start',
  LotteryCancel: 'lottery:cancel',
  LotteryDrawNow: 'lottery:draw-now',
  LotteryReset: 'lottery:reset',
  LotteryStatus: 'lottery:status',
  LotteryStatusUpdate: 'lottery:status-update', // 主→渲染 push
  LotteryGetPreset: 'lottery:get-preset',
  LotterySavePreset: 'lottery:save-preset',

  // 互动投票
  VotingStart: 'voting:start',
  VotingCancel: 'voting:cancel',
  VotingEndNow: 'voting:end-now',
  VotingReset: 'voting:reset',
  VotingStatus: 'voting:status',
  VotingStatusUpdate: 'voting:status-update',
  VotingGetPreset: 'voting:get-preset',

  // 赛马
  HorseRaceStart: 'horserace:start',
  HorseRaceCancel: 'horserace:cancel',
  HorseRaceStartNow: 'horserace:start-now',
  HorseRaceReset: 'horserace:reset',
  HorseRaceStatus: 'horserace:status',
  HorseRaceStatusUpdate: 'horserace:status-update',
  HorseRaceGetPreset: 'horserace:get-preset',

  // 竞猜（哈松币押注）
  GuessingStart: 'guessing:start',
  GuessingLockNow: 'guessing:lock-now',
  GuessingSettle: 'guessing:settle',
  GuessingCancel: 'guessing:cancel',
  GuessingReset: 'guessing:reset',
  GuessingStatus: 'guessing:status',
  GuessingStatusUpdate: 'guessing:status-update',
  GuessingGetConfig: 'guessing:get-config',
  GuessingPatchConfig: 'guessing:patch-config', // 改 currency / initialBalance / presets
  GuessingQueryWallet: 'guessing:query-wallet',
  GuessingTopBalance: 'guessing:top-balance',

  // 日志（主→渲染 push）
  LogAppend: 'log:append',
  LogRecent: 'log:recent',
  LogClear: 'log:clear'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

// Overlay HTTP 服务的整体状态（启动失败时 fatalError 非空、port 为 0）
export interface OverlayState {
  port: number
  url: string
  fatalError: string | null
  retrying: boolean
}

// 状态枚举（连接状态机）
export type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'validating'; roomInput: string }
  | { state: 'connecting'; roomId: number }
  | { state: 'connected'; roomId: number }
  | { state: 'reconnecting'; roomId: number; message?: string }
  | { state: 'error'; code: string; message: string }
