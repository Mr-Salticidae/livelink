export interface AiReplyConfig {
  enabled: boolean
  apiKey: string
  model: string
  systemPrompt: string
  triggerMode: 'mention' | 'keyword' | 'all'
  mentionName: string
  keywords: string[]
  cooldownSec: number
  perUserCooldownSec: number
  maxInputLength: number
  maxReplyLength: number
  speakReply: boolean
  logReply: boolean
}

export interface AiReplyPublicConfig extends Omit<AiReplyConfig, 'apiKey'> {
  hasApiKey: boolean
}

export const DEFAULT_AI_REPLY_CONFIG: AiReplyConfig = {
  enabled: false,
  apiKey: '',
  model: 'deepseek-chat',
  systemPrompt:
    '你是直播间里的智能弹幕助手。回答要简短、友好、有梗但不要冒犯；最多两句话，不要编造主播没有说过的信息。',
  triggerMode: 'mention',
  mentionName: '小助手',
  keywords: ['小助手', '问一下'],
  cooldownSec: 8,
  perUserCooldownSec: 30,
  maxInputLength: 120,
  maxReplyLength: 80,
  speakReply: true,
  logReply: true
}

export function sanitizeAiReplyConfig(config: Partial<AiReplyConfig>): AiReplyConfig {
  const base = { ...DEFAULT_AI_REPLY_CONFIG, ...config }
  return {
    enabled: Boolean(base.enabled),
    apiKey: String(base.apiKey ?? '').trim(),
    model: String(base.model || DEFAULT_AI_REPLY_CONFIG.model).trim(),
    systemPrompt: String(base.systemPrompt || DEFAULT_AI_REPLY_CONFIG.systemPrompt).slice(0, 1000),
    triggerMode: ['mention', 'keyword', 'all'].includes(base.triggerMode)
      ? base.triggerMode
      : 'mention',
    mentionName: String(base.mentionName || DEFAULT_AI_REPLY_CONFIG.mentionName).trim().slice(0, 20),
    keywords: Array.isArray(base.keywords)
      ? base.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
      : [...DEFAULT_AI_REPLY_CONFIG.keywords],
    cooldownSec: clampInt(base.cooldownSec, 0, 600),
    perUserCooldownSec: clampInt(base.perUserCooldownSec, 0, 3600),
    maxInputLength: clampInt(base.maxInputLength, 20, 500),
    maxReplyLength: clampInt(base.maxReplyLength, 20, 300),
    speakReply: Boolean(base.speakReply),
    logReply: Boolean(base.logReply)
  }
}

export function toPublicAiReplyConfig(config: AiReplyConfig): AiReplyPublicConfig {
  const { apiKey: _apiKey, ...rest } = sanitizeAiReplyConfig(config)
  return { ...rest, hasApiKey: Boolean(config.apiKey.trim()) }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
