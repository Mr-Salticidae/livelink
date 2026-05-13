import { BrowserWindow } from 'electron'
import { Communicate } from 'edge-tts-universal'
import type { EventKind } from '../platform/adapter'

export interface TTSConfig {
  enabled: boolean
  voice: string
  rate: string // edge-tts 风格：'+0%' / '-20%'
  volume: string // edge-tts 风格：'+0%' / '-20%'
  // 分事件音色覆盖。key 是 EventKind，value 是 voice 字符串。
  // 空 / undefined / 空字符串 → 用全局 voice。rate/volume 不分事件（共用全局）
  perEventVoice?: Partial<Record<EventKind, string>>
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: true,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%',
  perEventVoice: {}
}

// 2026-05-13：实测 listVoices() 拉真实可用的 zh-CN 列表，删除已下线的
// 晓梦 / 晓双 / 晓萱（在 Azure 上有但 Edge TTS 端点不支持，会抛
// NoAudioReceived "No audio was received."）。
// 当前列表对照 Microsoft Edge TTS 服务实际返回，每个都已实测可用
export const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女 · 标准' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女 · 活泼' },
  { value: 'zh-CN-YunxiNeural', label: '云希 · 男 · 阳光' },
  { value: 'zh-CN-YunxiaNeural', label: '云夏 · 男 · 可爱' },
  { value: 'zh-CN-YunjianNeural', label: '云健 · 男 · 激情' },
  { value: 'zh-CN-YunyangNeural', label: '云扬 · 男 · 沉稳（主播感）' },
  { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北 · 女 · 东北话' },
  { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮 · 女 · 陕西话' }
]

export const VALID_VOICE_VALUES: ReadonlySet<string> = new Set(
  VOICE_OPTIONS.map((v) => v.value)
)

const MAX_TEXT_LENGTH = 50
const MAX_QUEUE_LENGTH = 20
const SYNTHESIS_TIMEOUT_MS = 10_000

interface QueueItem {
  text: string
  voice: string // resolve 后的 voice（已经按 eventKind 查过 perEventVoice）
  enqueuedAt: number
}

export interface EnqueueOptions {
  /** 事件类型，TTSPlayer 用来查 perEventVoice 覆盖 */
  eventKind?: EventKind
  /** 直接覆盖 voice（test 等场景用）。优先级高于 eventKind 查询 */
  voiceOverride?: string
}

export class TTSPlayer {
  private config: TTSConfig = { ...DEFAULT_TTS_CONFIG }
  private queue: QueueItem[] = []
  private processing = false
  private audioWindow: BrowserWindow | null = null
  private audioWindowReady: Promise<void> | null = null
  // 把 audioWindow 作为 mainWindow 的子窗口创建，确保主窗口关闭时它一并销毁，
  // 否则 Electron 的 window-all-closed 不触发，进程会驻留。
  private parentWindow: BrowserWindow | null = null

  setConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config }
  }

  setParentWindow(win: BrowserWindow | null): void {
    this.parentWindow = win
    // parent 变了的话，已存在的 audioWindow 必须 destroy 重建——
    // Electron 不允许动态改 parent
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      this.audioWindow.destroy()
    }
    this.audioWindow = null
    this.audioWindowReady = null
  }

  getConfig(): TTSConfig {
    return { ...this.config }
  }

  enqueue(rawText: string, options?: EnqueueOptions): void {
    if (!this.config.enabled) return
    const text = (rawText ?? '').trim()
    if (!text) return
    const truncated = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
    const voice = this.resolveVoice(options)

    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      this.queue.shift() // 队列满了丢最早的，避免高频礼物时 TTS 滞后越来越远
    }
    this.queue.push({ text: truncated, voice, enqueuedAt: Date.now() })
    void this.drain()
  }

  async test(text: string = '你好，我是 LiveLink，弹幕助手', voiceOverride?: string): Promise<void> {
    await this.speak(text, this.resolveVoice({ voiceOverride }))
  }

  /** 按 options 解析 voice：voiceOverride > perEventVoice[eventKind] > 全局 voice */
  private resolveVoice(options?: EnqueueOptions): string {
    if (options?.voiceOverride && options.voiceOverride.length > 0) return options.voiceOverride
    if (options?.eventKind) {
      const perEvent = this.config.perEventVoice?.[options.eventKind]
      if (perEvent && perEvent.length > 0) return perEvent
    }
    return this.config.voice
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
          await this.speak(item.text, item.voice)
        } catch (err) {
          console.error('[TTSPlayer] speak failed', err)
        }
      }
    } finally {
      this.processing = false
    }
  }

  private async speak(text: string, voice: string): Promise<void> {
    const audio = await this.synthesize(text, voice)
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

  private async synthesize(text: string, voice: string): Promise<Buffer> {
    const c = new Communicate(text, {
      voice,
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
    // 关键：parent 让此窗口在主窗口关闭时自动销毁，避免进程驻留
    this.audioWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      parent: this.parentWindow ?? undefined,
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
