// 互动投票 service —— 主播发起投票，观众弹幕投关键字（"1"/"A" 等），实时柱状图
//
// 流程：主播 UI 配置选项 → start() → 收集投票（弹幕严格等于 option.key 算一票）→
// 倒计时到 → end() 公布结果 → reset 回 idle
//
// 与 LotteryService 区别：
// - 投票：同 uid 后续可"改投"（最新一票覆盖之前），不强制去重保留首次
// - 匹配：弹幕 trim 后**完全等于** option.key 才算，避免"1毛"被误计

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { OverlayBroadcaster } from '../actions/overlay'

export interface VotingOption {
  key: string // 触发字符串，例如 "1" / "A"
  label: string // 显示名，例如 "米饭"
}

export interface VotingConfig {
  title: string
  options: VotingOption[]
  durationSec: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
  allowChangeVote: boolean // true=改投覆盖；false=同 uid 首次投票为准
}

export type VotingState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      config: VotingConfig
      startedAt: number
      endsAt: number
      counts: Record<string, number> // optionKey → 票数
      totalVotes: number
    }
  | {
      phase: 'done'
      config: VotingConfig
      endedAt: number
      counts: Record<string, number>
      totalVotes: number
      winnerKey: string | null // 票数最高的 option.key；并列时取 options 顺序里靠前的；0 票全空时 null
    }

const MIN_DURATION = 10
const MAX_DURATION = 600
const MIN_OPTIONS = 2
const MAX_OPTIONS = 6

export class VotingService {
  private state: VotingState = { phase: 'idle' }
  private bus: Bus
  private overlay: OverlayBroadcaster
  // uid → optionKey
  private votes = new Map<string, string>()
  private endTimer: NodeJS.Timeout | null = null
  private unsubBus: (() => void) | null = null

  private lastTickPush = 0
  private pushTimer: NodeJS.Timeout | null = null

  private statusListeners = new Set<(s: VotingState) => void>()

  constructor(bus: Bus, overlay: OverlayBroadcaster) {
    this.bus = bus
    this.overlay = overlay
  }

  getState(): VotingState {
    return this.state
  }

