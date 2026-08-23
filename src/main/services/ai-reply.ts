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
    // 走到这里还没有 Key，说明"保存"那一步没真的落到配置里。
    // 别再说一句干巴巴的"请先填写"——主播明明填了，得告诉他下一步该干嘛。
    if (!config.apiKey) {
      throw new Error('配置里还没有 DeepSeek API Key：把 Key 粘进上面的输入框，点「保存 Key」之后再测试。')
    }
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
      if (!resp.ok) throw new DeepSeekError(describeHttpFailure(resp.status, json.error?.message))
      const reply = json.choices?.[0]?.message?.content?.trim()
      if (!reply) throw new DeepSeekError('DeepSeek 这次没返回内容，过一会儿再试一次。')
      return reply.replace(/\s+/g, ' ')
    } catch (err) {
      // 原样往外抛的话，主播看到的是 "fetch failed" / "AbortError" 这类天书。
      // 到底是 Key 不对、余额没了、被限流，还是网络 / 代理挡了 api.deepseek.com，
      // 这四种的处理办法完全不同，必须分清楚说。
      throw toDeepSeekError(err, controller.signal.aborted)
    } finally {
      clearTimeout(timer)
    }
  }
}

// DeepSeek 侧已经翻译成人话的错误，不要再被 toDeepSeekError 二次包装
class DeepSeekError extends Error {}

function describeHttpFailure(status: number, apiMessage?: string): string {
  const detail = apiMessage ? `（${apiMessage}）` : ''
  if (status === 401 || status === 403) {
    return `DeepSeek 不认这个 API Key${detail}。到 DeepSeek 开放平台核对一下：Key 有没有复制全、是不是已经被删掉了。`
  }
  if (status === 402) return `DeepSeek 账户余额不足${detail}，充值之后才能用。`
  if (status === 429) {
    return `调用太频繁，被 DeepSeek 限流了${detail}。把"全局冷却秒"调大一些，或者过一会儿再试。`
  }
  if (status === 400 || status === 404) {
    return `DeepSeek 拒绝了这次请求${detail}。多半是模型选得不对，换一个模型再试。`
  }
  if (status >= 500) return `DeepSeek 服务器出问题了（HTTP ${status}）${detail}，过几分钟再试。`
  return `DeepSeek 返回了 HTTP ${status}${detail}`
}

function toDeepSeekError(err: unknown, aborted: boolean): Error {
  if (err instanceof DeepSeekError) return err
  if (aborted || (err as Error)?.name === 'AbortError') {
    return new DeepSeekError('等了 15 秒 DeepSeek 都没回应。看看网络，或者代理是不是把它挡住了。')
  }
  const message = (err as Error)?.message ?? String(err)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|certificate/i.test(message)) {
    return new DeepSeekError(`连不上 DeepSeek（${message}）。检查网络，或者代理 / 防火墙是不是挡了 api.deepseek.com。`)
  }
  if (/Invalid header|header value/i.test(message)) {
    return new DeepSeekError('API Key 里混进了非法字符，重新复制一遍再保存。')
  }
  return new DeepSeekError(message || 'DeepSeek 请求失败')
}

function stripTrigger(config: AiReplyConfig, content: string): string {
  let text = content.trim()
  if (config.triggerMode === 'mention' && config.mentionName) {
    text = text.replace(config.mentionName, '').trim()
  }
  return text || content
}
