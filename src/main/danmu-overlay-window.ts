// 弹幕悬浮窗 —— 给单屏主播用：游戏全屏时也能瞟一眼实时弹幕 + 礼物
//
// 设计：
// - 独立的 BrowserWindow（不是 mainWindow 子窗口，因为主窗口关掉它要继续存活，
//   ttsPlayer 的 audio window 才是 mainWindow 子窗口）
// - alwaysOnTop + frame: false + transparent + skipTaskbar，主播全屏游戏时悬浮顶层
// - 位置 + 尺寸持久化到 AppConfig
// - 主进程过滤 bus 'event' 里的 danmu.received / gift.received，通过 webContents.send 推过去
// - 关掉这个窗不影响主应用其它部分

import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { AppConfig, DanmuOverlayConfig } from './config/store'
import type { Bus } from './events/bus'
import type { StandardEvent } from './platform/adapter'
import { IpcChannels } from '../shared/ipc-channels'

const DEFAULT_BOUNDS = { width: 320, height: 480 } as const
const MIN_WIDTH = 220
const MIN_HEIGHT = 200

export interface DanmuOverlayPushItem {
  id: string
  kind: 'danmu' | 'gift'
  uname: string
  content?: string
  giftName?: string
  num?: number
  guardLevel?: number
  isAnchor?: boolean
  fansMedalLevel?: number
}

export class DanmuOverlayWindow {
  private win: BrowserWindow | null = null
  private busUnsub: (() => void) | null = null

  constructor(
    private config: AppConfig,
    private bus: Bus,
    private rendererDir: string
  ) {}

  /** 是否当前在显示 */
  isOpen(): boolean {
    return this.win != null && !this.win.isDestroyed()
  }

  open(): void {
    if (this.isOpen()) {
      this.win!.show()
      this.win!.focus()
      return
    }

    const saved = this.config.getDanmuOverlay()
    const bounds = this.resolveBounds(saved)

    this.win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      // 'screen-saver' 比 'normal' 层级更高，能盖过游戏全屏（部分独占全屏游戏除外）
      // Windows 上 alwaysOnTop+screen-saver 是覆盖大多数全屏游戏的最稳组合
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    this.win.once('ready-to-show', () => this.win?.show())
    this.win.on('close', () => {
      this.persistBounds()
      this.detachBus()
      this.win = null
      // 通知主窗口刷新状态徽章
      this.notifyStatusChange()
    })
    // resize / move 时 throttle 写入 config，避免高频抖动
    const persistThrottled = throttle(() => this.persistBounds(), 500)
    this.win.on('resize', persistThrottled)
    this.win.on('move', persistThrottled)

    // 加载页面
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/src/danmu-overlay/index.html')
    } else {
      this.win.loadFile(join(this.rendererDir, 'src/danmu-overlay/index.html'))
    }

    this.attachBus()
    this.config.patchDanmuOverlay({ enabled: true })

    // 应用上次会话的 pinned 状态（可能上次直播时钉住了）
    if (saved.pinned) {
      // 注意：setMovable 等 API 在 win 还没 ready-to-show 时也能调，Electron 会缓存到首次 show
      this.applyPinned(true)
    }

