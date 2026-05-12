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
const overlayController = new OverlayController(
  overlayServer,
  overlayBroadcaster,
  config,
  join(__dirname, '../renderer')
)

const adapter = new BilibiliAdapter()
const dispatcher = new ActionDispatcher({ tts: ttsPlayer, overlay: overlayBroadcaster, log })
const engine = new RuleEngine({ bus, dispatcher })

// adapter → bus → engine → dispatcher → (tts / overlay / log)
adapter.on((e) => bus.emit('event', e))
engine.attach()
engine.setRules(config.getRules())

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
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
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
    config,
    log,
    status
  })

  createWindow()

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
  ttsPlayer.dispose()
  engine.detach()
}
