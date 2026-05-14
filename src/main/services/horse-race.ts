// 赛马互动小游戏 service（1.3+ 接入哈松币押注）
//
// 流程：主播配置 2-8 匹马 → start() 进入 enrolling 报名阶段
//      → 观众发"1"/"1 500"等弹幕选号 + 押哈松币
//      → 报名倒计时到 → 进入 racing 阶段
//      → 每 200ms 各匹马随机推进 + 6% 加速 / 4% 失蹄
//      → 第一匹到达终点 OR 总时长超 raceSec → 公布排名
//      → done 状态，押中第一名按金额比例瓜分总池（沿用竞猜结算逻辑）
//
// 与 GuessingService 区别：
// - guessing 由主播手动选赢家结算；horse 由算法跑出第一名自动结算
// - horse racing 阶段有 200ms tick 推 positions；guessing 没有动画阶段
//
// 弹幕格式（与竞猜一致）：
//   "1"        → 押 1 号马默认金额
//   "1 500"    → 押 1 号马 500 哈松币
//   "1,500"    → 同上
//   "1：500"   → 同上

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { OverlayBroadcaster } from '../actions/overlay'
import type { WalletStore } from './wallet-store'

export interface Horse {
  key: string // "1" / "2" / "A" 等
  name: string // "红马" / "黑马"
  emoji: string // 🐎 / 🐴 / 🦄 等
}

export interface HorseRaceConfig {
  horses: Horse[]
  enrollSec: number // 报名时长 10-60
  raceSec: number // 赛跑时长上限 10-30
  defaultBet: number // 弹幕只发马号不带金额时的默认押注（1.3+）
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}

export interface HorseRanking {
  horseKey: string
  position: number // 0-100
  rank: number // 1, 2, 3...
}

export interface HorseRaceBettor {
  bettorKey: string
  uid: string
  uname: string
  horseKey: string
  amount: number
}

export interface HorseRaceWinner {
  uname: string
  bet: number
  payout: number // 含本金返还
}

