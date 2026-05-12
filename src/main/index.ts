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
import { AppConfig } from './config/store'
import { registerIpcHandlers } from './ipc'
import type { ConnectionStatus } from '../shared/ipc-channels'

let mainWindow: BrowserWindow | null = null
const status: { current: ConnectionStatus } = { current: { state: 'idle' } }

// ─── 单例服务装配 ─────────────────────────────────────────────
const config = new AppConfig()
const log = new LogSink(500)
const ttsPlayer = new TTSPlayer()
ttsPlayer.setConfig(config.getTts())

const overlayBroadcaster = new OverlayBroadcaster()
const overlayServer = new OverlayServer()

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

async function startBackgroundServices(): Promise<void> {
  // OverlayServer 服务的静态目录指向 build 后的 renderer
  // dev 模式下若 out/renderer 不存在，OverlayServer 会返回 503 + 提示页面
  const rendererDir = join(__dirname, '../renderer')
  const port = await overlayServer.start({
    rendererDir,
    preferredPort: config.getOverlayPort()
  })
  config.setOverlayPort(port)
  overlayBroadcaster.setSender((msg) => overlayServer.broadcast(msg))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('io.jspider.livelink')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  try {
    await startBackgroundServices()
  } catch (err) {
    console.error('[main] startBackgroundServices failed', err)
  }

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    adapter,
    engine,
    ttsPlayer,
    overlayServer,
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
