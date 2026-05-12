import { BrowserWindow } from 'electron'
import { Communicate } from 'edge-tts-universal'

export interface TTSConfig {
  enabled: boolean
  voice: string
  rate: string // edge-tts 风格：'+0%' / '-20%'
  volume: string // edge-tts 风格：'+0%' / '-20%'
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: true,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%'
}

export const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 标准' },
  { value: 'zh-CN-YunxiNeural', label: '云希 · 男 · 年轻' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 温柔' },
  { value: 'zh-CN-YunjianNeural', label: '云健 · 男 · 沉稳' },
  { value: 'zh-CN-XiaomengNeural', label: '晓梦 · 女 · 可爱' },
  { value: 'zh-CN-XiaoxuanNeural', label: '晓萱 · 女 · 沉稳' },
  { value: 'zh-CN-XiaoshuangNeural', label: '晓双 · 童声' }
]

const MAX_TEXT_LENGTH = 50
const MAX_QUEUE_LENGTH = 20
const SYNTHESIS_TIMEOUT_MS = 10_000

interface QueueItem {
  text: string
  enqueuedAt: number
}

export class TTSPlayer {
  private config: TTSConfig = { ...DEFAULT_TTS_CONFIG }
  private queue: QueueItem[] = []
  private processing = false
  private audioWindow: BrowserWindow | null = null
  private audioWindowReady: Promise<void> | null = null

  setConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getConfig(): TTSConfig {
    return { ...this.config }
  }

  enqueue(rawText: string): void {
    if (!this.config.enabled) return
    const text = (rawText ?? '').trim()
    if (!text) return
    const truncated = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text

    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      this.queue.shift() // 队列满了丢最早的，避免高频礼物时 TTS 滞后越来越远
    }
    this.queue.push({ text: truncated, enqueuedAt: Date.now() })
    void this.drain()
  }

  async test(text: string = '你好，我是 LiveLink，弹幕助手'): Promise<void> {
    await this.speak(text)
  }

  dispose(): void {
    this.queue = []
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      this.audioWindow.destroy()
    }
    this.audioWindow = null
    this.audioWindowReady = null
  }

  private async drain(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!
        try {
          await this.speak(item.text)
        } catch (err) {
          console.error('[TTSPlayer] speak failed', err)
        }
      }
    } finally {
      this.processing = false
    }
  }

  private async speak(text: string): Promise<void> {
    const audio = await this.synthesize(text)
    if (!audio || audio.length === 0) {
      console.warn('[TTSPlayer] empty synthesis result for:', text)
      return
    }
    const win = await this.ensureAudioWindow()
    if (win.isDestroyed()) return

    const dataUrl = `data:audio/mpeg;base64,${audio.toString('base64')}`
    const script = `new Promise((resolve) => {
      try {
        const a = new Audio(${JSON.stringify(dataUrl)});
        a.onended = () => resolve('ended');
        a.onerror = () => resolve('error');
        a.play().catch(() => resolve('play-rejected'));
      } catch (e) {
        resolve('exception');
      }
    })`
    try {
      await win.webContents.executeJavaScript(script, true)
    } catch (err) {
      console.error('[TTSPlayer] playback failed', err)
    }
  }

  private async synthesize(text: string): Promise<Buffer> {
    const c = new Communicate(text, {
      voice: this.config.voice,
      rate: this.config.rate,
      volume: this.config.volume,
      connectionTimeout: SYNTHESIS_TIMEOUT_MS
    })
    const chunks: Buffer[] = []
    for await (const chunk of c.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(chunk.data)
      }
    }
    return Buffer.concat(chunks)
  }

  private ensureAudioWindow(): Promise<BrowserWindow> {
    if (this.audioWindow && !this.audioWindow.isDestroyed() && this.audioWindowReady) {
      return this.audioWindowReady.then(() => this.audioWindow!)
    }
    this.audioWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    this.audioWindowReady = this.audioWindow.loadURL('about:blank').then(() => undefined)
    return this.audioWindowReady.then(() => this.audioWindow!)
  }
}
