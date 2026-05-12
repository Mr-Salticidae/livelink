import { createServer, type Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { Server as IOServer, type Namespace } from 'socket.io'
import type { OverlayMessage } from '../actions/overlay'
import { findAvailablePort } from './port'

const DEFAULT_PORT = 38501

export interface OverlayServerOptions {
  rendererDir: string // 指向 out/renderer/
  preferredPort?: number
}

export class OverlayServer {
  private http: HttpServer | null = null
  private io: IOServer | null = null
  private overlayNs: Namespace | null = null
  private port = 0

  async start(options: OverlayServerOptions): Promise<number> {
    if (this.http) return this.port

    const port = await findAvailablePort(options.preferredPort ?? DEFAULT_PORT)

    const app = express()
    const overlayHtmlPath = join(options.rendererDir, 'src/overlay/index.html')
    const assetsPath = join(options.rendererDir, 'assets')

    app.get('/api/health', (_req, res) => {
      res.json({ ok: true, name: 'LiveLink Overlay Server', port })
    })

    if (existsSync(assetsPath)) {
      app.use('/assets', express.static(assetsPath, { fallthrough: true, maxAge: 0 }))
    }

    // 主入口：/ 和 /overlay 都返回 overlay 单页
    const sendOverlay = (_req: express.Request, res: express.Response): void => {
      if (existsSync(overlayHtmlPath)) {
        res.sendFile(overlayHtmlPath)
        return
      }
      res
        .status(503)
        .type('html')
        .send(
          `<!doctype html><meta charset="utf-8"><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;padding:32px"><h2>Overlay 还没构建</h2><p>请先在项目根运行 <code>pnpm build</code>，再启动应用。</p></body>`
        )
    }
    app.get('/', sendOverlay)
    app.get('/overlay', sendOverlay)

    const http = createServer(app)
    const io = new IOServer(http, {
      cors: { origin: '*' }, // 本机访问，OBS 浏览器源也是本机
      serveClient: false
    })
    const overlayNs = io.of('/overlay')

    overlayNs.on('connection', (socket) => {
      console.log(`[OverlayServer] client connected: ${socket.id}`)
      socket.on('disconnect', () => {
        console.log(`[OverlayServer] client disconnected: ${socket.id}`)
      })
    })

    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(port, '127.0.0.1', () => resolve())
    })

    this.http = http
    this.io = io
    this.overlayNs = overlayNs
    this.port = port

    console.log(`[OverlayServer] listening on http://127.0.0.1:${port}`)
    return port
  }

  broadcast(msg: OverlayMessage): void {
    if (!this.overlayNs) return
    this.overlayNs.emit(msg.kind, msg)
  }

  getPort(): number {
    return this.port
  }

  getOverlayUrl(): string {
    return `http://127.0.0.1:${this.port}/overlay`
  }

  async stop(): Promise<void> {
    if (this.io) {
      await new Promise<void>((r) => this.io!.close(() => r()))
    }
    if (this.http) {
      await new Promise<void>((r) => this.http!.close(() => r()))
    }
    this.http = null
    this.io = null
    this.overlayNs = null
    this.port = 0
  }
}
