import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc-channels'

const api = {
  // 连接控制
  startConnection: (roomId: string) => ipcRenderer.invoke(IpcChannels.AppStart, roomId),
  stopConnection: () => ipcRenderer.invoke(IpcChannels.AppStop),
  getStatus: () => ipcRenderer.invoke(IpcChannels.AppStatus),

  // 配置 · 房间
  getRoom: () => ipcRenderer.invoke(IpcChannels.ConfigGetRoom),
  setRoomId: (id: string) => ipcRenderer.invoke(IpcChannels.ConfigSetRoom, id),

  // 配置 · TTS
  getTts: () => ipcRenderer.invoke(IpcChannels.ConfigGetTts),
  patchTts: (patch: Record<string, unknown>) => ipcRenderer.invoke(IpcChannels.ConfigPatchTts, patch),
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

  // 规则
  ruleList: () => ipcRenderer.invoke(IpcChannels.RuleList),
  ruleUpsert: (rule: unknown) => ipcRenderer.invoke(IpcChannels.RuleUpsert, rule),
  ruleDelete: (id: string) => ipcRenderer.invoke(IpcChannels.RuleDelete, id),

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
