// 包装 OverlayServer 启动 + 失败状态 + 重试，让 UI 能看到 fatalError 而不是 port:0 的乱码 URL
import type { AppConfig } from './config/store'
import type { OverlayBroadcaster } from './actions/overlay'
import type { OverlayServer } from './overlay-server/server'
import type { GiftService } from './services/gift-config'
import type { OverlayState } from '../shared/ipc-channels'

export class OverlayController {
  private fatalError: string | null = null
  private retrying = false
  private onChange: () => void = () => {}

  constructor(
    private server: OverlayServer,
    private broadcaster: OverlayBroadcaster,
    private config: AppConfig,
    private rendererDir: string,
    // GiftService 在 app.whenReady 后才注入，用 getter 延迟解析
    private giftServiceGetter: () => GiftService | null = () => null
  ) {}

  setOnChange(cb: () => void): void {
    this.onChange = cb
  }

  async start(): Promise<void> {
    try {
      const port = await this.server.start({
        rendererDir: this.rendererDir,
        preferredPort: this.config.getOverlayPort(),
        giftService: this.giftServiceGetter() ?? undefined
      })
      this.config.setOverlayPort(port)
      this.broadcaster.setSender((msg) => this.server.broadcast(msg))
      this.fatalError = null
    } catch (err) {
      this.fatalError = String((err as Error)?.message ?? err)
      this.broadcaster.setSender(null)
      console.error('[OverlayController] start failed:', this.fatalError)
      throw err
    } finally {
      this.onChange()
    }
  }

  async retry(): Promise<OverlayState> {
    if (this.retrying) return this.getState()
    this.retrying = true
    this.onChange()
    try {
      try {
        await this.server.stop()
      } catch (err) {
        console.warn('[OverlayController] stop before retry failed (ignored):', err)
      }
      try {
        await this.start()
      } catch {
        // start() 失败时 fatalError 已记录；不再向上抛，让调用方拿到状态判断
      }
    } finally {
      this.retrying = false
      this.onChange()
    }
    return this.getState()
  }

  getState(): OverlayState {
    return {
      port: this.server.getPort(),
      url: this.server.getOverlayUrl(),
      fatalError: this.fatalError,
      retrying: this.retrying
    }
  }
}
