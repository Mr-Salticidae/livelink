// 赛马互动小游戏 service
//
// 流程：主播配置 2-8 匹马 → start() 进入 enrolling 报名阶段
//      → 观众发"1"/"2"等弹幕选号（完全等于 horse.key）
//      → 报名倒计时到 → 进入 racing 阶段
//      → 每 200ms 各匹马随机推进 + 5% 概率"加速"/"减速"
//      → 第一匹到达终点 + 之后跑过的（含未跑完的按当前位置排）公布排名
//      → done 状态
//
// 与 VotingService 区别：
// - voting 同 uid 改投影响 totalVotes 不变；horse 同 uid 改选号 = 切换下注马
// - voting tick 推 counts；horse racing tick 推 positions (实时位置)
// - voting 有"赢家"；horse 有"排名 + 各马下注者列表"

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { OverlayBroadcaster } from '../actions/overlay'

export interface Horse {
  key: string // "1" / "2" / "A" 等
  name: string // "红马" / "黑马"
  emoji: string // 🐎 / 🐴 / 🦄 等
}

export interface HorseRaceConfig {
  horses: Horse[]
  enrollSec: number // 报名时长 10-60
  raceSec: number // 赛跑时长上限 10-30 (实际可能更短，赢家到达即结束)
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}

export interface HorseRanking {
  horseKey: string
  position: number // 0-100
  rank: number // 1, 2, 3...
}

export type HorseRaceState =
  | { phase: 'idle' }
  | {
      phase: 'enrolling'
      config: HorseRaceConfig
      startedAt: number
      endsAt: number
      enrollments: Record<string, number> // horseKey → 下注人数
    }
  | {
      phase: 'racing'
      config: HorseRaceConfig
      startedAt: number
      positions: Record<string, number> // horseKey → 0-100 米
      enrollments: Record<string, number>
    }
  | {
      phase: 'done'
      config: HorseRaceConfig
      endedAt: number
      rankings: HorseRanking[]
      enrollments: Record<string, number>
      winnerBettors: string[] // 押中第一名的观众 uname 列表（最多 10）
    }

const MIN_HORSES = 2
const MAX_HORSES = 8
const MIN_ENROLL = 10
const MAX_ENROLL = 60
const MIN_RACE = 10
const MAX_RACE = 30
const RACE_TICK_MS = 200
const TRACK_LENGTH = 100

// 每 tick 基础推进 [0.4, 1.4] 米，平均 0.9 米 → ~22s 跑完 100 米
const BASE_MIN = 0.4
const BASE_MAX = 1.4
const BOOST_CHANCE = 0.06 // 6% 触发加速
const BOOST_GAIN = 5 // 加速一次 +5 米
const STUMBLE_CHANCE = 0.04 // 4% 失蹄
const STUMBLE_LOSS = 0 // 失蹄当 tick 不进

export class HorseRaceService {
  private state: HorseRaceState = { phase: 'idle' }
  private bus: Bus
  private overlay: OverlayBroadcaster

  // 报名期间：bettorKey → horseKey（同观众后续选号覆盖）+ bettorKey → uname
  // bettorKey 是复合 `${uid}|${uname}` 防止 B 站匿名观众 uid=0 互相覆盖
  private bets = new Map<string, string>()
  private bettorUname = new Map<string, string>()

  private enrollTimer: NodeJS.Timeout | null = null
  private raceTimer: NodeJS.Timeout | null = null
  private raceStartedAt = 0
  private unsubBus: (() => void) | null = null

  // 节流推 enrollments / positions
  private lastTickPush = 0
  private pushTimer: NodeJS.Timeout | null = null

  private statusListeners = new Set<(s: HorseRaceState) => void>()

  constructor(bus: Bus, overlay: OverlayBroadcaster) {
    this.bus = bus
    this.overlay = overlay
  }

  getState(): HorseRaceState {
    return this.state
  }

