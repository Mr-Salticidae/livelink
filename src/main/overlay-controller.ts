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
  // 本次进程启动的唯一标识。app 每次重启（=可能出了新版本）都会变。
  // 下发给 overlay 端，它发现 bootId 变了就自动 location.reload()，
  // 配合 HTML no-store，OBS 浏览器源无需手动改 URL 即可拿到新包。
  private readonly bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

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
        giftService: this.giftServiceGetter() ?? undefined,
        // 新 OBS 浏览器源连上时，立即把当前 danmu board config 发过去。
        // 否则浏览器源刚加载，没收到 patch broadcast，无法判断 enabled / 位置等。
        // 另注册 'danmu.board.config:request'：overlay 端挂载 / 重连后主动拉一次，
        // 兜底「连接早于监听器注册导致首发丢失」——这是开了板子却不显示的主因
        onSocketConnect: (socket) => {
          const pushConfig = (): void => {
            socket.emit('danmu.board.config', {
              kind: 'danmu.board.config',
              event: {
                kind: 'viewer.enter',
                platform: 'bilibili',
                timestamp: Date.now(),
                user: { uid: '0', uname: '' },
                payload: {}
              },
              extra: { ...this.config.getDanmuBoard() }
            })
            // bootId 随同一可靠通道下发（connect + 端侧 request 兜底）
            socket.emit('overlay.hello', { bootId: this.bootId })
          }
          pushConfig()
          socket.on('danmu.board.config:request', pushConfig)
        }
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
