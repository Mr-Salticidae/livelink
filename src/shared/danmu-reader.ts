// 弹幕朗读（念弹幕）配置。主进程与渲染端共用，所以放 shared。
//
// 和「规则 + TTS action」的分工：
//   规则做的是"事件 → 固定话术"（欢迎 XX / 感谢 XX 的礼物），话术是主播写死的；
//   弹幕朗读做的是"把观众发的原文念出来"，内容来自观众，因此必须自带
//   净化（表情码 / 网址 / 复读）、去重、限流、黑名单这一整套防护，
//   否则直播间一刷屏，TTS 队列就会被垃圾文本占满。

/** 念谁的弹幕 */
export type ReaderScope =
  | 'all' // 所有人
  | 'guard' // 仅舰长 / 提督 / 总督
  | 'medal' // 仅佩戴粉丝牌且达到等级
  | 'keyword' // 仅包含指定关键词的弹幕

export interface DanmuReaderConfig {
  enabled: boolean
  scope: ReaderScope
  /** scope='medal' 时生效：粉丝牌最低等级 */
  minMedalLevel: number
  /** scope='medal' 时生效：是否必须是本直播间的牌子 */
  requireAnchorMedal: boolean
  /** scope='keyword' 时生效 */
  keywords: string[]
  /** 黑名单：命中任意一条就整条不念（对所有 scope 生效） */
  blockKeywords: string[]
  /** 朗读模板，支持 {uname} {content} 两个占位符 */
  template: string
  /** 朗读音色。空字符串 = 跟随 TTS 页的全局 / 分事件音色 */
  voice: string
  /** 净化后短于这个长度就不念（挡 "6" "哈" "。" 这类） */
  minLength: number
  /** 净化后超过这个长度就截断（截断处补「…」） */
  maxLength: number
  /** 同一个人多久内只念一条 */
  perUserCooldownSec: number
  /** 相同内容多久内不重复念（挡跟风复读） */
  dedupeWindowSec: number
  /** 去掉 [dog] [妙] 这类 B 站表情码 */
  stripEmotes: boolean
  /** 含网址的弹幕整条跳过 */
  skipUrls: boolean
  /** 把 666666 压成 666、哈哈哈哈哈 压成 哈哈哈 */
  collapseRepeats: boolean
  /** 已经被规则或 AI 回复接管播报的弹幕不再重复念 */
  skipHandled: boolean
}

export const DEFAULT_DANMU_READER_CONFIG: DanmuReaderConfig = {
  enabled: false,
  scope: 'all',
  minMedalLevel: 1,
  requireAnchorMedal: true,
  keywords: ['念一下', '读弹幕'],
  blockKeywords: [],
  template: '{uname}说：{content}',
  voice: '',
  minLength: 2,
  maxLength: 30,
  perUserCooldownSec: 5,
  dedupeWindowSec: 30,
  stripEmotes: true,
  skipUrls: true,
  collapseRepeats: true,
  skipHandled: true
}

const SCOPES: ReaderScope[] = ['all', 'guard', 'medal', 'keyword']

export function sanitizeDanmuReaderConfig(
  config: Partial<DanmuReaderConfig> | undefined | null
): DanmuReaderConfig {
  const base = { ...DEFAULT_DANMU_READER_CONFIG, ...(config ?? {}) }
  const template = String(base.template ?? '').slice(0, 120)
  return {
    enabled: Boolean(base.enabled),
    scope: SCOPES.includes(base.scope) ? base.scope : 'all',
    minMedalLevel: clampInt(base.minMedalLevel, 0, 40),
    requireAnchorMedal: Boolean(base.requireAnchorMedal),
    keywords: cleanList(base.keywords, DEFAULT_DANMU_READER_CONFIG.keywords),
    blockKeywords: cleanList(base.blockKeywords, []),
    // 模板必须至少包含 {content}，否则念出来的每条弹幕都一样，属于配废了
    template: template.includes('{content}') ? template : DEFAULT_DANMU_READER_CONFIG.template,
    voice: String(base.voice ?? '').trim(),
    minLength: clampInt(base.minLength, 1, 20),
    maxLength: clampInt(base.maxLength, 5, 80),
    perUserCooldownSec: clampInt(base.perUserCooldownSec, 0, 600),
    dedupeWindowSec: clampInt(base.dedupeWindowSec, 0, 600),
    stripEmotes: Boolean(base.stripEmotes),
    skipUrls: Boolean(base.skipUrls),
    collapseRepeats: Boolean(base.collapseRepeats),
    skipHandled: Boolean(base.skipHandled)
  }
}

function cleanList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const out: string[] = []
  for (const raw of value) {
    const s = String(raw ?? '').trim().slice(0, 30)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= 20) break
  }
  return out
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}
