// GiftService —— 拉 B 站礼物配置（gift_id → 图 URL / 价格 / 名字），把图缓存到 userData
//
// 用途：overlay 端 `/api/gift/:id` 路由要 serve 真实礼物图，而不是 emoji 占位。
// 直接代理 B 站 CDN 也行，但首屏加载常被 CDN 限速，缓存到本地后第二次起秒回。

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createReadStream, type ReadStream } from 'node:fs'
import { dirname, join } from 'node:path'

const GIFT_CONFIG_API =
  'https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig?platform=pc&source=live'

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24h 刷一次
const FETCH_TIMEOUT_MS = 10_000

export interface GiftAsset {
  id: number
  name: string
  price: number // 单价（B 站给的原值，未除 1000；除以 1000 ≈ 真实 RMB / 电池）
  coinType: 'gold' | 'silver'
  imgUrl: string // 最优图（优先 webp > gif > img_basic）
  imgExt: string // 'webp' | 'gif' | 'png'
}

interface RawGiftConfigItem {
  id?: number
  name?: string
  price?: number
  coin_type?: 'gold' | 'silver' | string
  img_basic?: string
  img_dynamic?: string
  gif?: string
  webp?: string
}

interface RawGiftConfigResponse {
  code: number
  message?: string
  data?: { list?: RawGiftConfigItem[] }
}

function pickImage(item: RawGiftConfigItem): { url: string; ext: string } | null {
  if (item.webp && item.webp.startsWith('http')) return { url: item.webp, ext: 'webp' }
  if (item.gif && item.gif.startsWith('http')) return { url: item.gif, ext: 'gif' }
  if (item.img_dynamic && item.img_dynamic.startsWith('http'))
    return { url: item.img_dynamic, ext: 'png' }
  if (item.img_basic && item.img_basic.startsWith('http'))
    return { url: item.img_basic, ext: 'png' }
  return null
}

export interface GiftServiceOptions {
  cacheDir: string // 例 app.getPath('userData')/gift-cache
}

export class GiftService {
  private assets = new Map<number, GiftAsset>()
  private cacheDir: string
  private refreshTimer: NodeJS.Timeout | null = null
  // 同一 gift 的并发请求只下载一次。Map<id, Promise<localPath|null>>
  private inflight = new Map<number, Promise<string | null>>()

  constructor(options: GiftServiceOptions) {
    this.cacheDir = options.cacheDir
  }

  /** 启动时调用，先确保 cacheDir 存在，再异步刷一次配置（失败不阻塞应用） */
  async start(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true }).catch((err) =>
      console.error('[GiftService] mkdir cache dir failed', err)
    )
    void this.refresh()
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  async refresh(): Promise<void> {
    let resp: Response
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
      resp = await fetch(GIFT_CONFIG_API, {
        headers: { 'User-Agent': 'Mozilla/5.0 LiveLink/0.3.0' },
        signal: ac.signal
      })
      clearTimeout(timer)
    } catch (err) {
      console.warn('[GiftService] fetch gift config failed', (err as Error)?.message)
      return
    }
    if (!resp.ok) {
      console.warn(`[GiftService] gift config HTTP ${resp.status}`)
      return
    }
    let json: RawGiftConfigResponse
    try {
      json = (await resp.json()) as RawGiftConfigResponse
    } catch (err) {
      console.warn('[GiftService] gift config json parse failed', err)
      return
    }
    if (json.code !== 0 || !json.data?.list) {
      console.warn('[GiftService] gift config response error:', json.message)
      return
    }
    const next = new Map<number, GiftAsset>()
    for (const item of json.data.list) {
      if (typeof item.id !== 'number') continue
      const img = pickImage(item)
      if (!img) continue
      next.set(item.id, {
        id: item.id,
        name: item.name ?? `gift_${item.id}`,
        price: item.price ?? 0,
        coinType: (item.coin_type === 'gold' ? 'gold' : 'silver'),
        imgUrl: img.url,
        imgExt: img.ext
      })
    }
    this.assets = next
    console.log(`[GiftService] loaded ${this.assets.size} gift assets`)
  }

  getAsset(id: number): GiftAsset | undefined {
    return this.assets.get(id)
  }

  /**
   * 给 OverlayServer 用：返回本地缓存路径，没有则尝试下载到缓存。
   * 失败返回 null，调用方负责回退（404）。
   */
  async getOrFetchLocalPath(id: number): Promise<string | null> {
    const asset = this.assets.get(id)
    if (!asset) return null
    const localPath = join(this.cacheDir, `${id}.${asset.imgExt}`)

    // 已缓存？
    try {
      const s = await stat(localPath)
      if (s.isFile() && s.size > 0) return localPath
    } catch {
      // 没缓存，往下走
    }

    // 并发去重
    const inflight = this.inflight.get(id)
    if (inflight) return inflight

    const task = (async (): Promise<string | null> => {
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
        const resp = await fetch(asset.imgUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 LiveLink/0.3.0' },
          signal: ac.signal
        })
        clearTimeout(timer)
        if (!resp.ok) {
          console.warn(`[GiftService] download gift ${id} HTTP ${resp.status}`)
          return null
        }
        const buf = Buffer.from(await resp.arrayBuffer())
        await mkdir(dirname(localPath), { recursive: true })
        await writeFile(localPath, buf)
        return localPath
      } catch (err) {
        console.warn(`[GiftService] download gift ${id} failed`, (err as Error)?.message)
        return null
      } finally {
        this.inflight.delete(id)
      }
    })()
    this.inflight.set(id, task)
    return task
  }

  /** express 用：拿到本地路径后 createReadStream serve */
  openLocalStream(localPath: string): ReadStream {
    return createReadStream(localPath)
  }

  /**
   * Content-Type 判断。express.sendFile 也行，但需要相对路径——
   * 我们直接给出 mime 字符串，handler 用 res.type() + stream pipe
   */
  static mimeForExt(ext: string): string {
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'png') return 'image/png'
    return 'application/octet-stream'
  }
}
