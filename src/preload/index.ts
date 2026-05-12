import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '../shared/ipc-channels'

const api = {
  startConnection: (roomId: string) => ipcRenderer.invoke(IpcChannels.AppStart, roomId),
  stopConnection: () => ipcRenderer.invoke(IpcChannels.AppStop),
  getStatus: () => ipcRenderer.invoke(IpcChannels.AppStatus),

  configGet: <T = unknown>(key: string) => ipcRenderer.invoke(IpcChannels.ConfigGet, key) as Promise<T>,
  configSet: (key: string, value: unknown) => ipcRenderer.invoke(IpcChannels.ConfigSet, key, value),

  ruleList: () => ipcRenderer.invoke(IpcChannels.RuleList),
  ruleUpsert: (rule: unknown) => ipcRenderer.invoke(IpcChannels.RuleUpsert, rule),
  ruleDelete: (id: string) => ipcRenderer.invoke(IpcChannels.RuleDelete, id),

  ttsTest: (text?: string) => ipcRenderer.invoke(IpcChannels.TtsTest, text),
  getOverlayUrl: () => ipcRenderer.invoke(IpcChannels.OverlayUrl),

  onEventStream: (cb: (payload: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(IpcChannels.EventStream, handler)
    return () => ipcRenderer.removeListener(IpcChannels.EventStream, handler)
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
  // 退化场景，理论上不会触发
  ;(window as unknown as { electron: typeof electronAPI }).electron = electronAPI
  ;(window as unknown as { api: typeof api }).api = api
}

export type Api = typeof api
