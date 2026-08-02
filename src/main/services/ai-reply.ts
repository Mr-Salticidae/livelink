import type { TTSPlayer } from '../actions/tts'
import type { LogSink } from '../actions/log'
import type { Bus } from '../events/bus'
import type { StandardEvent } from '../platform/adapter'
import { sanitizeAiReplyConfig, type AiReplyConfig } from '../../shared/ai-reply'
import { claimSpeech } from './speech-claim'

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

export class AiReplyService {
  private bus: Bus
  private tts: TTSPlayer
  private log: LogSink
  private getConfig: () => AiReplyConfig
  private unsubBus: (() => void) | null = null
  private lastGlobalAt = 0
  private perUserAt = new Map<string, number>()
  private inflight = false

  constructor(deps: {
    bus: Bus
    tts: TTSPlayer
    log: LogSink
    getConfig: () => AiReplyConfig
  }) {
    this.bus = deps.bus
    this.tts = deps.tts
    this.log = deps.log
    this.getConfig = deps.getConfig
  }

  attach(): void {
    if (this.unsubBus) return
    const handler = (e: StandardEvent): void => {
      void this.handleEvent(e)
    }
    this.bus.on('event', handler)
    this.unsubBus = () => this.bus.off('event', handler)
  }

  dispose(): void {
    this.unsubBus?.()
    this.unsubBus = null
    this.perUserAt.clear()
  }

  async test(prompt: string): Promise<string> {
    const config = sanitizeAiReplyConfig(this.getConfig())
    if (!config.apiKey) throw new Error('请先填写 DeepSeek API Key')
    return this.askDeepSeek(config, prompt.slice(0, config.maxInputLength), '测试用户')
  }

  private async handleEvent(e: StandardEvent): Promise<void> {
    if (e.kind !== 'danmu.received') return
    const config = sanitizeAiReplyConfig(this.getConfig())
    if (!config.enabled || !config.apiKey) return
    const content = e.payload.content.trim()
    if (!content || !this.shouldTrigger(config, content)) return

    const now = Date.now()
    if (config.cooldownSec > 0 && now - this.lastGlobalAt < config.cooldownSec * 1000) return
    const userKey = `${e.user.uid || '0'}|${e.user.uname || '观众'}`
    const userLast = this.perUserAt.get(userKey) ?? 0
    if (config.perUserCooldownSec > 0 && now - userLast < config.perUserCooldownSec * 1000) return
    if (this.inflight) return

    this.lastGlobalAt = now
    this.perUserAt.set(userKey, now)
    this.inflight = true
    // 这条弹幕由 AI 接管播报，弹幕朗读不要再把原文念一遍。
    // 必须在第一个 await 之前同步打标记（详见 services/speech-claim.ts）
    if (config.speakReply) claimSpeech(e)
    try {
      const prompt = stripTrigger(config, content).slice(0, config.maxInputLength)
      const reply = await this.askDeepSeek(config, prompt, e.user.uname || '观众')
      const finalReply = reply.slice(0, config.maxReplyLength)
      if (config.logReply) {
        this.log.write({
          timestamp: Date.now(),
          ruleId: 'ai.reply',
          ruleName: 'AI 智能回复',
          eventKind: e.kind,
          uname: e.user.uname,
          text: `AI 回复 ${e.user.uname}: ${finalReply}`
        })
      }
      // priority=normal：AI 回复是对观众提问的答复，不该被弹幕朗读的洪水挤掉，
      // 但也不该插到礼物 / SC 感谢前面
      if (config.speakReply) {
        this.tts.enqueue(finalReply, { eventKind: 'danmu.received', priority: 'normal' })
      }
    } catch (err) {
      console.error('[AiReply] request failed', err)
      this.log.write({
        timestamp: Date.now(),
        ruleId: 'ai.reply',
        ruleName: 'AI 智能回复',
        eventKind: e.kind,
        uname: e.user.uname,
        text: `AI 回复失败：${(err as Error)?.message ?? String(err)}`
      })
    } finally {
      this.inflight = false
    }
  }

  private shouldTrigger(config: AiReplyConfig, content: string): boolean {
    if (config.triggerMode === 'all') return true
    if (config.triggerMode === 'mention') return content.includes(config.mentionName)
    return config.keywords.some((keyword) => content.includes(keyword))
  }

  private async askDeepSeek(config: AiReplyConfig, prompt: string, uname: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const resp = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: `${uname} 的弹幕：${prompt}` }
          ],
          temperature: 0.8,
          max_tokens: Math.min(256, Math.max(64, config.maxReplyLength * 2))
        }),
        signal: controller.signal
      })
      const json = (await resp.json().catch(() => ({}))) as DeepSeekResponse
      if (!resp.ok) throw new Error(json.error?.message || `DeepSeek HTTP ${resp.status}`)
      const reply = json.choices?.[0]?.message?.content?.trim()
      if (!reply) throw new Error('DeepSeek 没有返回回复')
      return reply.replace(/\s+/g, ' ')
    } finally {
      clearTimeout(timer)
    }
  }
}

function stripTrigger(config: AiReplyConfig, content: string): string {
  let text = content.trim()
  if (config.triggerMode === 'mention' && config.mentionName) {
    text = text.replace(config.mentionName, '').trim()
  }
  return text || content
}
