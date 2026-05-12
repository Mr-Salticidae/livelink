// 主进程 ↔ 渲染端 IPC 通道名集中定义，避免魔法字符串散落
export const IpcChannels = {
  AppStart: 'app:start',
  AppStop: 'app:stop',
  AppStatus: 'app:status',
  EventStream: 'event:stream',
  ConfigGet: 'config:get',
  ConfigSet: 'config:set',
  RuleList: 'rule:list',
  RuleUpsert: 'rule:upsert',
  RuleDelete: 'rule:delete',
  TtsTest: 'tts:test',
  OverlayUrl: 'overlay:url'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
