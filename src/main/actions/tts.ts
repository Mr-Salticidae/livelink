import { BrowserWindow } from 'electron'
import { Communicate } from 'edge-tts-universal'
import type { EventKind } from '../platform/adapter'

export interface TTSConfig {
  enabled: boolean
  voice: string
  rate: string // edge-tts 风格：'+0%' / '-20%'
  volume: string // edge-tts 风格：'+0%' / '-20%'
  style?: 'normal' | 'mambo'
  // 分事件音色覆盖。key 是 EventKind，value 是 voice 字符串。
  // 空 / undefined / 空字符串 → 用全局 voice。rate/volume 不分事件（共用全局）
  perEventVoice?: Partial<Record<EventKind, string>>
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  enabled: true,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%',
  style: 'normal',
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

export const VALID_VOICE_VALUES: ReadonlySet<string> = new Set(VOICE_OPTIONS.map((v) => v.value))

// 单条文本安全上限。规则话术和弹幕朗读各自还有更严的上限，这里只是兜底，
// 防止某条超长文本合成出十几秒音频、把后面所有播报都堵住
const MAX_TEXT_LENGTH = 120
const MAX_QUEUE_LENGTH = 20
// 弹幕朗读是低优先级且高频，单独再设一个更小的上限：
// 积压超过 6 条就说明已经念不过来了，继续排队只会让播报离现场越来越远
const MAX_LOW_QUEUE_LENGTH = 6
const SYNTHESIS_TIMEOUT_MS = 10_000
const SYNTHESIS_RETRY_DELAY_MS = 400
const PLAYBACK_TIMEOUT_MS = 60_000

/**
 * 播报优先级。礼物 / SC / 上舰这类"付费反馈"必须念到，
 * 弹幕朗读念不过来就该丢——两者不能挤在同一个先进先出队列里。
 */
export type TTSPriority = 'high' | 'normal' | 'low'

const RANK: Record<TTSPriority, number> = { high: 0, normal: 1, low: 2 }

// 排队太久还没轮到就没有播报价值了，按优先级给不同的保质期
const DEFAULT_TTL_MS: Record<TTSPriority, number> = {
  high: 300_000,
  normal: 120_000,
  low: 45_000
}

interface QueueItem {
  text: string
  voice: string // resolve 后的 voice（已经按 eventKind 查过 perEventVoice）
  rank: number
  enqueuedAt: number
  expireAt: number
}

export interface EnqueueOptions {
  /** 事件类型，TTSPlayer 用来查 perEventVoice 覆盖（多角色音色） */
  eventKind?: EventKind
  /** 直接覆盖 voice（弹幕朗读 / test 等场景用）。优先级高于 eventKind 查询 */
  voiceOverride?: string
  /** 播报优先级，默认 normal */
  priority?: TTSPriority
  /** 自定义保质期（毫秒）。不传按 priority 取默认值 */
  ttlMs?: number
}

export interface TTSStats {
  queued: number
  speaking: boolean
  /** 因为队列满 / 过期被丢掉的条数（进程内累计，用来在 UI 上提示"念不过来了"） */
  dropped: number
  /** 合成失败条数（进程内累计）。持续增长 = edge-tts 在线服务连不上，直播必看 */
  synthFailed: number
  /** 播放失败条数（进程内累计），audioWindow 不可用 / executeJavaScript 失败 */
  playFailed: number
  /** 最近一次合成或播放失败的摘要。UI 据此提示"为什么一声不吭" */
  lastError: { message: string; at: number } | null
}

export class TTSPlayer {
  private config: TTSConfig = { ...DEFAULT_TTS_CONFIG }
  private queue: QueueItem[] = []
  private processing = false
  private dropped = 0
  // 合成 / 播放失败计数与最近错误。edge-tts 走微软在线端点，直播机网络不通时
  // 每一条播报都会静默失败——没有这两个计数，主播只知道"一声不吭"不知道为什么
  private synthFailed = 0
  private playFailed = 0
  private lastError: { message: string; at: number } | null = null
  // 每次 stop() 自增。drain 循环在每个 await 之后比对，发现变了就立刻退出，
  // 避免"已经喊停了还在念上一条"
  private generation = 0
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

  getStats(): TTSStats {
    return {
      queued: this.queue.length,
      speaking: this.processing,
      dropped: this.dropped,
      synthFailed: this.synthFailed,
      playFailed: this.playFailed,
      lastError: this.lastError ? { ...this.lastError } : null
    }
  }

  enqueue(rawText: string, options?: EnqueueOptions): void {
    if (!this.config.enabled) return
    const text = (rawText ?? '').trim()
    if (!text) return
    const styled = this.applyStyle(text)
    const truncated = styled.length > MAX_TEXT_LENGTH ? styled.slice(0, MAX_TEXT_LENGTH) : styled
    const voice = this.resolveVoice(options)
    const priority = options?.priority ?? 'normal'
    const now = Date.now()
    const item: QueueItem = {
      text: truncated,
      voice,
      rank: RANK[priority],
      enqueuedAt: now,
      expireAt: now + (options?.ttlMs ?? DEFAULT_TTL_MS[priority])
    }

    if (!this.makeRoomFor(item)) {
      // 队列里全是比它更该念的东西 → 这条直接丢，不排队
      this.dropped += 1
      return
    }
    this.insertByPriority(item)
    void this.drain()
  }

