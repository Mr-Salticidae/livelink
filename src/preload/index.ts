import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc-channels'

// Electron IPC 用 structuredClone 序列化参数。Vue 3 的 reactive Proxy
// 不能直接 clone，传 Proxy 对象（含嵌套数组 / 对象）会炸 `An object could not be cloned`。
//
// 渲染端可能用 `{ ...rule }` 浅展开 Proxy（顶层 plain object，但嵌套字段仍是 Proxy 引用），
// JSON 来回一次能把所有嵌套 Proxy 都拍平成 plain。
// 在 preload 层统一兜底，避免散落在每个 vue 文件里——只要这个 layer 干净，
// 渲染端再怎么传 reactive 对象都不会炸。
function cleanForIpc<T>(value: T): T {
  // string / number / undefined / null 直接返回，避免无谓 stringify 开销
  if (value === undefined || value === null) return value
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch (err) {
    console.error('[preload] cleanForIpc failed', err)
    return value
  }
}

const api = {
  // 连接控制
  startConnection: (roomId: string) => ipcRenderer.invoke(IpcChannels.AppStart, roomId),
  stopConnection: () => ipcRenderer.invoke(IpcChannels.AppStop),
  getStatus: () => ipcRenderer.invoke(IpcChannels.AppStatus),

  // 配置 · 房间
  getRoom: () => ipcRenderer.invoke(IpcChannels.ConfigGetRoom),
  setRoomId: (id: string) => ipcRenderer.invoke(IpcChannels.ConfigSetRoom, id),

  // 配置 · B 站登录态（高级）
  getBilibiliAuth: () => ipcRenderer.invoke(IpcChannels.ConfigGetBilibiliAuth),
  patchBilibiliAuth: (patch: Record<string, string>) =>
    ipcRenderer.invoke(IpcChannels.ConfigPatchBilibiliAuth, cleanForIpc(patch)),

  // 配置 · TTS
  getTts: () => ipcRenderer.invoke(IpcChannels.ConfigGetTts),
  patchTts: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcChannels.ConfigPatchTts, cleanForIpc(patch)),
  ttsTest: (text?: string) => ipcRenderer.invoke(IpcChannels.TtsTest, text),
  ttsVoiceList: () => ipcRenderer.invoke(IpcChannels.TtsVoiceList),

  // Overlay
  getOverlayPort: () => ipcRenderer.invoke(IpcChannels.ConfigGetOverlayPort),
  getOverlayUrl: () => ipcRenderer.invoke(IpcChannels.OverlayUrl),
  getOverlayStatus: () => ipcRenderer.invoke(IpcChannels.OverlayStatus),
  retryOverlay: () => ipcRenderer.invoke(IpcChannels.OverlayRetry),
  onOverlayStatus: (cb: (s: unknown) => void) => {
    const handler = (_: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on(IpcChannels.OverlayStatusUpdate, handler)
    return () => ipcRenderer.removeListener(IpcChannels.OverlayStatusUpdate, handler)
  },

  // 弹幕悬浮窗（独立 BrowserWindow）
  danmuOverlayOpen: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayOpen),
  danmuOverlayClose: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayClose),
  danmuOverlayToggle: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayToggle),
  danmuOverlayPinToggle: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayPinToggle),
  danmuOverlayStatus: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayStatus),
  getDanmuOverlaySettings: () => ipcRenderer.invoke(IpcChannels.DanmuOverlayGetSettings),
  onDanmuOverlayStatus: (cb: (s: { enabled: boolean; pinned: boolean }) => void) => {
    const handler = (_: IpcRendererEvent, s: { enabled: boolean; pinned: boolean }): void => cb(s)
    ipcRenderer.on(IpcChannels.DanmuOverlayStatusUpdate, handler)
    return () => ipcRenderer.removeListener(IpcChannels.DanmuOverlayStatusUpdate, handler)
  },
  onDanmuOverlayPinned: (cb: (s: { pinned: boolean }) => void) => {
    const handler = (_: IpcRendererEvent, s: { pinned: boolean }): void => cb(s)
    ipcRenderer.on(IpcChannels.DanmuOverlayPinnedUpdate, handler)
    return () => ipcRenderer.removeListener(IpcChannels.DanmuOverlayPinnedUpdate, handler)
  },
  onDanmuOverlayEvent: (cb: (item: unknown) => void) => {
    const handler = (_: IpcRendererEvent, item: unknown): void => cb(item)
    ipcRenderer.on(IpcChannels.DanmuOverlayEvent, handler)
    return () => ipcRenderer.removeListener(IpcChannels.DanmuOverlayEvent, handler)
  },
  onDanmuOverlayRoomStats: (
    cb: (stats: { watchedNum: number; watchedText: string }) => void
  ) => {
    const handler = (
      _: IpcRendererEvent,
      stats: { watchedNum: number; watchedText: string }
    ): void => cb(stats)
    ipcRenderer.on(IpcChannels.DanmuOverlayRoomStats, handler)
    return () => ipcRenderer.removeListener(IpcChannels.DanmuOverlayRoomStats, handler)
  },

  // 规则
  ruleList: () => ipcRenderer.invoke(IpcChannels.RuleList),
  ruleUpsert: (rule: unknown) =>
    ipcRenderer.invoke(IpcChannels.RuleUpsert, cleanForIpc(rule)),
  ruleDelete: (id: string) => ipcRenderer.invoke(IpcChannels.RuleDelete, id),

  // 弹幕抽奖
  lotteryStart: (config: unknown) =>
    ipcRenderer.invoke(IpcChannels.LotteryStart, cleanForIpc(config)),
  lotteryCancel: () => ipcRenderer.invoke(IpcChannels.LotteryCancel),
  lotteryDrawNow: () => ipcRenderer.invoke(IpcChannels.LotteryDrawNow),
  lotteryReset: () => ipcRenderer.invoke(IpcChannels.LotteryReset),
  lotteryStatus: () => ipcRenderer.invoke(IpcChannels.LotteryStatus),
  lotteryGetPreset: () => ipcRenderer.invoke(IpcChannels.LotteryGetPreset),
  lotterySavePreset: (preset: unknown) =>
    ipcRenderer.invoke(IpcChannels.LotterySavePreset, cleanForIpc(preset)),
  onLotteryStatus: (cb: (s: unknown) => void) => {
    const handler = (_: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on(IpcChannels.LotteryStatusUpdate, handler)
    return () => ipcRenderer.removeListener(IpcChannels.LotteryStatusUpdate, handler)
  },

  // 日志
  logRecent: (limit?: number) => ipcRenderer.invoke(IpcChannels.LogRecent, limit),
  logClear: () => ipcRenderer.invoke(IpcChannels.LogClear),

  // 主→渲染 推送订阅
  onLog: (cb: (entry: unknown) => void) => {
    const handler = (_: IpcRendererEvent, entry: unknown): void => cb(entry)
    ipcRenderer.on(IpcChannels.LogAppend, handler)
    return () => ipcRenderer.removeListener(IpcChannels.LogAppend, handler)
  },
  onStatus: (cb: (s: unknown) => void) => {
    const handler = (_: IpcRendererEvent, s: unknown): void => cb(s)
    ipcRenderer.on(IpcChannels.AppStatusUpdate, handler)
    return () => ipcRenderer.removeListener(IpcChannels.AppStatusUpdate, handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (err) {
    console.error('preload contextBridge expose failed', err)
  }
} else {
  ;(window as unknown as { electron: typeof electronAPI }).electron = electronAPI
  ;(window as unknown as { api: typeof api }).api = api
}

export type Api = typeof api