    this.notifyStatusChange()
  }

  close(): void {
    if (!this.isOpen()) return
    this.win!.close() // 触发 'close' 事件做 cleanup
    this.config.patchDanmuOverlay({ enabled: false })
  }

  toggle(): void {
    if (this.isOpen()) this.close()
    else this.open()
  }

  /** 钉住 / 解钉。钉住后窗口不可拖动、不抢焦点（点击不偷走游戏焦点） */
  setPinned(pinned: boolean): void {
    this.config.patchDanmuOverlay({ pinned })
    this.applyPinned(pinned)
    // 推送当前 pinned 状态到子窗，让 UI 切换图钉图标 + 标题栏样式
    this.win?.webContents.send(IpcChannels.DanmuOverlayPinnedUpdate, { pinned })
    this.notifyStatusChange()
  }

  togglePinned(): void {
    const cur = this.config.getDanmuOverlay().pinned
    this.setPinned(!cur)
  }

  private applyPinned(pinned: boolean): void {
    if (!this.win || this.win.isDestroyed()) return
    // setMovable(false) 在 Windows / Linux 上有效；macOS 上 frameless 窗口需要额外处理但 LiveLink 只支持 Win
    this.win.setMovable(!pinned)
    this.win.setResizable(!pinned)
    // setFocusable(false) → WS_EX_NOACTIVATE，点击窗口不抢焦点，避免游戏失焦
    this.win.setFocusable(!pinned)
    // 钉住时再次强制 alwaysOnTop screen-saver 层级，已是最高
    this.win.setAlwaysOnTop(true, 'screen-saver')
  }

  /** 给 IPC 用：返回 enabled + pinned 状态 */
  getStatus(): { enabled: boolean; pinned: boolean } {
    return {
      enabled: this.isOpen(),
      pinned: this.config.getDanmuOverlay().pinned
    }
  }

  /** 给 IPC 用：返回 settings (opacity / fontSize) */
  getSettings(): { opacity: number; fontSize: number } {
    const c = this.config.getDanmuOverlay()
    return { opacity: c.opacity, fontSize: c.fontSize }
  }

  private attachBus(): void {
    const handler = (e: StandardEvent): void => this.handleEvent(e)
    this.bus.on('event', handler)
    this.busUnsub = () => this.bus.off('event', handler)
  }
  private detachBus(): void {
    this.busUnsub?.()
    this.busUnsub = null
  }

  private handleEvent(e: StandardEvent): void {
    if (!this.win || this.win.isDestroyed()) return
    if (e.kind !== 'danmu.received' && e.kind !== 'gift.received') return
    const item: DanmuOverlayPushItem = {
      id: `${e.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      kind: e.kind === 'danmu.received' ? 'danmu' : 'gift',
      uname: e.user.uname,
      guardLevel: e.user.guardLevel ?? 0,
      isAnchor: e.user.fansMedal?.isAnchor ?? false,
      fansMedalLevel: e.user.fansMedal?.level ?? 0
    }
    if (e.kind === 'danmu.received') {
      item.content = e.payload.content
    } else {
      item.giftName = e.payload.giftName
      item.num = e.payload.num
    }
    try {
      this.win.webContents.send(IpcChannels.DanmuOverlayEvent, item)
    } catch (err) {
      console.error('[DanmuOverlayWindow] send failed', err)
    }
  }

  private persistBounds(): void {
    if (!this.win || this.win.isDestroyed()) return
    const b = this.win.getBounds()
    this.config.patchDanmuOverlay({ bounds: b })
  }

  private resolveBounds(
    saved: DanmuOverlayConfig
  ): { x?: number; y?: number; width: number; height: number } {
    const fallback: { width: number; height: number } = { ...DEFAULT_BOUNDS }
    if (!saved.bounds) return fallback
    const b = saved.bounds
    if (b.width < MIN_WIDTH || b.height < MIN_HEIGHT) return fallback
    // 校验 saved bounds 是否落在某个 display 内（多屏拔掉一个屏时旧位置可能 off-screen）
    const displays = screen.getAllDisplays()
    const inSomeDisplay = displays.some((d) => {
      const r = d.workArea
      return (
        b.x >= r.x - 50 &&
        b.y >= r.y - 50 &&
        b.x + b.width <= r.x + r.width + 50 &&
        b.y + b.height <= r.y + r.height + 50
      )
    })
    if (!inSomeDisplay) return fallback
    return { x: b.x, y: b.y, width: b.width, height: b.height }
  }

  private statusListeners = new Set<(s: { enabled: boolean; pinned: boolean }) => void>()
  onStatusChange(cb: (s: { enabled: boolean; pinned: boolean }) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  private notifyStatusChange(): void {
    const s = this.getStatus()
    for (const l of this.statusListeners) {
      try {
        l(s)
      } catch (err) {
        console.error('[DanmuOverlayWindow] status listener threw', err)
      }
    }
  }

  /** 应用退出时清理 */
  dispose(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.persistBounds()
      this.win.destroy()
    }
    this.win = null
    this.detachBus()
  }
}

function throttle<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | null = null
  let pending = false
  const wrapped = ((...args: never[]) => {
    if (timer) {
      pending = true
      return
    }
    fn(...args)
    timer = setTimeout(() => {
      timer = null
      if (pending) {
        pending = false
        wrapped(...args)
      }
    }, ms)
  }) as T
  return wrapped
}
