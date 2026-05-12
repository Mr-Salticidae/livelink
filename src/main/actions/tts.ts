// TTS 播放器骨架（Task 3 阶段，先 stub；Task 4 接入 edge-tts-universal + 隐藏 BrowserWindow 播放）

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

interface QueueItem {
  text: string
  enqueuedAt: number
}

export class TTSPlayer {
  private config: TTSConfig = { ...DEFAULT_TTS_CONFIG }
  private queue: QueueItem[] = []
  private processing = false

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
      this.queue.shift() // 丢最早的，保持上限
    }
    this.queue.push({ text: truncated, enqueuedAt: Date.now() })
    void this.drain()
  }

  // Task 4 实现：合成 + 播放
  protected async speak(text: string): Promise<void> {
    console.log(`[TTS stub] would speak: ${text}`)
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

  async test(text: string = '你好，我是 LiveLink，弹幕助手'): Promise<void> {
    await this.speak(text)
  }

  dispose(): void {
    this.queue = []
  }
}