  async test(text: string = '你好，我是 LiveLink，弹幕助手', voiceOverride?: string): Promise<void> {
    await this.speak(this.applyStyle(text), this.resolveVoice({ voiceOverride }), this.generation)
  }

  /** 清空队列并打断正在念的那条（主播喊停 / 断开连接时用） */
  stop(): void {
    this.queue = []
    this.generation += 1
    void this.stopPlayback()
  }

  /** 只跳过当前这条，队列里剩下的继续念 */
  skip(): void {
    void this.stopPlayback()
  }

  dispose(): void {
    this.queue = []
    this.generation += 1
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      this.audioWindow.destroy()
    }
    this.audioWindow = null
    this.audioWindowReady = null
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

  private applyStyle(text: string): string {
    if (this.config.style !== 'mambo') return text
    const clean = text.replace(/[~～]+/g, '').trim()
    if (!clean) return text
    if (/^(曼波|芜湖|哎哟)/.test(clean)) return clean
    return `曼波，${clean}，芜湖`
  }

  /**
   * 为新条目腾位置。返回 false 表示"队列里的每一条都比它更该念"，调用方应丢弃新条目。
   * 淘汰规则：先淘汰优先级最低的那一档里最旧的一条——低优先级的弹幕朗读，
   * 念旧的不如念新的。
   */
  private makeRoomFor(item: QueueItem): boolean {
    if (item.rank === RANK.low) {
      let lowCount = this.queue.reduce((n, q) => (q.rank === RANK.low ? n + 1 : n), 0)
      while (lowCount >= MAX_LOW_QUEUE_LENGTH) {
        const idx = this.queue.findIndex((q) => q.rank === RANK.low)
        if (idx < 0) break
        this.queue.splice(idx, 1)
        this.dropped += 1
        lowCount -= 1
      }
    }
    if (this.queue.length < MAX_QUEUE_LENGTH) return true

    let worstIdx = -1
    let worstRank = -1
    for (let i = 0; i < this.queue.length; i++) {
      // 用严格大于：队列按 rank 升序排，第一个命中最大 rank 的就是那一档里最旧的
      if (this.queue[i].rank > worstRank) {
        worstRank = this.queue[i].rank
        worstIdx = i
      }
    }
    if (worstIdx < 0 || worstRank < item.rank) return false
    this.queue.splice(worstIdx, 1)
    this.dropped += 1
    return true
  }

