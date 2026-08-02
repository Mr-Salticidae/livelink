import type { TTSPlayer } from '../actions/tts'
import type { Bus } from '../events/bus'
import type { StandardEvent } from '../platform/adapter'
import {
  sanitizeDanmuReaderConfig,
  type DanmuReaderConfig,
  type ReaderScope
} from '../../shared/danmu-reader'
import { dedupeKey, normalizeDanmuForSpeech, type SkipReason } from './danmu-text'
import { isSpeechClaimed } from './speech-claim'

/** 没念的原因。UI 上把它翻译成人话，主播才知道"为什么这条没念" */
export type ReaderSkipReason = SkipReason | 'scope' | 'blocked' | 'handled' | 'user-cooldown' | 'duplicate'

export interface ReaderRecentItem {
  at: number
  uname: string
  text: string
}

export interface DanmuReaderStats {
  /** 累计念出的条数（进程内） */
  spoken: number
  /** 累计跳过的条数（进程内） */
  skipped: number
  /** 各原因跳过了多少条，用来解释"怎么一条都不念" */
  skipReasons: Partial<Record<ReaderSkipReason, number>>
  /** 最近念过的几条，给 UI 做"确实在工作"的可见反馈 */
  recent: ReaderRecentItem[]
}

const RECENT_LIMIT = 8
// perUserAt / recentKeys 的清理阈值。直播间人多，不清会一直涨
const MAP_PRUNE_SIZE = 600

export class DanmuReaderService {
  private bus: Bus
  private tts: TTSPlayer
  private getConfig: () => DanmuReaderConfig
  private unsubBus: (() => void) | null = null

  private perUserAt = new Map<string, number>()
  private recentKeyAt = new Map<string, number>()
  private spoken = 0
  private skipped = 0
  private skipReasons: Partial<Record<ReaderSkipReason, number>> = {}
  private recent: ReaderRecentItem[] = []

  constructor(deps: { bus: Bus; tts: TTSPlayer; getConfig: () => DanmuReaderConfig }) {
    this.bus = deps.bus
    this.tts = deps.tts
    this.getConfig = deps.getConfig
  }

  attach(): void {
    if (this.unsubBus) return
    const handler = (e: StandardEvent): void => this.handle(e)
    this.bus.on('event', handler)
    this.unsubBus = () => this.bus.off('event', handler)
  }

  dispose(): void {
    this.unsubBus?.()
    this.unsubBus = null
    this.perUserAt.clear()
    this.recentKeyAt.clear()
  }

  getStats(): DanmuReaderStats {
    return {
      spoken: this.spoken,
      skipped: this.skipped,
      skipReasons: { ...this.skipReasons },
      recent: [...this.recent]
    }
  }

  /** 换房间 / 断开时清掉冷却与去重记录，避免上一场的状态影响下一场 */
  resetRuntime(): void {
    this.perUserAt.clear()
    this.recentKeyAt.clear()
  }

  /**
   * 试听：拿一条假弹幕走完整条净化 + 模板流程，让主播在设置页就能听到实际效果。
   * 不走 scope / 冷却 / 去重，只验净化和模板。
   */
  preview(sample: string, uname = '观众甲'): { spoken: string; reason?: ReaderSkipReason } {
    const config = sanitizeDanmuReaderConfig(this.getConfig())
    const result = normalizeDanmuForSpeech(sample, {
      stripEmotes: config.stripEmotes,
      skipUrls: config.skipUrls,
      collapseRepeats: config.collapseRepeats,
      minLength: config.minLength,
      maxLength: config.maxLength
    })
    if (!result.text) return { spoken: '', reason: result.reason }
    return { spoken: renderSpeech(config.template, uname, result.text) }
  }

