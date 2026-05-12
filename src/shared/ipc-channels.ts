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
