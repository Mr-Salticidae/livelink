import { ipcMain, type BrowserWindow } from 'electron'
import { IpcChannels, type ConnectionStatus } from '../shared/ipc-channels'
import type { BilibiliAdapter } from './platform/bilibili'
import type { RuleEngine } from './rules/engine'
import { TTSPlayer, VOICE_OPTIONS, type TTSConfig } from './actions/tts'
import type { OverlayServer } from './overlay-server/server'
import type { OverlayController } from './overlay-controller'
import type { AppConfig, BilibiliAuth } from './config/store'
import type { LogSink, LogEntry } from './actions/log'
import type { Rule } from './rules/types'
import type { DanmuOverlayWindow } from './danmu-overlay-window'
import type { LotteryService, LotteryConfig } from './services/lottery'
import { toFriendlyError } from './errors/friendly'

export interface IpcDeps {
  getMainWindow: () => BrowserWindow | null
  adapter: BilibiliAdapter
  engine: RuleEngine
  ttsPlayer: TTSPlayer
  overlayServer: OverlayServer
  overlayController: OverlayController
  danmuOverlay: DanmuOverlayWindow
  lottery: LotteryService
  config: AppConfig
  log: LogSink
  status: { current: ConnectionStatus }
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const {
    adapter,
    engine,
    ttsPlayer,
    overlayServer,
    overlayController,
    danmuOverlay,
    lottery,
    config,
    log,
    status
  } = deps

  function pushStatus(next: ConnectionStatus): void {
    status.current = next
    deps.getMainWindow()?.webContents.send(IpcChannels.AppStatusUpdate, next)
  }

  // ─── 重连策略：被动断线后自动重试，5s → 15s → 放弃推 error ────
  const RECONNECT_DELAYS = [5_000, 15_000]
  const RECONNECT_WATCHDOG_MS = 8_000 // adapter.reconnect() 后等几秒没收到 opened 视为本次失败
  let reconnectAttempt = 0
  let reconnectTimer: NodeJS.Timeout | null = null