  private handle(e: StandardEvent): void {
    if (e.kind !== 'danmu.received') return
    const config = sanitizeDanmuReaderConfig(this.getConfig())
    if (!config.enabled) return

    // 已经被规则或 AI 回复接管播报的，不再重复念
    if (config.skipHandled && isSpeechClaimed(e)) return this.countSkip('handled')

    const raw = (e.payload.content ?? '').trim()
    if (!raw) return this.countSkip('empty')

    if (config.blockKeywords.some((k) => raw.includes(k))) return this.countSkip('blocked')
    if (!inScope(config, e, raw)) return this.countSkip('scope')

    // scope=keyword 时，触发词本身不该念出来（"念一下 今天天气" → 只念"今天天气"）
    const body = config.scope === 'keyword' ? stripKeywords(raw, config.keywords) : raw

    const result = normalizeDanmuForSpeech(body, {
      stripEmotes: config.stripEmotes,
      skipUrls: config.skipUrls,
      collapseRepeats: config.collapseRepeats,
      minLength: config.minLength,
      maxLength: config.maxLength
    })
    if (!result.text) return this.countSkip(result.reason ?? 'empty')

    const now = Date.now()
    const uid = e.user.uid || '0'
    if (config.perUserCooldownSec > 0) {
      const last = this.perUserAt.get(uid) ?? 0
      if (now - last < config.perUserCooldownSec * 1000) return this.countSkip('user-cooldown')
    }
    if (config.dedupeWindowSec > 0) {
      const key = dedupeKey(result.text)
      const last = this.recentKeyAt.get(key) ?? 0
      if (key && now - last < config.dedupeWindowSec * 1000) return this.countSkip('duplicate')
      if (key) this.recentKeyAt.set(key, now)
    }
    this.perUserAt.set(uid, now)
    this.prune(now)

    const uname = e.user.uname || '观众'
    const speech = renderSpeech(config.template, uname, result.text)
    // 优先级固定 low：弹幕朗读永远让位给礼物 / SC / 上舰的感谢播报，
    // 念不过来时由 TTSPlayer 丢掉最旧的弹幕，而不是把付费反馈挤掉
    this.tts.enqueue(speech, {
      eventKind: 'danmu.received',
      voiceOverride: config.voice || undefined,
      priority: 'low'
    })

    this.spoken += 1
    this.recent.unshift({ at: now, uname, text: result.text })
    if (this.recent.length > RECENT_LIMIT) this.recent.length = RECENT_LIMIT
  }

  private countSkip(reason: ReaderSkipReason): void {
    this.skipped += 1
    this.skipReasons[reason] = (this.skipReasons[reason] ?? 0) + 1
  }

  /** 冷却 / 去重表按时间窗清理，长时间直播下不会无限增长 */
  private prune(now: number): void {
    if (this.perUserAt.size > MAP_PRUNE_SIZE) {
      const cutoff = now - 10 * 60_000
      for (const [k, v] of this.perUserAt) if (v < cutoff) this.perUserAt.delete(k)
    }
    if (this.recentKeyAt.size > MAP_PRUNE_SIZE) {
      const cutoff = now - 10 * 60_000
      for (const [k, v] of this.recentKeyAt) if (v < cutoff) this.recentKeyAt.delete(k)
    }
  }
}

function inScope(config: DanmuReaderConfig, e: StandardEvent, raw: string): boolean {
  const scope: ReaderScope = config.scope
  if (scope === 'all') return true
  if (scope === 'guard') return (e.user.guardLevel ?? 0) > 0
  if (scope === 'medal') {
    const m = e.user.fansMedal
    if (!m) return false
    if (config.requireAnchorMedal && !m.isAnchor) return false
    return m.level >= config.minMedalLevel
  }
  if (scope === 'keyword') {
    if (config.keywords.length === 0) return false
    return config.keywords.some((k) => raw.includes(k))
  }
  return false
}

function stripKeywords(raw: string, keywords: string[]): string {
  let text = raw
  for (const k of keywords) {
    if (!k) continue
    text = text.split(k).join(' ')
  }
  const cleaned = text.replace(/\s+/g, ' ').trim()
  // 整条就是触发词本身时不要清成空串，否则会被判成 empty 而不是"没内容"
  return cleaned || raw
}

function renderSpeech(template: string, uname: string, content: string): string {
  return template.split('{uname}').join(uname).split('{content}').join(content)
}
