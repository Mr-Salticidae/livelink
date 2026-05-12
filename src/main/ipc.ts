import { ipcMain, type BrowserWindow } from 'electron'
import { IpcChannels, type ConnectionStatus } from '../shared/ipc-channels'
import type { BilibiliAdapter } from './platform/bilibili'
import type { RuleEngine } from './rules/engine'
import { TTSPlayer, VOICE_OPTIONS, type TTSConfig } from './actions/tts'
import type { OverlayServer } from './overlay-server/server'
import type { AppConfig } from './config/store'
import type { LogSink, LogEntry } from './actions/log'
import type { Rule } from './rules/types'
import { toFriendlyError } from './errors/friendly'

export interface IpcDeps {
  getMainWindow: () => BrowserWindow | null
  adapter: BilibiliAdapter
  engine: RuleEngine
  ttsPlayer: TTSPlayer
  overlayServer: OverlayServer
  config: AppConfig
  log: LogSink
  status: { current: ConnectionStatus }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { adapter, engine, ttsPlayer, overlayServer, config, log, status } = deps

  function pushStatus(next: ConnectionStatus): void {
    status.current = next
    deps.getMainWindow()?.webContents.send(IpcChannels.AppStatusUpdate, next)
  }

  // ─── 连接控制 ───────────────────────────────────────────────
  ipcMain.handle(IpcChannels.AppStart, async (_e, roomInput: string) => {
    if (!roomInput || String(roomInput).trim() === '') {
      const err = {
        code: 'INPUT',
        message: '房间号要填数字，比如 21452505。如果你只有直播间链接，复制粘贴进来就行。'
      }
      pushStatus({ state: 'error', code: err.code, message: err.message })
      throw new Error(err.message)
    }
    pushStatus({ state: 'validating', roomInput: String(roomInput) })
    try {
      await adapter.connect(roomInput)
      const rid = adapter.currentRoomId ?? 0
      config.setRoomId(String(roomInput))
      pushStatus({ state: 'connected', roomId: rid })
      return { ok: true, roomId: rid }
    } catch (err) {
      const friendly = toFriendlyError(err)
      pushStatus({ state: 'error', code: friendly.code, message: friendly.message })
      throw new Error(friendly.message)
    }
  })

  ipcMain.handle(IpcChannels.AppStop, async () => {
    await adapter.disconnect()
    pushStatus({ state: 'idle' })
    return { ok: true }
  })

  ipcMain.handle(IpcChannels.AppStatus, async () => status.current)

  // ─── 配置 ────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.ConfigGetRoom, () => config.getRoom())
  ipcMain.handle(IpcChannels.ConfigSetRoom, (_e, id: string) => {
    config.setRoomId(id)
    return config.getRoom()
  })

  ipcMain.handle(IpcChannels.ConfigGetTts, () => config.getTts())
  ipcMain.handle(IpcChannels.ConfigPatchTts, (_e, patch: Partial<TTSConfig>) => {
    const next = config.patchTts(patch)
    ttsPlayer.setConfig(next)
    return next
  })

  ipcMain.handle(IpcChannels.ConfigGetOverlayPort, () => overlayServer.getPort())
  ipcMain.handle(IpcChannels.OverlayUrl, () => overlayServer.getOverlayUrl())

  // ─── 规则 ────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.RuleList, () => config.getRules())
  ipcMain.handle(IpcChannels.RuleUpsert, (_e, rule: Rule) => {
    const list = config.upsertRule(rule)
    engine.upsertRule(rule)
    return list
  })
  ipcMain.handle(IpcChannels.RuleDelete, (_e, id: string) => {
    const list = config.removeRule(id)
    engine.removeRule(id)
    return list
  })

  // ─── TTS ────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.TtsTest, async (_e, text?: string) => {
    try {
      await ttsPlayer.test(text)
      return { ok: true }
    } catch (err) {
      const friendly = toFriendlyError(err)
      throw new Error(friendly.message)
    }
  })
  ipcMain.handle(IpcChannels.TtsVoiceList, () => VOICE_OPTIONS)

  // ─── 日志 ────────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.LogRecent, (_e, limit?: number) => log.recent(limit))
  ipcMain.handle(IpcChannels.LogClear, () => {
    log.clear()
    return { ok: true }
  })

  log.subscribe((entry: LogEntry) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.LogAppend, entry)
  })
}
