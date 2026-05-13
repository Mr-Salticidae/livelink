import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { bus } from './events/bus'
import { BilibiliAdapter } from './platform/bilibili'
import { RuleEngine } from './rules/engine'
import { ActionDispatcher } from './actions/dispatcher'
import { TTSPlayer } from './actions/tts'
import { OverlayBroadcaster } from './actions/overlay'
import { LogSink } from './actions/log'
import { OverlayServer } from './overlay-server/server'
import { OverlayController } from './overlay-controller'
import { DanmuOverlayWindow } from './danmu-overlay-window'
import { GiftService } from './services/gift-config'
import { BlindboxStore } from './services/blindbox-store'
import { LotteryService } from './services/lottery'
import { AppConfig } from './config/store'
import { registerIpcHandlers } from './ipc'
import { IpcChannels, type ConnectionStatus } from '../shared/ipc-channels'

let mainWindow: BrowserWindow | null = null
const status: { current: ConnectionStatus } = { current: { state: 'idle' } }

// ─── 单例服务装配 ─────────────────────────────────────────────
const config = new AppConfig()
const log = new LogSink(500)
const ttsPlayer = new TTSPlayer()
ttsPlayer.setConfig(config.getTts())

const overlayBroadcaster = new OverlayBroadcaster()
const overlayServer = new OverlayServer()
// GiftService 在 app.whenReady 之前不能调 getPath('userData')，cacheDir 推迟到 ready 后注入
let giftService: GiftService | null = null
const overlayController = new OverlayController(
  overlayServer,
  overlayBroadcaster,
  config,
  join(__dirname, '../renderer'),
  () => giftService
)

const adapter = new BilibiliAdapter()
const blindboxStore = new BlindboxStore()
const danmuOverlay = new DanmuOverlayWindow(config, bus, join(__dirname, '../renderer'))
const lottery = new LotteryService(bus, overlayBroadcaster)
const dispatcher = new ActionDispatcher({
  tts: ttsPlayer,
  overlay: overlayBroadcaster,
  log,
  blindboxStore,
  getCurrentRoomId: () => adapter.currentRoomId
})
const engine = new RuleEngine({ bus, dispatcher })

// adapter → bus → engine → dispatcher → (tts / overlay / log)
adapter.on((e) => bus.emit('event', e))
engine.attach()
engine.setRules(config.getRules())

// 原始事件无条件写日志（不经规则）。让 Logs 页反映直播间实际发生的所有事，
// 不再只显示规则命中的。规则命中的 LogAction 还会在此之上叠加额外的日志。
bus.on('event', (e) => log.writeRawEvent(e))
// 盲盒开盒事件持久化到 blindbox-store（按 room 隔离）
bus.on('event', (e) => {
  if (e.kind !== 'blindbox.opened') return
  const roomId = adapter.currentRoomId
  if (roomId == null) return
  blindboxStore.record(roomId, e)
})

// OBS 弹幕信息板：系统级 overlay 推送（不走规则引擎，避免污染用户规则集）。
// enabled=false 时不 broadcast，开关由 Home 页 toggle 控制
bus.on('event', (e) => {
  const cfg = config.getDanmuBoard()
  if (!cfg.enabled) return
  if (e.kind === 'danmu.received') {
    overlayBroadcaster.broadcast({
      kind: 'danmu.board.item',
      event: e
    })
  } else if (e.kind === 'gift.received' && cfg.showGift) {
    overlayBroadcaster.broadcast({
      kind: 'danmu.board.item',
      event: e
    })
  }
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'LiveLink',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    // Bug 6 防御：即使 parent 关系出问题，也强制 destroy audioWindow，
    // 避免它独立存活导致 window-all-closed 不触发，进程驻留
    ttsPlayer.dispose()
    ttsPlayer.setParentWindow(null)
    mainWindow = null
  })

  // Bug 6 主修复：把 TTS 的 audioWindow 挂为主窗口子窗口，
  // 主窗口关闭时 Electron 自动销毁所有子窗口 → window-all-closed 触发 → app.quit()
  ttsPlayer.setParentWindow(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // vite 多入口配置下根路径下没文件，要拼上具体入口路径
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/src/renderer/index.html')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/src/renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('io.jspider.livelink')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // overlay 状态变更时推送到渲染端（启动失败、retry 中、retry 成功都触发）
  overlayController.setOnChange(() => {
    mainWindow?.webContents.send(IpcChannels.OverlayStatusUpdate, overlayController.getState())
  })

  // GiftService 必须在 app.whenReady 之后才能拿 userData 路径。先建实例，再异步 refresh
  giftService = new GiftService({ cacheDir: join(app.getPath('userData'), 'gift-cache') })
  await giftService.start().catch((err) => {
    console.warn('[main] GiftService start failed (non-fatal):', err)
  })

  try {
    await overlayController.start()
  } catch (err) {
    // 失败已经在 controller 里记 fatalError，UI 会显示错误条 + 重试按钮，不阻断应用启动
    console.error('[main] overlay start failed (fatal recorded)', err)
  }

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
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
  })

  createWindow()

  // 上次会话开着的话，启动时自动恢复（持久化记忆）
  if (config.getDanmuOverlay().enabled) {
    danmuOverlay.open()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void cleanup().finally(() => app.quit())
  }
})

async function cleanup(): Promise<void> {
  try {
    await adapter.disconnect()
  } catch (err) {
    console.error('[main] adapter disconnect failed', err)
  }
  try {
    await overlayServer.stop()
  } catch (err) {
    console.error('[main] overlayServer stop failed', err)
  }
  if (giftService) {
    try {
      await giftService.stop()
    } catch (err) {
      console.error('[main] giftService stop failed', err)
    }
  }
  try {
    danmuOverlay.dispose()
  } catch (err) {
    console.error('[main] danmuOverlay dispose failed', err)
  }
  try {
    lottery.dispose()
  } catch (err) {
    console.error('[main] lottery dispose failed', err)
  }
  ttsPlayer.dispose()
  engine.detach()
}