  onStatusChange(cb: (s: HorseRaceState) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.statusListeners) {
      try { l(this.state) } catch (err) { console.error('[HorseRace] listener', err) }
    }
  }

  start(rawConfig: HorseRaceConfig): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'idle' && this.state.phase !== 'done') {
      return { ok: false, error: '已有进行中的赛马，先取消再开新一轮' }
    }
    const v = validateConfig(rawConfig)
    if (!v.ok) return v

    const config = v.config
    const now = Date.now()
    const endsAt = now + config.enrollSec * 1000

    this.bets.clear()
    this.bettorUname.clear()
    const enrollments: Record<string, number> = {}
    for (const h of config.horses) enrollments[h.key] = 0

    this.state = {
      phase: 'enrolling',
      config,
      startedAt: now,
      endsAt,
      enrollments
    }

    this.attachBus()
    this.enrollTimer = setTimeout(() => this.startRace(), config.enrollSec * 1000)

    this.overlay.broadcast({
      kind: 'horserace.enroll-start',
      event: this.fakeEvent(now),
      extra: {
        horses: config.horses,
        endsAt,
        enrollments
      }
    })

    this.notify()
    return { ok: true }
  }

  /** 报名期间提前结束报名直接开赛 */
  startNow(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'enrolling') return { ok: false, error: '不在报名阶段' }
    if (this.enrollTimer) {
      clearTimeout(this.enrollTimer)
      this.enrollTimer = null
    }
    this.startRace()
    return { ok: true }
  }

  cancel(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase === 'idle' || this.state.phase === 'done') {
      return { ok: false, error: '没有进行中的赛马' }
    }
    this.clearTimers()
    this.detachBus()
    this.bets.clear()
    this.bettorUname.clear()
    this.state = { phase: 'idle' }
    this.overlay.broadcast({ kind: 'horserace.cancelled', event: this.fakeEvent(Date.now()) })
    this.notify()
    return { ok: true }
  }

  reset(): void {
    if (this.state.phase === 'done') {
      this.state = { phase: 'idle' }
      this.notify()
    }
  }

  private startRace(): void {
    if (this.state.phase !== 'enrolling') return
    const cur = this.state

    // 报名期不再收集，但 bus 还需要保持（racing 期间忽略弹幕）
    const positions: Record<string, number> = {}
    for (const h of cur.config.horses) positions[h.key] = 0

    this.raceStartedAt = Date.now()
    this.state = {
      phase: 'racing',
      config: cur.config,
      startedAt: this.raceStartedAt,
      positions,
      enrollments: cur.enrollments
    }

    this.overlay.broadcast({
      kind: 'horserace.race-start',
      event: this.fakeEvent(this.raceStartedAt),
      extra: {
        horses: cur.config.horses,
        positions,
        enrollments: cur.enrollments,
        raceSec: cur.config.raceSec
      }
    })

    this.raceTimer = setInterval(() => this.raceTick(), RACE_TICK_MS)
    this.notify()
  }

  private raceTick(): void {
    if (this.state.phase !== 'racing') return
    const cur = this.state
    const positions = { ...cur.positions }

    let anyFinished = false
    for (const h of cur.config.horses) {
      if (positions[h.key] >= TRACK_LENGTH) continue
      // 基础推进
      let delta = BASE_MIN + Math.random() * (BASE_MAX - BASE_MIN)
      const r = Math.random()
      if (r < BOOST_CHANCE) delta += BOOST_GAIN
      else if (r < BOOST_CHANCE + STUMBLE_CHANCE) delta = STUMBLE_LOSS
      positions[h.key] = Math.min(TRACK_LENGTH, positions[h.key] + delta)
      if (positions[h.key] >= TRACK_LENGTH) anyFinished = true
    }

    this.state = { ...cur, positions }
    this.notify()

    // 节流推 overlay：racing 高频，200ms tick 直接每次推可以接受（10 匹马 * 5 字段 = 小数据量）
    this.overlay.broadcast({
      kind: 'horserace.tick',
      event: this.fakeEvent(Date.now()),
      extra: { positions }
    })

    // 终止条件：有马到终点 OR 总时长超过 raceSec
    const elapsedSec = (Date.now() - this.raceStartedAt) / 1000
    if (anyFinished || elapsedSec >= cur.config.raceSec) {
      this.finishRace()
    }
  }

  private finishRace(): void {
    if (this.state.phase !== 'racing') return
    if (this.raceTimer) {
      clearInterval(this.raceTimer)
      this.raceTimer = null
    }
    const cur = this.state
    this.detachBus()

    // 按 position 降序排
    const sorted = [...cur.config.horses]
      .map((h) => ({ horseKey: h.key, position: cur.positions[h.key] ?? 0 }))
      .sort((a, b) => b.position - a.position)
    const rankings: HorseRanking[] = sorted.map((s, i) => ({ ...s, rank: i + 1 }))

    // 押中第一名的下注者列表（最多 10 个 uname，避免太长）
    const winnerHorse = rankings[0].horseKey
    const winnerBettors: string[] = []
    for (const [bettorKey, bet] of this.bets.entries()) {
      if (bet === winnerHorse) {
        winnerBettors.push(this.bettorUname.get(bettorKey) ?? '观众')
        if (winnerBettors.length >= 10) break
      }
    }

    const now = Date.now()
    this.state = {
      phase: 'done',
      config: cur.config,
      endedAt: now,
      rankings,
      enrollments: cur.enrollments,
      winnerBettors
    }

    this.overlay.broadcast({
      kind: 'horserace.result',
      event: this.fakeEvent(now),
      extra: {
        horses: cur.config.horses,
        rankings,
        enrollments: cur.enrollments,
        winnerBettors,
        winnerHorseKey: winnerHorse
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
    // 只在 enrolling 阶段接受报名，racing / done 忽略弹幕
    if (this.state.phase !== 'enrolling') return
    if (e.kind !== 'danmu.received') return
    const text = (e.payload.content ?? '').trim()
    if (!text) return

    const cur = this.state
    const matched = cur.config.horses.find((h) => h.key === text)
    if (!matched) return

    const cfg = cur.config
    if (cfg.requireAnchorFansMedal || cfg.minFansMedalLevel > 0) {
      const m = e.user.fansMedal
      if (!m) return
      if (cfg.requireAnchorFansMedal && !m.isAnchor) return
      if (m.level < cfg.minFansMedalLevel) return
    }

    // 复合 dedupe key：B 站匿名观众 uid=0 时，单按 uid 会让所有人都被认作"同一人改投"
    const uname = e.user.uname || '观众'
    const bettorKey = `${e.user.uid || '0'}|${uname}`
    if (!e.user.uid && !uname) return

    const prev = this.bets.get(bettorKey)
    if (prev === matched.key) return
    const enrollments = { ...cur.enrollments }
    if (prev) enrollments[prev] = Math.max(0, (enrollments[prev] ?? 0) - 1)
    enrollments[matched.key] = (enrollments[matched.key] ?? 0) + 1
    this.bets.set(bettorKey, matched.key)
    this.bettorUname.set(bettorKey, uname)
    console.log(`[HorseRace] 押注: uid=${e.user.uid} uname=${uname} → ${matched.key}`)

    this.state = { ...cur, enrollments }
    this.notify()
    this.scheduleEnrollPush()
  }

  /** 报名期间 enrollments 变化节流推 overlay (300ms) */
  private scheduleEnrollPush(): void {
    const now = Date.now()
    const elapsed = now - this.lastTickPush
    const PUSH_INTERVAL = 300
    if (elapsed >= PUSH_INTERVAL) {
      this.pushEnrollments()
      return
    }
    if (this.pushTimer) return
    this.pushTimer = setTimeout(
      () => {
        this.pushTimer = null
        this.pushEnrollments()
      },
      PUSH_INTERVAL - elapsed
    )
  }
  private pushEnrollments(): void {
    if (this.state.phase !== 'enrolling') return
    this.lastTickPush = Date.now()
    this.overlay.broadcast({
      kind: 'horserace.enroll-tick',
      event: this.fakeEvent(Date.now()),
      extra: { enrollments: this.state.enrollments }
    })
  }

  private clearTimers(): void {
    if (this.enrollTimer) {
      clearTimeout(this.enrollTimer)
      this.enrollTimer = null
    }
    if (this.raceTimer) {
      clearInterval(this.raceTimer)
      this.raceTimer = null
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
  }

  private fakeEvent(timestamp: number): StandardEvent {
    return {
      kind: 'viewer.enter',
      platform: 'bilibili',
      timestamp,
      user: { uid: '0', uname: '赛马系统' },
      payload: {}
    }
  }

  dispose(): void {
    this.clearTimers()
    this.detachBus()
    this.bets.clear()
    this.bettorUname.clear()
    this.state = { phase: 'idle' }
  }
}

function validateConfig(
  c: HorseRaceConfig
): { ok: true; config: HorseRaceConfig } | { ok: false; error: string } {
  const horses = (c.horses ?? [])
    .map((h) => ({ key: (h.key ?? '').trim(), name: (h.name ?? '').trim(), emoji: (h.emoji ?? '🐎').trim() || '🐎' }))
    .filter((h) => h.key.length > 0 && h.name.length > 0)
  if (horses.length < MIN_HORSES || horses.length > MAX_HORSES) {
    return { ok: false, error: `马匹数要 ${MIN_HORSES}-${MAX_HORSES} 匹` }
  }
  const keys = new Set(horses.map((h) => h.key))
  if (keys.size !== horses.length) return { ok: false, error: '马匹号不能重复' }
  for (const h of horses) {
    if (h.key.length > 4) return { ok: false, error: `马匹号太长（最多 4 字）：${h.key}` }
    if (h.name.length > 20) return { ok: false, error: `马名太长（最多 20 字）：${h.name}` }
  }

  if (!Number.isFinite(c.enrollSec) || c.enrollSec < MIN_ENROLL || c.enrollSec > MAX_ENROLL) {
    return { ok: false, error: `报名时长要在 ${MIN_ENROLL}-${MAX_ENROLL} 秒之间` }
  }
  if (!Number.isFinite(c.raceSec) || c.raceSec < MIN_RACE || c.raceSec > MAX_RACE) {
    return { ok: false, error: `赛跑时长要在 ${MIN_RACE}-${MAX_RACE} 秒之间` }
  }

  return {
    ok: true,
    config: {
      horses,
      enrollSec: Math.round(c.enrollSec),
      raceSec: Math.round(c.raceSec),
      requireAnchorFansMedal: Boolean(c.requireAnchorFansMedal),
      minFansMedalLevel: Math.max(0, Math.min(40, Math.round(c.minFansMedalLevel ?? 0)))
    }
  }
}
