// 弹幕 → 可朗读文本的净化。纯函数、无副作用，方便 scripts/verify-danmu-reader.ts 直接跑断言。
//
// 为什么必须单独做这一层：规则里的话术是主播自己写的，可控；
// 弹幕原文是观众写的，什么都有——表情码 [dog]、外链、"6666666"、纯 emoji。
// 这些东西直接丢给 edge-tts，轻则念出一串没人听得懂的音，重则整条都是噪音，
// 还白白占掉 TTS 队列。所以先净化，净化不出内容就干脆不念。

export interface NormalizeOptions {
  stripEmotes: boolean
  skipUrls: boolean
  collapseRepeats: boolean
  minLength: number
  maxLength: number
}

/** reason 非空即表示这条不该念；调用方可以据此写日志解释"为什么没念" */
export type SkipReason = 'empty' | 'url' | 'too-short' | 'no-readable'

export interface NormalizeResult {
  text: string
  reason?: SkipReason
}

// 涉及不可见 / 生僻码点的正则一律用 new RegExp + '\\uXXXX' 字符串构造，
// 源码里保持纯 ASCII。原因：这个文件会被多种编辑工具反复改写，
// 字面量零宽字符存一次盘就可能被吃掉，而且肉眼完全看不出来。

// B 站表情码：[dog] [妙] [打call]。故意限长 12，避免把 "[这是一句很长的话]" 整段吞掉
const EMOTE_RE = /\[[^[\]]{1,12}\]/g

// 零宽 / 双向控制 / C0 控制字符：复制粘贴来的弹幕里很常见，会干扰长度判断
const INVISIBLE_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F' +
    '\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\uFEFF]',
  'g'
)

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi

// 裸域名：写死常见后缀，避免把 "3.5" "1.2万" 这种误判成网址
const BARE_DOMAIN_RE = /\b[a-z0-9-]+\.(?:com|cn|net|org|top|xyz|cc|me|tv|io|link|site)\b/gi

// emoji / 杂项符号：edge-tts 对这些要么跳过要么念出奇怪的词
const EMOJI_RE = new RegExp(
  '[\\u2190-\\u21FF\\u2300-\\u23FF\\u2460-\\u24FF\\u2600-\\u27BF' +
    '\\u2B00-\\u2BFF\\uFE0F\\u20E3]|[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]',
  'g'
)

// 至少要有一个"能念出声"的字符：汉字 / 假名 / 拉丁字母 / 数字
const READABLE_RE = new RegExp('[\\p{Script=Han}\\u3040-\\u30FFa-zA-Z0-9]', 'u')

export function normalizeDanmuForSpeech(raw: string, opts: NormalizeOptions): NormalizeResult {
  const source = (raw ?? '').replace(INVISIBLE_RE, '').trim()
  if (!source) return { text: '', reason: 'empty' }

  const hasUrl = matchesGlobal(URL_RE, source) || matchesGlobal(BARE_DOMAIN_RE, source)
  if (hasUrl && opts.skipUrls) return { text: '', reason: 'url' }

  let text = source
  if (hasUrl) {
    // 不跳过时也不能原样念——把链接换成"网址"两个字，保留句子其余部分
    text = text.replace(URL_RE, '网址').replace(BARE_DOMAIN_RE, '网址')
  }
  if (opts.stripEmotes) text = text.replace(EMOTE_RE, ' ')
  text = text.replace(EMOJI_RE, ' ')
  text = text.replace(/\s+/g, ' ').trim()

  if (opts.collapseRepeats) text = collapseRuns(text).trim()

  if (!text) return { text: '', reason: 'empty' }
  if (!READABLE_RE.test(text)) return { text: '', reason: 'no-readable' }

  const chars = Array.from(text)
  if (chars.length < opts.minLength) return { text: '', reason: 'too-short' }
  if (chars.length > opts.maxLength) text = chars.slice(0, opts.maxLength).join('') + '…'

  return { text }
}

/**
 * 压缩复读：6666666 → 666，哈哈哈哈哈哈 → 哈哈哈，加油加油加油加油 → 加油加油。
 * 先压单字符再压双字符单元，两轮都用码点级匹配（u 标志），避免拆坏 emoji 代理对。
 */
export function collapseRuns(input: string): string {
  return input.replace(/(.)\1{2,}/gu, '$1$1$1').replace(/(..)\1{2,}/gu, '$1$1')
}

/**
 * 去重用的比较键：抹掉大小写、空白和标点，让 "666！" 和 "666" 算同一条。
 * 只用于判重，不影响真正念出来的文本。
 */
export function dedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim()
}

/** 带 g 标志的正则有 lastIndex 粘性，test 完必须复位，否则下一条弹幕的判断会串 */
function matchesGlobal(re: RegExp, input: string): boolean {
  re.lastIndex = 0
  const hit = re.test(input)
  re.lastIndex = 0
  return hit
}