  function clearReconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectAttempt = 0
  }

  function scheduleReconnect(roomId: number): void {
    if (reconnectAttempt >= RECONNECT_DELAYS.length) {
      pushStatus({
        state: 'error',
        code: 'RECONNECT_FAILED',
        message: '连不上直播间，已停止重试。检查网络后重新点开始。'
      })
      clearReconnect()
      return
    }
    const delay = RECONNECT_DELAYS[reconnectAttempt]
    reconnectAttempt += 1
    pushStatus({
      state: 'reconnecting',
      roomId,
      message: `连接断了，${Math.round(delay / 1000)} 秒后第 ${reconnectAttempt} 次重连…`
    })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      adapter.reconnect()
      // watchdog：N 秒内没收到 opened 信号 → 进入下一轮
      reconnectTimer = setTimeout(() => scheduleReconnect(roomId), RECONNECT_WATCHDOG_MS)
    }, delay)
  }

  adapter.onStatus((e) => {
    if (e.kind === 'opened') {
      clearReconnect()
      pushStatus({ state: 'connected', roomId: e.roomId })
      return
    }
    if (e.kind === 'closed') {
      if (e.intended) {
        // 用户主动停，IPC AppStop 已经推 idle，这里别覆盖
        clearReconnect()
        return
      }
      // 被动断线：只在当前是 connected/reconnecting 时进入重连流程
      const cur = status.current
      if (cur.state !== 'connected' && cur.state !== 'reconnecting') return
      const roomId = cur.state === 'connected' || cur.state === 'reconnecting' ? cur.roomId : 0
      scheduleReconnect(roomId)
      return
    }
    // error：只 console，不直接降级状态——很多 error 是非致命的（心跳失败 / 单条解码失败等）
    console.error('[adapter status] error:', e.message)
  })

  // ─── 连接控制 ───────────────────────────────────────────────
  ipcMain.handle(IpcChannels.AppStart, async (_e, roomInput: string) => {
    if (!roomInput || String(roomInput).trim() === '') {
      const err = {
        code: 'INPUT',
        message: '房间号要填数字，比如 21452505。如果你只有直播间链接,复制粘贴进来就行。'
      }
      pushStatus({ state: 'error', code: err.code, message: err.message })
      throw new Error(err.message)
    }
    clearReconnect() // 用户重新开始连接，清掉旧的重连定时
    pushStatus({ state: 'validating', roomInput: String(roomInput) })
    try {
      // 把 B 站登录态（如有）一并传给 adapter，让 lib 用 SESSDATA 做 HTTP 预请求拿登录态 token
      const auth = config.getBilibiliAuth()
      await adapter.connect(roomInput, {
        sessdata: auth.sessdata || undefined,
        uid: auth.uid || undefined,
        buvid: auth.buvid || undefined
      })
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
    clearReconnect() // 用户在 reconnecting 状态点停止时，必须先取消重试
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

  ipcMain.handle(IpcChannels.ConfigGetBilibiliAuth, () => config.getBilibiliAuth())
  ipcMain.handle(IpcChannels.ConfigPatchBilibiliAuth, (_e, patch: Partial<BilibiliAuth>) =>
    config.patchBilibiliAuth(patch)
  )

  ipcMain.handle(IpcChannels.ConfigGetOverlayPort, () => overlayServer.getPort())
  ipcMain.handle(IpcChannels.OverlayUrl, () => overlayServer.getOverlayUrl())
  ipcMain.handle(IpcChannels.OverlayStatus, () => overlayController.getState())
  ipcMain.handle(IpcChannels.OverlayRetry, async () => overlayController.retry())

  // ─── 弹幕悬浮窗 ────────────────────────────────────────────
  ipcMain.handle(IpcChannels.DanmuOverlayOpen, () => {
    danmuOverlay.open()
    return danmuOverlay.getStatus()
  })
  ipcMain.handle(IpcChannels.DanmuOverlayClose, () => {
    danmuOverlay.close()
    return danmuOverlay.getStatus()
  })
  ipcMain.handle(IpcChannels.DanmuOverlayToggle, () => {
    danmuOverlay.toggle()
    return danmuOverlay.getStatus()
  })
  ipcMain.handle(IpcChannels.DanmuOverlayPinToggle, () => {
    danmuOverlay.togglePinned()
    return danmuOverlay.getStatus()
  })
  ipcMain.handle(IpcChannels.DanmuOverlayStatus, () => danmuOverlay.getStatus())
  ipcMain.handle(IpcChannels.DanmuOverlayGetSettings, () => danmuOverlay.getSettings())

  // 把弹幕窗状态变化推到主窗口 UI（开关 toggle UI 状态）
  danmuOverlay.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.DanmuOverlayStatusUpdate, s)
  })

  // ─── 弹幕抽奖 ──────────────────────────────────────────────
  ipcMain.handle(IpcChannels.LotteryStart, (_e, c: LotteryConfig) => {
    const r = lottery.start(c)
    if (!r.ok) throw new Error(r.error)
    // 启动成功后，把这次配置存为下次默认 preset
    config.setLotteryPreset(c)
    return lottery.getState()
  })
  ipcMain.handle(IpcChannels.LotteryCancel, () => {
    const r = lottery.cancel()
    if (!r.ok) throw new Error(r.error)
    return lottery.getState()
  })
  ipcMain.handle(IpcChannels.LotteryDrawNow, () => {
    const r = lottery.drawNow()
    if (!r.ok) throw new Error(r.error)
    return lottery.getState()
  })
  ipcMain.handle(IpcChannels.LotteryReset, () => {
    lottery.reset()
    return lottery.getState()
  })
  ipcMain.handle(IpcChannels.LotteryStatus, () => lottery.getState())
  ipcMain.handle(IpcChannels.LotteryGetPreset, () => config.getLotteryPreset())
  ipcMain.handle(IpcChannels.LotterySavePreset, (_e, preset: LotteryConfig) => {
    config.setLotteryPreset(preset)
    return config.getLotteryPreset()
  })

  // 抽奖状态变化推到主窗口（参与人数 / 倒计时结束 / 结果出来）
  lottery.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.LotteryStatusUpdate, s)
  })

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