  /** 维持队列按 (rank 升序, enqueuedAt 升序) 排列，同优先级内仍是先进先出 */
  private insertByPriority(item: QueueItem): void {
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].rank > item.rank) i -= 1
    this.queue.splice(i, 0, item)
  }

  /** 取下一条待念的，顺手丢掉已经过期的 */
  private dequeue(): QueueItem | null {
    const now = Date.now()
    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      if (item.expireAt > now) return item
      this.dropped += 1
    }
    return null
  }

  private async drain(): Promise<void> {
    if (this.processing) return
    this.processing = true
    const gen = this.generation
    try {
      let current = this.dequeue()
      let currentAudio = current ? this.synthesizeSafe(current) : null
      while (current && currentAudio) {
        // 先等当前这条合成完，再去队列里取下一条。
        //
        // 顺序很要紧：如果在 await 之前就取 next，取到的是"这一条刚入队那一瞬间"
        // 的队列快照——那时候后一条弹幕通常还没到，next 恒为 null，预合成等于没做。
        // 放在 await 之后，合成这 0.5~1.5s 里新到的弹幕就都能赶上这一趟。
        const audio = await currentAudio
        if (gen !== this.generation) return

        // 当前这条播放的同时，下一条已经在合成 —— 条与条之间不再有整段静默
        const next = this.dequeue()
        const nextAudio = next ? this.synthesizeSafe(next) : null

        if (audio && audio.length > 0) {
          await this.play(audio)
          if (gen !== this.generation) return
        }

        current = next
        currentAudio = nextAudio
        if (!current) {
          // 播放期间可能又来了新弹幕，退出前再捞一次
          current = this.dequeue()
          currentAudio = current ? this.synthesizeSafe(current) : null
        }
      }
    } finally {
      this.processing = false
    }
    // processing 置回 false 与上面最后一次 dequeue 之间仍有一个极窄的窗口，
    // 期间进来的 enqueue 会因为 processing=true 直接返回。这里补一次兜底触发
    if (this.queue.length > 0 && !this.processing) void this.drain()
  }

  /** 供 test() 用的单条直念（不走队列） */
  private async speak(text: string, voice: string, gen: number): Promise<void> {
    const audio = await this.synthesize(text, voice)
    if (!audio || audio.length === 0) {
      console.warn('[TTSPlayer] empty synthesis result for:', text)
      return
    }
    if (gen !== this.generation) return
    await this.play(audio)
  }

  /** 合成失败不抛：drain 里任何一条失败都不应该中断整条队列 */
  private async synthesizeSafe(item: QueueItem): Promise<Buffer | null> {
    try {
      return await this.synthesize(item.text, item.voice)
    } catch (err) {
      this.synthFailed += 1
      this.recordError(`语音合成失败（${(err as Error)?.message ?? '网络错误'}）——检查网络或代理能否访问微软语音服务`)
      console.error('[TTSPlayer] synthesize failed', err)
      return null
    }
  }

  private recordError(message: string): void {
    this.lastError = { message, at: Date.now() }
  }

  private async synthesize(text: string, voice: string): Promise<Buffer> {
    // edge-tts 走微软在线端点，直播机网络不稳时偶发握手失败非常常见。
    // 最多 3 次尝试（初始 + 2 重试）：再多就会让这条播报滞后到没有意义
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await delay(SYNTHESIS_RETRY_DELAY_MS)
      try {
        return await this.synthesizeOnce(text, voice)
      } catch (err) {
        lastErr = err
        console.warn(`[TTSPlayer] synthesize attempt ${attempt + 1} failed:`, (err as Error)?.message ?? err)
      }
    }
    throw lastErr
  }

  private async synthesizeOnce(text: string, voice: string): Promise<Buffer> {
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

  private async play(audio: Buffer): Promise<void> {
    let win: BrowserWindow
    try {
      win = await this.ensureAudioWindow()
    } catch (err) {
      this.playFailed += 1
      this.recordError(`播放窗口创建失败（${(err as Error)?.message ?? '未知错误'}）`)
      console.error('[TTSPlayer] audio window unavailable', err)
      return
    }
    if (win.isDestroyed()) return

    const dataUrl = `data:audio/mpeg;base64,${audio.toString('base64')}`
    // 把 resolve 挂到 window 上，stopPlayback() 才有办法在 pause 之后把这个 await 解开。
    // 只 pause 不 resolve 的话 onended 永远不触发，drain 会永久卡住
    const script = `new Promise((resolve) => {
      try {
        if (window.__llAudio) { try { window.__llAudio.pause() } catch (e) {} }
        var a = new Audio(${JSON.stringify(dataUrl)});
        var settled = false;
        var done = function (why) {
          if (settled) return;
          settled = true;
          window.__llResolve = null;
          resolve(why);
        };
        window.__llAudio = a;
        window.__llResolve = done;
        a.onended = function () { done('ended') };
        a.onerror = function () { done('error') };
        a.play().catch(function () { done('play-rejected') });
      } catch (e) {
        resolve('exception');
      }
    })`
    try {
      const result = await withTimeout(win.webContents.executeJavaScript(script, true), PLAYBACK_TIMEOUT_MS)
      if (result === 'error' || result === 'play-rejected' || result === 'exception') {
        this.playFailed += 1
        this.recordError(`播放失败（${result}）`)
      }
    } catch (err) {
      this.playFailed += 1
      this.recordError(`播放失败（${(err as Error)?.message ?? '未知错误'}）`)
      console.error('[TTSPlayer] playback failed', err)
    }
  }

  private async stopPlayback(): Promise<void> {
    const win = this.audioWindow
    if (!win || win.isDestroyed()) return
    try {
      await win.webContents.executeJavaScript(
        `(function () {
          if (window.__llAudio) { try { window.__llAudio.pause() } catch (e) {} }
          if (window.__llResolve) { try { window.__llResolve('stopped') } catch (e) {} }
          return 'ok';
        })()`,
        true
      )
    } catch (err) {
      console.error('[TTSPlayer] stop playback failed', err)
    }
  }

  private ensureAudioWindow(): Promise<BrowserWindow> {
    if (this.audioWindow && !this.audioWindow.isDestroyed() && this.audioWindowReady) {
      return this.audioWindowReady.then(() => this.audioWindow!)
    }
    // 关键：parent 让此窗口在主窗口关闭时自动销毁，避免进程驻留
    const win = new BrowserWindow({
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
    this.audioWindow = win
    // loadURL 失败时必须把缓存的 promise 清掉，否则这个 rejected promise 会被
    // 一直复用，之后每一条播报都失败，只能重启软件
    const ready = win
      .loadURL('about:blank')
      .then(() => undefined)
      .catch((err) => {
        if (this.audioWindow === win) {
          this.audioWindow = null
          this.audioWindowReady = null
        }
        if (!win.isDestroyed()) win.destroy()
        throw err
      })
    this.audioWindowReady = ready
    return ready.then(() => this.audioWindow!)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}