export type HorseRaceState =
  | { phase: 'idle' }
  | {
      phase: 'enrolling'
      config: HorseRaceConfig
      startedAt: number
      endsAt: number
      enrollments: Record<string, number> // horseKey → 押注人数
      bets: Record<string, number> // horseKey → 累计押注金额
      pool: number
      bettorCount: number
    }
  | {
      phase: 'racing'
      config: HorseRaceConfig
      startedAt: number
      positions: Record<string, number> // horseKey → 0-100 米
      enrollments: Record<string, number>
      bets: Record<string, number>
      pool: number
      bettorCount: number
    }
  | {
      phase: 'done'
      config: HorseRaceConfig
      endedAt: number
      rankings: HorseRanking[]
      enrollments: Record<string, number>
      bets: Record<string, number>
      pool: number
      bettorCount: number
      winners: HorseRaceWinner[] // 押中第一名的观众及奖金
      winnerBettors: string[] // 押中第一名的 uname 列表（最多 10，给老 Overlay 兼容字段）
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
const BOOST_CHANCE = 0.06
const BOOST_GAIN = 5
const STUMBLE_CHANCE = 0.04
const STUMBLE_LOSS = 0

// initialBalance fallback（主进程 ipc.ts 启动时 setInitialBalanceFallback 同步真值）
let INITIAL_BALANCE_FALLBACK = 1000
export function setHorseRaceInitialBalanceFallback(n: number): void {
  if (Number.isFinite(n) && n >= 0) INITIAL_BALANCE_FALLBACK = n
}

export class HorseRaceService {
  private state: HorseRaceState = { phase: 'idle' }
  private bus: Bus
  private overlay: OverlayBroadcaster
  private wallet: WalletStore
  private getCurrentRoomId: () => number | null
  private currencyName = '哈松币'

  // bettorKey → 押注详情。bettorKey 是复合 `${uid}|${uname}`（1.0.1 教训）
  private bettors = new Map<string, HorseRaceBettor>()

  private enrollTimer: NodeJS.Timeout | null = null
  private raceTimer: NodeJS.Timeout | null = null
  private raceStartedAt = 0
  private unsubBus: (() => void) | null = null

  // 节流推 enroll tick
  private lastTickPush = 0
  private pushTimer: NodeJS.Timeout | null = null

  private statusListeners = new Set<(s: HorseRaceState) => void>()

  constructor(
    bus: Bus,
    overlay: OverlayBroadcaster,
    wallet: WalletStore,
    getCurrentRoomId: () => number | null
  ) {
    this.bus = bus
    this.overlay = overlay
    this.wallet = wallet
    this.getCurrentRoomId = getCurrentRoomId
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

  start(rawConfig: HorseRaceConfig, currencyName: string): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'idle' && this.state.phase !== 'done') {
      return { ok: false, error: '已有进行中的赛马，先取消再开新一轮' }
    }
    if (this.getCurrentRoomId() == null) {
      return { ok: false, error: '直播间未连接' }
    }
    const v = validateConfig(rawConfig)
    if (!v.ok) return v

    const config = v.config
    this.currencyName = currencyName || '哈松币'
    const now = Date.now()
    const endsAt = now + config.enrollSec * 1000

    this.bettors.clear()
    const enrollments: Record<string, number> = {}
    const bets: Record<string, number> = {}
    for (const h of config.horses) {
      enrollments[h.key] = 0
      bets[h.key] = 0
    }

    this.state = {
      phase: 'enrolling',
      config,
      startedAt: now,
      endsAt,
      enrollments,
      bets,
      pool: 0,
      bettorCount: 0
    }

    this.attachBus()
    this.enrollTimer = setTimeout(() => this.startRace(), config.enrollSec * 1000)

    this.overlay.broadcast({
      kind: 'horserace.enroll-start',
      event: this.fakeEvent(now),
      extra: {
        horses: config.horses,
        endsAt,
        enrollments,
        bets,
        pool: 0,
        bettorCount: 0,
        currencyName: this.currencyName,
        defaultBet: config.defaultBet
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
    const roomId = this.getCurrentRoomId()
    this.clearTimers()
    this.detachBus()
    // 退还所有押注（racing 阶段也允许取消退款，比赛已开但还没出结果）
    if (roomId != null) {
      for (const b of this.bettors.values()) {
        this.wallet.refund(roomId, b.uid, b.uname, b.amount)
      }
    }
    this.bettors.clear()
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

    const positions: Record<string, number> = {}
    for (const h of cur.config.horses) positions[h.key] = 0

    this.raceStartedAt = Date.now()
    this.state = {
      phase: 'racing',
      config: cur.config,
      startedAt: this.raceStartedAt,
      positions,
      enrollments: cur.enrollments,
      bets: cur.bets,
      pool: cur.pool,
      bettorCount: cur.bettorCount
    }

    this.overlay.broadcast({
      kind: 'horserace.race-start',
      event: this.fakeEvent(this.raceStartedAt),
      extra: {
        horses: cur.config.horses,
        positions,
        enrollments: cur.enrollments,
        bets: cur.bets,
        pool: cur.pool,
        bettorCount: cur.bettorCount,
        raceSec: cur.config.raceSec,
        currencyName: this.currencyName
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
      let delta = BASE_MIN + Math.random() * (BASE_MAX - BASE_MIN)
      const r = Math.random()
      if (r < BOOST_CHANCE) delta += BOOST_GAIN
      else if (r < BOOST_CHANCE + STUMBLE_CHANCE) delta = STUMBLE_LOSS
      positions[h.key] = Math.min(TRACK_LENGTH, positions[h.key] + delta)
      if (positions[h.key] >= TRACK_LENGTH) anyFinished = true
    }

    this.state = { ...cur, positions }
    this.notify()

    this.overlay.broadcast({
      kind: 'horserace.tick',
      event: this.fakeEvent(Date.now()),
      extra: { positions }
    })

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

    const roomId = this.getCurrentRoomId()

    // 按 position 降序排
    const sorted = [...cur.config.horses]
      .map((h) => ({ horseKey: h.key, position: cur.positions[h.key] ?? 0 }))
      .sort((a, b) => b.position - a.position)
    const rankings: HorseRanking[] = sorted.map((s, i) => ({ ...s, rank: i + 1 }))

    const winnerHorseKey = rankings[0].horseKey
    const winnerSidePool = cur.bets[winnerHorseKey] ?? 0
    const totalPool = cur.pool

    // 按金额比例瓜分总池（与竞猜结算一致），含本金返还。
    // 没人押中冠军：总池流失（庄家通吃）
    const winners: HorseRaceWinner[] = []
    const winnerBettors: string[] = []
    if (winnerSidePool > 0 && roomId != null) {
      for (const b of this.bettors.values()) {
        if (b.horseKey !== winnerHorseKey) continue
        const payout = Math.floor((b.amount / winnerSidePool) * totalPool)
        this.wallet.credit(roomId, b.uid, b.uname, payout)
        winners.push({ uname: b.uname, bet: b.amount, payout })
        if (winnerBettors.length < 10) winnerBettors.push(b.uname)
      }
    }

    const now = Date.now()
    this.state = {
      phase: 'done',
      config: cur.config,
      endedAt: now,
      rankings,
      enrollments: cur.enrollments,
      bets: cur.bets,
      pool: cur.pool,
      bettorCount: cur.bettorCount,
      winners,
      winnerBettors
    }

    this.overlay.broadcast({
      kind: 'horserace.result',
      event: this.fakeEvent(now),
      extra: {
        horses: cur.config.horses,
        rankings,
        enrollments: cur.enrollments,
        bets: cur.bets,
        pool: cur.pool,
        bettorCount: cur.bettorCount,
        winners,
        winnerBettors,
        winnerHorseKey,
        currencyName: this.currencyName
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
    if (this.state.phase !== 'enrolling') return
    if (e.kind !== 'danmu.received') return
    const text = (e.payload.content ?? '').trim()
    if (!text) return

    const cur = this.state
    const parsed = parseBet(text, cur.config.horses, cur.config.defaultBet)
    if (!parsed) return

    const cfg = cur.config
    if (cfg.requireAnchorFansMedal || cfg.minFansMedalLevel > 0) {
      const m = e.user.fansMedal
      if (!m) return
      if (cfg.requireAnchorFansMedal && !m.isAnchor) return
      if (m.level < cfg.minFansMedalLevel) return
    }

    const roomId = this.getCurrentRoomId()
    if (roomId == null) return

    const uname = e.user.uname || '观众'
    const bettorKey = `${e.user.uid || '0'}|${uname}`
    if (!e.user.uid && !uname) return

    const prev = this.bettors.get(bettorKey)
    if (prev && prev.horseKey !== parsed.horseKey) {
      // 改选号：退还之前的押注，押新的
      this.wallet.refund(roomId, e.user.uid, uname, prev.amount)
      const bets = { ...cur.bets }
      const enrollments = { ...cur.enrollments }
      bets[prev.horseKey] = Math.max(0, (bets[prev.horseKey] ?? 0) - prev.amount)
      enrollments[prev.horseKey] = Math.max(0, (enrollments[prev.horseKey] ?? 0) - 1)
      this.state = {
        ...cur,
        bets,
        enrollments,
        pool: cur.pool - prev.amount,
        bettorCount: Math.max(0, cur.bettorCount - 1)
      }
      this.bettors.delete(bettorKey)
    }

    const actualDeducted = this.wallet.deduct(
      roomId,
      e.user.uid,
      uname,
      parsed.amount,
      INITIAL_BALANCE_FALLBACK
    )
    if (actualDeducted <= 0) {
      console.log(`[HorseRace] ${uname} 余额不足，本次押注 ${parsed.amount} 失败`)
      return
    }

    const existing = this.bettors.get(bettorKey)
    if (existing) {
      // 同号追加
      existing.amount += actualDeducted
    } else {
      this.bettors.set(bettorKey, {
        bettorKey,
        uid: e.user.uid || '0',
        uname,
        horseKey: parsed.horseKey,
        amount: actualDeducted
      })
    }

    const curState = this.state
    if (curState.phase !== 'enrolling') return
    const bets = { ...curState.bets }
    const enrollments = { ...curState.enrollments }
    bets[parsed.horseKey] = (bets[parsed.horseKey] ?? 0) + actualDeducted
    if (!existing) {
      enrollments[parsed.horseKey] = (enrollments[parsed.horseKey] ?? 0) + 1
    }
    this.state = {
      ...curState,
      bets,
      enrollments,
      pool: curState.pool + actualDeducted,
      bettorCount: this.bettors.size
    }

    console.log(
      `[HorseRace] ${uname} 押 ${parsed.horseKey} ${actualDeducted}` +
        `（请求 ${parsed.amount}）· 池 ${this.state.pool}`
    )

    this.notify()
    this.scheduleEnrollPush()
  }

  /** 报名期间 enroll tick 节流推 overlay (300ms) */
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
      extra: {
        enrollments: this.state.enrollments,
        bets: this.state.bets,
        pool: this.state.pool,
        bettorCount: this.state.bettorCount
      }
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
    this.bettors.clear()
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
  const defaultBet = Math.max(1, Math.round(c.defaultBet ?? 100))

  return {
    ok: true,
    config: {
      horses,
      enrollSec: Math.round(c.enrollSec),
      raceSec: Math.round(c.raceSec),
      defaultBet,
      requireAnchorFansMedal: Boolean(c.requireAnchorFansMedal),
      minFansMedalLevel: Math.max(0, Math.min(40, Math.round(c.minFansMedalLevel ?? 0)))
    }
  }
}

/**
 * 解析弹幕押注。返回 null 表示这条弹幕不是有效押注。
 * key 必须严格等于 horse.key（避免"1 万"被识别成"1"）
 * 与 guessing.parseBet 几乎相同，结构维持一致
 */
function parseBet(
  text: string,
  horses: Horse[],
  defaultBet: number
): { horseKey: string; amount: number } | null {
  const parts = text.split(/[\s,，：:]+/).filter((p) => p.length > 0)
  if (parts.length === 0) return null

  const key = parts[0]
  const matched = horses.find((h) => h.key === key)
  if (!matched) return null

  let amount = defaultBet
  if (parts.length >= 2) {
    const n = Number(parts[1])
    if (Number.isFinite(n) && n > 0) {
      amount = Math.floor(n)
    }
  }
  amount = Math.max(1, Math.min(100000, amount))

  return { horseKey: matched.key, amount }
}
