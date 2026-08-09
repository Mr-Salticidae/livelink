import { ipcMain, net, powerMonitor, type BrowserWindow } from 'electron'
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
import type { VotingService, VotingConfig } from './services/voting'
import type { HorseRaceService, HorseRaceConfig } from './services/horse-race'
import { setHorseRaceInitialBalanceFallback } from './services/horse-race'
import type { GuessingService, GuessingConfig } from './services/guessing'
import { setInitialBalanceFallback } from './services/guessing'
import type { PetService } from './services/pets'
import type { AiReplyService } from './services/ai-reply'
import type { DanmuReaderService } from './services/danmu-reader'
import type { DanmuReaderConfig } from '../shared/danmu-reader'
import type { SongRequestService } from './services/song-request'
import type { SongRequestConfig } from '../shared/song-request'
import type { WalletStore } from './services/wallet-store'
import type { GuessingGlobalConfig } from './config/store'
import type { PetConfig } from '../shared/pets'
import type { AiReplyConfig } from '../shared/ai-reply'
import type { OverlayThemeConfig } from '../shared/overlay-theme'
import type { DanmuBoardConfig, DanmuOverlaySettings } from '../shared/danmu-display'
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
  voting: VotingService
  horseRace: HorseRaceService
  guessing: GuessingService
  pets: PetService
  aiReply: AiReplyService
  danmuReader: DanmuReaderService
  songRequest: SongRequestService
  wallet: WalletStore
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
    voting,
    horseRace,
    guessing,
    pets,
    aiReply,
    danmuReader,
    songRequest,
    wallet,
    config,
    log,
    status
  } = deps

  function pushStatus(next: ConnectionStatus): void {
    status.current = next
    deps.getMainWindow()?.webContents.send(IpcChannels.AppStatusUpdate, next)
  }

  // ─── 重连策略 ───────────────────────────────────────────────
  //
  // 设计要点（都是为了修"意外断网后不停重连但永远连不上"）：
  //  1. 每次重试都走 adapter.reconnect()，它会拆掉旧连接并用全新 token 重建。
  //     旧实现调的是 lib 的 listener.reconnect()，复用失效 token，注定连不上。
  //  2. 只有一个 timer 句柄，且赋值前一定先 clear。旧实现在 setTimeout 回调里
  //     用 watchdog 覆盖了同一个变量却没 clear，导致游离定时器越攒越多，
  //     "停止"也清不掉它们 —— 这就是那个永不停歇的重连循环。
  //  3. epoch：每次 clearReconnect / 用户操作都自增，异步回调认领不到就直接退出。
  //  4. 不再等 watchdog 猜结果——reconnect() 的 Promise 就是结果。
  //  5. 断网期间不放弃。旧实现试 2 次（共 20s）就永久放弃，而拔网线 / 路由器重启
  //     动辄几分钟。改成指数退避 + 上限 60s 持续重试，并区分"本机没网"和
  //     "连得上网但连不上 B 站"，UI 上如实告诉主播现在是哪种。
  const RECONNECT_BASE_DELAY_MS = 3_000
  const RECONNECT_MAX_DELAY_MS = 60_000
  // 本机网络就是断的时候，没必要按退避去捶 B 站，短间隔轻量探测即可
  const OFFLINE_POLL_MS = 5_000

  // 连续失败到这个次数后，把底层原因也带进状态条。
  // 一直只显示"正在重连…"的话，SESSDATA 过期这种永远好不了的情况主播会干等
  const SHOW_CAUSE_AFTER_ATTEMPTS = 3

  let reconnectEpoch = 0
  let reconnectAttempt = 0
  let reconnectTimer: NodeJS.Timeout | null = null
  let reconnecting = false
  let lastFailureMessage = ''

  function clearReconnect(): void {
    reconnectEpoch += 1 // 让所有在途回调失效
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    reconnectAttempt = 0
    reconnecting = false
    lastFailureMessage = ''
  }

  /** 指数退避：3s、6s、12s、24s、48s，之后固定 60s */
  function backoffDelay(attempt: number): number {
    const raw = RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)
    return Math.min(raw, RECONNECT_MAX_DELAY_MS)
  }

  function isOnline(): boolean {
    try {
      return net.isOnline()
    } catch {
      return true // 拿不准就当在线，让真正的连接尝试去暴露问题
    }
  }

  function scheduleReconnect(roomId: number, epoch: number, immediate = false): void {
    if (epoch !== reconnectEpoch) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const offline = !isOnline()
    const delay = immediate ? 0 : offline ? OFFLINE_POLL_MS : backoffDelay(reconnectAttempt + 1)

    if (offline) {
      pushStatus({
        state: 'reconnecting',
        roomId,
        message: '网络已断开，等网络恢复后会自动重连…'
      })
    } else {
      const base =
        reconnectAttempt === 0
          ? '连接断了，正在重连…'
          : `连接断了，${Math.round(delay / 1000)} 秒后重连（已试 ${reconnectAttempt} 次）…`
      // 试了几次还不行，就把真实原因摊开说，别让主播盯着"重连中"干等
      const cause =
        reconnectAttempt >= SHOW_CAUSE_AFTER_ATTEMPTS && lastFailureMessage
          ? ` 原因：${lastFailureMessage}`
          : ''
      pushStatus({ state: 'reconnecting', roomId, message: base + cause })
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void runReconnect(roomId, epoch)
    }, delay)
  }

  async function runReconnect(roomId: number, epoch: number): Promise<void> {
    if (epoch !== reconnectEpoch) return
    // 本机还没网就别浪费一次尝试，继续轻量轮询等网络回来
    if (!isOnline()) {
      scheduleReconnect(roomId, epoch)
      return
    }
    if (reconnecting) return
    reconnecting = true
    reconnectAttempt += 1
    pushStatus({
      state: 'reconnecting',
      roomId,
      message: `正在重连（第 ${reconnectAttempt} 次）…`
    })
    try {
      await adapter.reconnect()
      // 成功与否以 adapter 的 opened 状态事件为准，这里不抢着推 connected
    } catch (err) {
      if (epoch !== reconnectEpoch) return
      const friendly = toFriendlyError(err)
      lastFailureMessage = friendly.message
      console.warn(`[reconnect] 第 ${reconnectAttempt} 次失败：${friendly.message}`)
      reconnecting = false // 先放行，scheduleReconnect 里不会再被本次占用挡住
      scheduleReconnect(roomId, epoch)
    } finally {
      reconnecting = false
    }
  }

  /** 被动断线入口：从 connected / reconnecting 状态进入重连流程 */
  function beginReconnect(): void {
    const cur = status.current
    if (cur.state !== 'connected' && cur.state !== 'reconnecting') return
    const roomId = cur.roomId
    if (reconnecting || reconnectTimer) return // 已经在重连流程里了，别叠加
    reconnectEpoch += 1
    reconnectAttempt = 0
    scheduleReconnect(roomId, reconnectEpoch)
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
      beginReconnect()
      return
    }
    // error：只 console，不直接降级状态——很多 error 是非致命的（心跳失败 / 单条解码失败等）
    console.error('[adapter status] error:', e.message)
  })

  // 网络恢复 / 睡眠唤醒时立刻试一次，不用干等退避走完。
  // 合盖再打开、拔插网线是主播最常遇到的两种断连场景
  function kickReconnectNow(reason: string): void {
    const cur = status.current
    if (cur.state !== 'reconnecting') return
    if (reconnecting) return
    console.log(`[reconnect] ${reason}，立即重试`)
    reconnectEpoch += 1
    scheduleReconnect(cur.roomId, reconnectEpoch, true)
  }

  powerMonitor.on('resume', () => kickReconnectNow('系统从睡眠中唤醒'))
  powerMonitor.on('unlock-screen', () => kickReconnectNow('屏幕解锁'))

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
    // 先无条件拆掉可能还在的旧连接。主播在"断线重连中"直接点开始是很常见的操作，
    // 不这么做的话 adapter 会抛"已经连接了，先点停止"，等于逼他多点一次
    try {
      await adapter.disconnect()
    } catch (err) {
      console.warn('[AppStart] 清理旧连接失败（忽略）', err)
    }
    // 换房间 / 重开时清掉上一场残留的播报队列和朗读冷却记录
    ttsPlayer.stop()
    danmuReader.resetRuntime()
    // 点歌队列本身按房间存盘、不清；这里清的是内存里的冷却记录和房间缓存
    songRequest.resetRuntime()
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
    // 点了停止就不该再听到播报。队列里可能还压着十几条礼物感谢和弹幕，
    // 不清的话会在断开后继续念上一两分钟
    ttsPlayer.stop()
    danmuReader.resetRuntime()
    songRequest.resetRuntime()
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
  ipcMain.handle(
    IpcChannels.DanmuOverlayPatchSettings,
    (_e, patch: Partial<DanmuOverlaySettings>) => danmuOverlay.patchSettings(patch)
  )

  // 把弹幕窗状态变化推到主窗口 UI（开关 toggle UI 状态）
  danmuOverlay.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.DanmuOverlayStatusUpdate, s)
  })

  // ─── OBS 弹幕信息板 ─────────────────────────────────────────
  ipcMain.handle(IpcChannels.DanmuBoardGet, () => config.getDanmuBoard())
  ipcMain.handle(IpcChannels.DanmuBoardPatch, (_e, patch: Partial<DanmuBoardConfig>) => {
    const next = config.patchDanmuBoard(patch)
    // 经 controller 广播（带上 editing 瞬时标记），所有 OBS 浏览器源实时刷新
    overlayController.notifyBoardConfigChanged()
    return next
  })
  // 装修预览模式（OBS 板子装满假弹幕显示满载效果，用于直播间装修对齐）
  ipcMain.handle(IpcChannels.DanmuBoardSetPreviewFull, (_e, on: boolean) => {
    overlayController.setPreviewFull(Boolean(on))
    return { previewFull: overlayController.isPreviewFull() }
  })
  ipcMain.handle(IpcChannels.OverlayThemeGet, () => config.getOverlayTheme())
  ipcMain.handle(IpcChannels.OverlayThemePatch, (_e, patch: Partial<OverlayThemeConfig>) => {
    const next = config.patchOverlayTheme(patch)
    overlayController.notifyThemeChanged()
    return next
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

  // ─── 互动投票 ──────────────────────────────────────────────
  ipcMain.handle(IpcChannels.VotingStart, (_e, c: VotingConfig) => {
    const r = voting.start(c)
    if (!r.ok) throw new Error(r.error)
    config.setVotingPreset(c)
    return voting.getState()
  })
  ipcMain.handle(IpcChannels.VotingCancel, () => {
    const r = voting.cancel()
    if (!r.ok) throw new Error(r.error)
    return voting.getState()
  })
  ipcMain.handle(IpcChannels.VotingEndNow, () => {
    const r = voting.endNow()
    if (!r.ok) throw new Error(r.error)
    return voting.getState()
  })
  ipcMain.handle(IpcChannels.VotingReset, () => {
    voting.reset()
    return voting.getState()
  })
  ipcMain.handle(IpcChannels.VotingStatus, () => voting.getState())
  ipcMain.handle(IpcChannels.VotingGetPreset, () => config.getVotingPreset())

  voting.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.VotingStatusUpdate, s)
  })

  // ─── 赛马（1.3+ 接入哈松币押注） ────────────────────────────
  // 同步 initialBalance 到 service 的 fallback（押注时首次开户用）
  setHorseRaceInitialBalanceFallback(config.getGuessing().initialBalance)

  ipcMain.handle(IpcChannels.HorseRaceStart, (_e, c: HorseRaceConfig) => {
    const g = config.getGuessing()
    setHorseRaceInitialBalanceFallback(g.initialBalance)
    const r = horseRace.start(c, g.currencyName)
    if (!r.ok) throw new Error(r.error)
    config.setHorseRacePreset(c)
    return horseRace.getState()
  })
  ipcMain.handle(IpcChannels.HorseRaceCancel, () => {
    const r = horseRace.cancel()
    if (!r.ok) throw new Error(r.error)
    return horseRace.getState()
  })
  ipcMain.handle(IpcChannels.HorseRaceStartNow, () => {
    const r = horseRace.startNow()
    if (!r.ok) throw new Error(r.error)
    return horseRace.getState()
  })
  ipcMain.handle(IpcChannels.HorseRaceReset, () => {
    horseRace.reset()
    return horseRace.getState()
  })
  ipcMain.handle(IpcChannels.HorseRaceStatus, () => horseRace.getState())
  ipcMain.handle(IpcChannels.HorseRaceGetPreset, () => config.getHorseRacePreset())

  horseRace.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.HorseRaceStatusUpdate, s)
  })

  // ─── 竞猜（哈松币押注） ─────────────────────────────────────
  // 把 currency.initialBalance 同步到 GuessingService 的 fallback（押注时首次开户用）
  setInitialBalanceFallback(config.getGuessing().initialBalance)

  ipcMain.handle(IpcChannels.GuessingStart, (_e, c: GuessingConfig) => {
    const g = config.getGuessing()
    setInitialBalanceFallback(g.initialBalance)
    const r = guessing.start(c, g.currencyName)
    if (!r.ok) throw new Error(r.error)
    return guessing.getState()
  })
  ipcMain.handle(IpcChannels.GuessingLockNow, () => {
    const r = guessing.lockNow()
    if (!r.ok) throw new Error(r.error)
    return guessing.getState()
  })
  ipcMain.handle(IpcChannels.GuessingSettle, (_e, winnerKey: string) => {
    const r = guessing.settle(winnerKey)
    if (!r.ok) throw new Error(r.error)
    return guessing.getState()
  })
  ipcMain.handle(IpcChannels.GuessingCancel, () => {
    const r = guessing.cancel()
    if (!r.ok) throw new Error(r.error)
    return guessing.getState()
  })
  ipcMain.handle(IpcChannels.GuessingReset, () => {
    guessing.reset()
    return guessing.getState()
  })
  ipcMain.handle(IpcChannels.GuessingStatus, () => guessing.getState())
  ipcMain.handle(IpcChannels.GuessingGetConfig, () => config.getGuessing())
  ipcMain.handle(IpcChannels.GuessingPatchConfig, (_e, patch: Partial<GuessingGlobalConfig>) => {
    const next = config.patchGuessing(patch)
    setInitialBalanceFallback(next.initialBalance)
    return next
  })
  ipcMain.handle(
    IpcChannels.GuessingTopBalance,
    (_e, limit?: number) => {
      const rid = adapter.currentRoomId
      if (rid == null) return []
      return wallet.topByBalance(rid, limit ?? 10)
    }
  )
  ipcMain.handle(
    IpcChannels.GuessingQueryWallet,
    (_e, uid: string, uname: string) => {
      const rid = adapter.currentRoomId
      if (rid == null) return null
      return wallet.query(rid, uid, uname)
    }
  )

  guessing.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.GuessingStatusUpdate, s)
  })

  // ─── 养宠（哈松币长期养成） ─────────────────────────────────
  ipcMain.handle(IpcChannels.PetStatus, () => pets.getState())
  ipcMain.handle(IpcChannels.PetConfigGet, () => config.getPets())
  ipcMain.handle(IpcChannels.PetConfigPatch, (_e, patch: Partial<PetConfig>) => {
    const next = config.patchPets(patch)
    pets.pushDock()
    deps.getMainWindow()?.webContents.send(IpcChannels.PetStatusUpdate, pets.getState())
    return next
  })
  ipcMain.handle(IpcChannels.PetAdopt, (_e, speciesInput: string) => {
    const rid = adapter.currentRoomId
    if (rid == null) throw new Error('直播间未连接')
    const r = pets.adopt('0', '主播预览', speciesInput || '1')
    if (!r.ok) throw new Error(r.error)
    return r.owner
  })
  ipcMain.handle(IpcChannels.PetFeed, (_e, uid: string, uname: string, amount?: number) => {
    const r = pets.feed(uid, uname, amount)
    if (!r.ok) throw new Error(r.error)
    return r.owner
  })
  ipcMain.handle(IpcChannels.PetSetPrimary, (_e, uid: string, uname: string, input: string) => {
    const r = pets.setPrimary(uid, uname, input)
    if (!r.ok) throw new Error(r.error)
    return r.owner
  })
  ipcMain.handle(IpcChannels.PetTop, (_e, limit?: number) => pets.top(limit ?? 20))
  ipcMain.handle(IpcChannels.PetUserGet, (_e, uid: string, uname: string) =>
    pets.getUser(uid, uname)
  )

  pets.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.PetStatusUpdate, s)
  })

  // ─── AI 智能回复（DeepSeek，主播自备 Key） ───────────────────
  ipcMain.handle(IpcChannels.AiReplyConfigGet, () => config.getAiReplyPublic())
  ipcMain.handle(IpcChannels.AiReplyConfigPatch, (_e, patch: Partial<AiReplyConfig>) =>
    config.patchAiReply(patch)
  )
  ipcMain.handle(IpcChannels.AiReplyTest, async (_e, prompt?: string) => {
    const reply = await aiReply.test(prompt || '用一句话介绍你自己')
    return { reply }
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
  ipcMain.handle(
    IpcChannels.TtsTest,
    async (_e, payload?: string | { text?: string; voice?: string }) => {
      // 兼容老调用：传 string 当 text 用；传对象可同时指定 voice 预听
      const text = typeof payload === 'string' ? payload : payload?.text
      const voice = typeof payload === 'object' ? payload?.voice : undefined
      try {
        await ttsPlayer.test(text, voice)
        return { ok: true }
      } catch (err) {
        const friendly = toFriendlyError(err)
        throw new Error(friendly.message)
      }
    }
  )
  ipcMain.handle(IpcChannels.TtsVoiceList, () => VOICE_OPTIONS)
  // 主播喊停：清空整条播报队列并打断正在念的那句
  ipcMain.handle(IpcChannels.TtsStop, () => {
    ttsPlayer.stop()
    return { ok: true }
  })
  // 只跳过当前这句，队列里剩下的继续念
  ipcMain.handle(IpcChannels.TtsSkip, () => {
    ttsPlayer.skip()
    return { ok: true }
  })
  ipcMain.handle(IpcChannels.TtsStats, () => ttsPlayer.getStats())

  // ─── 弹幕朗读 ────────────────────────────────────────────────
  ipcMain.handle(IpcChannels.DanmuReaderGet, () => config.getDanmuReader())
  ipcMain.handle(IpcChannels.DanmuReaderPatch, (_e, patch: Partial<DanmuReaderConfig>) => {
    return config.patchDanmuReader(patch)
  })
  ipcMain.handle(IpcChannels.DanmuReaderStats, () => danmuReader.getStats())
  // 试听：拿一条示例弹幕跑完整净化 + 模板，再用朗读音色念出来，
  // 让主播在设置页就能听到"这条弹幕最后会被念成什么样"
  ipcMain.handle(IpcChannels.DanmuReaderPreview, async (_e, sample?: string) => {
    const cfg = config.getDanmuReader()
    const result = danmuReader.preview(sample ?? '主播今天播到几点呀[妙][妙]')
    if (!result.spoken) return { ok: false, spoken: '', reason: result.reason }
    try {
      await ttsPlayer.test(result.spoken, cfg.voice || undefined)
      return { ok: true, spoken: result.spoken }
    } catch (err) {
      const friendly = toFriendlyError(err)
      throw new Error(friendly.message)
    }
  })

  // ─── 弹幕点歌台 ──────────────────────────────────────────────
  ipcMain.handle(IpcChannels.SongConfigGet, () => config.getSongRequest())
  ipcMain.handle(IpcChannels.SongConfigPatch, (_e, patch: Partial<SongRequestConfig>) => {
    const next = config.patchSongRequest(patch)
    // 配置里有 showBoard / boardLimit / boardCorner，改完必须立刻重推一次，
    // 否则 OBS 上的点歌板要等下一次有人点歌才更新
    songRequest.pushBoard()
    return next
  })
  ipcMain.handle(IpcChannels.SongState, () => songRequest.getState())
  ipcMain.handle(IpcChannels.SongSetOpen, (_e, open: boolean) => songRequest.setOpen(Boolean(open)))
  ipcMain.handle(IpcChannels.SongNext, () => songRequest.next())
  ipcMain.handle(IpcChannels.SongTop, (_e, id: string) => songRequest.moveTop(String(id)))
  ipcMain.handle(IpcChannels.SongRemove, (_e, id: string) => songRequest.remove(String(id)))
  ipcMain.handle(IpcChannels.SongClearQueue, () => songRequest.clearQueue())
  ipcMain.handle(IpcChannels.SongClearHistory, () => songRequest.clearHistory())
  ipcMain.handle(IpcChannels.SongAddByHost, (_e, title: string) => {
    const r = songRequest.addByHost(String(title ?? ''))
    if (!r.ok) throw new Error(r.message ?? '加歌失败')
    return songRequest.getState()
  })
  songRequest.onStatusChange((s) => {
    deps.getMainWindow()?.webContents.send(IpcChannels.SongStateUpdate, s)
  })

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