  onStatusChange(cb: (s: VotingState) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.statusListeners) {
      try {
        l(this.state)
      } catch (err) {
        console.error('[VotingService] status listener threw', err)
      }
    }
  }

  start(rawConfig: VotingConfig): { ok: true } | { ok: false; error: string } {
    if (this.state.phase === 'running') {
      return { ok: false, error: '已有进行中的投票，先取消再开新一轮' }
    }
    const v = validateConfig(rawConfig)
    if (!v.ok) return v

    const config = v.config
    const now = Date.now()
    const endsAt = now + config.durationSec * 1000

    this.votes.clear()
    const counts: Record<string, number> = {}
    for (const o of config.options) counts[o.key] = 0

    this.state = {
      phase: 'running',
      config,
      startedAt: now,
      endsAt,
      counts,
      totalVotes: 0
    }

    this.attachBus()
    this.endTimer = setTimeout(() => this.end(), config.durationSec * 1000)

    this.overlay.broadcast({
      kind: 'voting.start',
      event: this.fakeEvent(now),
      extra: {
        title: config.title,
        options: config.options,
        endsAt,
        durationSec: config.durationSec,
        counts
      }
    })

    this.notify()
    return { ok: true }
  }

  endNow(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'running') return { ok: false, error: '没有进行中的投票' }
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.end()
    return { ok: true }
  }

  cancel(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'running') return { ok: false, error: '没有进行中的投票' }
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.detachBus()
    this.votes.clear()
    this.state = { phase: 'idle' }

    this.overlay.broadcast({
      kind: 'voting.cancelled',
      event: this.fakeEvent(Date.now())
    })
    this.notify()
    return { ok: true }
  }

  reset(): void {
    if (this.state.phase === 'done') {
      this.state = { phase: 'idle' }
      this.notify()
    }
  }

  private end(): void {
    if (this.state.phase !== 'running') return
    const cur = this.state
    this.detachBus()

    // 并列时取 options 顺序里靠前的
    let winnerKey: string | null = null
    let winnerCount = -1
    for (const o of cur.config.options) {
      const c = cur.counts[o.key] ?? 0
      if (c > winnerCount) {
        winnerCount = c
        winnerKey = o.key
      }
    }
    if (winnerCount === 0) winnerKey = null // 全 0 票表示无人投

    const now = Date.now()
    this.state = {
      phase: 'done',
      config: cur.config,
      endedAt: now,
      counts: { ...cur.counts },
      totalVotes: cur.totalVotes,
      winnerKey
    }

    this.overlay.broadcast({
      kind: 'voting.result',
      event: this.fakeEvent(now),
      extra: {
        title: cur.config.title,
        options: cur.config.options,
        counts: this.state.counts,
        totalVotes: cur.totalVotes,
        winnerKey
      }
    })
    this.notify()
  }

  private attachBus(): void {
    const handler = (e: StandardEvent): void => this.handleEvent(e)
    this.bus.on('event', handler)
    this.unsubBus = () => this.bus.off('event', handler)
  }
  private detachBus(): void {
    this.unsubBus?.()
    this.unsubBus = null
  }

  private handleEvent(e: StandardEvent): void {
    if (this.state.phase !== 'running') return
    if (e.kind !== 'danmu.received') return
    const text = (e.payload.content ?? '').trim()
    if (!text) return

    const cur = this.state
    // 严格匹配：弹幕完全等于某 option.key（避免"1毛"被误计为"1"）
    const matched = cur.config.options.find((o) => o.key === text)
    if (!matched) return

    // 粉丝牌门槛
    const cfg = cur.config
    if (cfg.requireAnchorFansMedal || cfg.minFansMedalLevel > 0) {
      const m = e.user.fansMedal
      if (!m) return
      if (cfg.requireAnchorFansMedal && !m.isAnchor) return
      if (m.level < cfg.minFansMedalLevel) return
    }

    const uid = e.user.uid
    if (!uid) return

    const prev = this.votes.get(uid)
    if (prev === matched.key) return // 重复同选项无操作
    if (prev && !cfg.allowChangeVote) return // 不允许改投

    // 应用：扣除旧票（如有改投），加新票
    const counts = { ...cur.counts }
    let totalVotes = cur.totalVotes
    if (prev) {
      counts[prev] = Math.max(0, (counts[prev] ?? 0) - 1)
      // totalVotes 不变（改投不影响总票数）
    } else {
      totalVotes += 1
    }
    counts[matched.key] = (counts[matched.key] ?? 0) + 1
    this.votes.set(uid, matched.key)

    this.state = { ...cur, counts, totalVotes }
    this.notify()
    this.schedulePushTick()
  }

  /** 票数变化节流推 overlay (500ms) */
  private schedulePushTick(): void {
    const now = Date.now()
    const elapsed = now - this.lastTickPush
    const PUSH_INTERVAL = 500
    if (elapsed >= PUSH_INTERVAL) {
      this.pushTick()
      return
    }
    if (this.pushTimer) return
    this.pushTimer = setTimeout(
      () => {
        this.pushTimer = null
        this.pushTick()
      },
      PUSH_INTERVAL - elapsed
    )
  }
  private pushTick(): void {
    if (this.state.phase !== 'running') return
    this.lastTickPush = Date.now()
    this.overlay.broadcast({
      kind: 'voting.tick',
      event: this.fakeEvent(Date.now()),
      extra: { counts: this.state.counts, totalVotes: this.state.totalVotes }
    })
  }

  private fakeEvent(timestamp: number): StandardEvent {
    return {
      kind: 'viewer.enter',
      platform: 'bilibili',
      timestamp,
      user: { uid: '0', uname: '投票系统' },
      payload: {}
    }
  }

  dispose(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    this.detachBus()
    this.votes.clear()
    this.state = { phase: 'idle' }
  }
}

function validateConfig(c: VotingConfig): { ok: true; config: VotingConfig } | { ok: false; error: string } {
  const title = (c.title ?? '').trim()
  if (title.length === 0) return { ok: false, error: '投票标题不能为空' }
  if (title.length > 60) return { ok: false, error: '标题太长（最多 60 字）' }

  const opts = (c.options ?? [])
    .map((o) => ({ key: (o.key ?? '').trim(), label: (o.label ?? '').trim() }))
    .filter((o) => o.key.length > 0 && o.label.length > 0)
  if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) {
    return { ok: false, error: `选项要 ${MIN_OPTIONS}-${MAX_OPTIONS} 个，且 key 和名称都不能空` }
  }
  // key 不能重复
  const keys = new Set(opts.map((o) => o.key))
  if (keys.size !== opts.length) return { ok: false, error: '选项 key 不能重复' }
  // key 长度限制 1-4 字符（避免太长用户难发）
  for (const o of opts) {
    if (o.key.length > 4) return { ok: false, error: `选项 key 太长（最多 4 字）：${o.key}` }
    if (o.label.length > 30) return { ok: false, error: `选项名太长（最多 30 字）：${o.label}` }
  }

  if (!Number.isFinite(c.durationSec) || c.durationSec < MIN_DURATION || c.durationSec > MAX_DURATION) {
    return { ok: false, error: `倒计时要在 ${MIN_DURATION}-${MAX_DURATION} 秒之间` }
  }

  return {
    ok: true,
    config: {
      title,
      options: opts,
      durationSec: Math.round(c.durationSec),
      requireAnchorFansMedal: Boolean(c.requireAnchorFansMedal),
      minFansMedalLevel: Math.max(0, Math.min(40, Math.round(c.minFansMedalLevel ?? 0))),
      allowChangeVote: c.allowChangeVote !== false // 默认 true
    }
  }
}
