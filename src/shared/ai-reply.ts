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
  // 打码后的 Key（sk-abcd……wxyz）。主播说"我明明填了 Key"时，
  // 页面得能拿出证据：存进去的到底是不是他刚粘的那一串。
  apiKeyHint: string
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

// Key 是从 DeepSeek 网页 / 微信 / 记事本里复制过来的，粘贴时经常带上肉眼看不见的脏字符：
// 前后换行、全角空格、零宽字符、复制富文本带来的 BOM。这些字符
//   · 只 trim() 的话清不掉中间的那些
//   · 留在 Key 里会让 Authorization 头非法，fetch 直接抛 "Invalid header value"，
//     主播看到的是一句完全看不懂的英文报错
// DeepSeek 的 Key 本身是 sk- 加一串 ASCII，不含任何空白，所以整串清干净是安全的。
export function normalizeApiKey(raw: unknown): string {
  return String(raw ?? '').replace(/[\s\u200B-\u200D]/g, '')
}

// 给页面看的打码 Key：太短就整串打码，避免把一个短 Key 直接露出来
export function maskApiKey(key: string): string {
  const k = normalizeApiKey(key)
  if (!k) return ''
  if (k.length <= 12) return `${k.slice(0, 2)}${'•'.repeat(6)}`
  return `${k.slice(0, 6)}${'•'.repeat(6)}${k.slice(-4)}`
}

export function sanitizeAiReplyConfig(config: Partial<AiReplyConfig>): AiReplyConfig {
  const base = { ...DEFAULT_AI_REPLY_CONFIG, ...config }
  return {
    enabled: Boolean(base.enabled),
    apiKey: normalizeApiKey(base.apiKey),
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

// 合并一次页面提交的改动。Key 的三种语义在这里定死，主进程和页面都照这个走：
//   patch 里没有 apiKey 字段 = 不动已保存的 Key（改冷却 / 人格时不用把 Key 再粘一遍）
//   apiKey 是空串            = 主播主动点了"清除 Key"
//   apiKey 有内容            = 覆盖成新的
export function mergeAiReplyPatch(
  current: AiReplyConfig,
  patch: Partial<AiReplyConfig>
): AiReplyConfig {
  return sanitizeAiReplyConfig({
    ...current,
    ...patch,
    apiKey: patch.apiKey === undefined ? current.apiKey : normalizeApiKey(patch.apiKey)
  })
}

export function toPublicAiReplyConfig(config: AiReplyConfig): AiReplyPublicConfig {
  const sanitized = sanitizeAiReplyConfig(config)
  const { apiKey, ...rest } = sanitized
  return { ...rest, hasApiKey: Boolean(apiKey), apiKeyHint: maskApiKey(apiKey) }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
