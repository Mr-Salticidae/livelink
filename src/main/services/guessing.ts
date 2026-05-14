// 竞猜 service —— 主播开局发起竞猜，观众弹幕押注哈松币，买定离手后主播手动结算
//
// 流程：start(config) → enrolling 押注期 → 倒计时到自动 → settling 等主播选赢家
//      → settle(winnerKey) → done，押中赢家按金额比例瓜分总池
//
// 与 voting/horserace 区别：
// - 押注带"金额"（哈松币），需要扣 / 加观众钱包余额
// - 主播手动结算（不像 voting 倒计时到自动出赢家）
// - 分钱按金额比例（押多得多）

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { OverlayBroadcaster } from '../actions/overlay'
import type { WalletStore } from './wallet-store'

export interface GuessingOption {
  key: string
  label: string
}

export interface GuessingConfig {
  title: string
  options: GuessingOption[]
  enrollSec: number // 买定离手倒计时
  defaultBet: number // 弹幕只发 key 不带金额时的默认押注
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}

export interface GuessingBettor {
  bettorKey: string
  uid: string
  uname: string
  optionKey: string
  amount: number
}

export interface GuessingWinner {
  uname: string
  bet: number
  payout: number // 包含本金返还
}

export type GuessingState =
  | { phase: 'idle' }
  | {
      phase: 'enrolling'
      config: GuessingConfig
      startedAt: number
      endsAt: number
      pool: number
      bets: Record<string, number> // optionKey → 累计押注金额
      bettorCount: number
    }
  | {
      phase: 'settling'
      config: GuessingConfig
      pool: number
      bets: Record<string, number>
      bettorCount: number
    }
  | {
      phase: 'done'
      config: GuessingConfig
      winnerKey: string
      winners: GuessingWinner[]
      pool: number
      bets: Record<string, number>
    }

const MIN_ENROLL = 10
const MAX_ENROLL = 600
const MIN_OPTIONS = 2
const MAX_OPTIONS = 8

export class GuessingService {
  private state: GuessingState = { phase: 'idle' }
  private bus: Bus
  private overlay: OverlayBroadcaster
  private wallet: WalletStore
  private getCurrentRoomId: () => number | null

  // 押注记录：bettorKey → { uid, uname, optionKey, amount }
  private bettors = new Map<string, GuessingBettor>()
  private endTimer: NodeJS.Timeout | null = null
  private unsubBus: (() => void) | null = null

  private lastTickPush = 0
  private pushTimer: NodeJS.Timeout | null = null

  private statusListeners = new Set<(s: GuessingState) => void>()

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

  getState(): GuessingState {
    return this.state
  }

  onStatusChange(cb: (s: GuessingState) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.statusListeners) {
      try {
        l(this.state)
      } catch (err) {
        console.error('[Guessing] listener', err)
      }
    }
  }

  start(rawConfig: GuessingConfig, currencyName: string): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'idle' && this.state.phase !== 'done') {
      return { ok: false, error: '已有进行中的竞猜，先取消或结算再开新一轮' }
    }
    if (this.getCurrentRoomId() == null) {
      return { ok: false, error: '直播间未连接' }
    }
    const v = validateConfig(rawConfig)
    if (!v.ok) return v

    const config = v.config
    const now = Date.now()
    const endsAt = now + config.enrollSec * 1000

    this.bettors.clear()
    const bets: Record<string, number> = {}
    for (const o of config.options) bets[o.key] = 0

    this.state = {
      phase: 'enrolling',
      config,
      startedAt: now,
      endsAt,
      pool: 0,
      bets,
      bettorCount: 0
    }

    this.attachBus()
    this.endTimer = setTimeout(() => this.lockBets(), config.enrollSec * 1000)

    this.overlay.broadcast({
      kind: 'guessing.start',
      event: this.fakeEvent(now),
      extra: {
        title: config.title,
        options: config.options,
        endsAt,
        bets,
        pool: 0,
        bettorCount: 0,
        currencyName,
        defaultBet: config.defaultBet
      }
    })

    this.notify()
    return { ok: true }
  }

  /** 提前买定离手（不取消，进入 settling 等主播选赢家） */
  lockNow(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'enrolling') return { ok: false, error: '不在押注阶段' }
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.lockBets()
    return { ok: true }
  }

  /** 主播选赢家结算 */
  settle(winnerKey: string): { ok: true; winners: GuessingWinner[] } | { ok: false; error: string } {
    if (this.state.phase !== 'settling') return { ok: false, error: '不在等待结算阶段' }
    const cur = this.state
    const opt = cur.config.options.find((o) => o.key === winnerKey)
    if (!opt) return { ok: false, error: `没有选项 "${winnerKey}"` }

    const roomId = this.getCurrentRoomId()
    if (roomId == null) return { ok: false, error: '直播间已断开，无法结算' }

    const winnerSidePool = cur.bets[winnerKey] ?? 0
    const totalPool = cur.pool

    const winners: GuessingWinner[] = []
    if (winnerSidePool > 0) {
      // 按比例分总池：每个赢家拿 (自己押金 / 赢家方总押) × 总池
      // 包含本金返还。押错方的人就 100% 输了押的（已扣，不退）
      for (const b of this.bettors.values()) {
        if (b.optionKey !== winnerKey) continue
        const payout = Math.floor((b.amount / winnerSidePool) * totalPool)
        this.wallet.credit(roomId, b.uid, b.uname, payout)
        winners.push({ uname: b.uname, bet: b.amount, payout })
      }
    } else {
      // 没人押中赢家方 → 总池保留给主播（实际：钱不退给输家，也不发给任何人，意为"庄家"通吃）
      // 简化：直接把这些币当作"流失"
    }

    this.state = {
      phase: 'done',
      config: cur.config,
      winnerKey,
      winners,
      pool: totalPool,
      bets: cur.bets
    }

    this.overlay.broadcast({
      kind: 'guessing.result',
      event: this.fakeEvent(Date.now()),
      extra: {
        title: cur.config.title,
        options: cur.config.options,
        winnerKey,
        winnerLabel: opt.label,
        winners,
        pool: totalPool,
        bets: cur.bets
      }
    })

    this.notify()
    return { ok: true, winners }
  }

  /** 取消竞猜：所有押注退还 */
  cancel(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase === 'idle' || this.state.phase === 'done') {
      return { ok: false, error: '没有进行中的竞猜' }
    }
    const roomId = this.getCurrentRoomId()
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    // 退还所有押注
    if (roomId != null) {
      for (const b of this.bettors.values()) {
        this.wallet.refund(roomId, b.uid, b.uname, b.amount)
      }
    }
    this.detachBus()
    this.bettors.clear()
    this.state = { phase: 'idle' }

    this.overlay.broadcast({ kind: 'guessing.cancelled', event: this.fakeEvent(Date.now()) })
    this.notify()
    return { ok: true }
  }

  reset(): void {
    if (this.state.phase === 'done') {
      this.state = { phase: 'idle' }
      this.notify()
    }
  }

  /** enrolling 倒计时到 → 进入 settling（等主播选赢家） */
  private lockBets(): void {
    if (this.state.phase !== 'enrolling') return
    const cur = this.state
    this.detachBus() // 不再接受押注
    this.state = {
      phase: 'settling',
      config: cur.config,
      pool: cur.pool,
      bets: cur.bets,
      bettorCount: cur.bettorCount
    }
    this.overlay.broadcast({
      kind: 'guessing.locked',
      event: this.fakeEvent(Date.now()),
      extra: {
        title: cur.config.title,
        options: cur.config.options,
        bets: cur.bets,
        pool: cur.pool,
        bettorCount: cur.bettorCount
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
    const parsed = parseBet(text, cur.config.options, cur.config.defaultBet)
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

    const initialBalance = INITIAL_BALANCE_FALLBACK // 主进程 ipc.ts 注入实际值 ... 但简化用常量

    const prev = this.bettors.get(bettorKey)
    if (prev && prev.optionKey !== parsed.optionKey) {
      // 改选项：退还之前的押注，押新的
      this.wallet.refund(roomId, e.user.uid, uname, prev.amount)
      // 池子里也要扣
      const bets = { ...cur.bets }
      bets[prev.optionKey] = Math.max(0, (bets[prev.optionKey] ?? 0) - prev.amount)
      this.state = { ...cur, bets, pool: cur.pool - prev.amount }
      this.bettors.delete(bettorKey)
    }

    // 扣余额（实际能扣多少看余额）
    const actualDeducted = this.wallet.deduct(
      roomId,
      e.user.uid,
      uname,
      parsed.amount,
      initialBalance
    )
    if (actualDeducted <= 0) {
      console.log(`[Guessing] ${uname} 余额不足，本次押注 ${parsed.amount} 失败`)
      return
    }

    // 累加押注（同选项追加）
    const existing = this.bettors.get(bettorKey)
    if (existing) {
      existing.amount += actualDeducted
    } else {
      this.bettors.set(bettorKey, {
        bettorKey,
        uid: e.user.uid || '0',
        uname,
        optionKey: parsed.optionKey,
        amount: actualDeducted
      })
    }

    // 更新 state
    const curState = this.state
    if (curState.phase !== 'enrolling') return
    const bets = { ...curState.bets }
    bets[parsed.optionKey] = (bets[parsed.optionKey] ?? 0) + actualDeducted
    this.state = {
      ...curState,
      bets,
      pool: curState.pool + actualDeducted,
      bettorCount: this.bettors.size
    }

    console.log(
      `[Guessing] ${uname} 押 ${parsed.optionKey} ${actualDeducted}（请求 ${parsed.amount}）` +
        ` · 池 ${this.state.pool}`
    )

    this.notify()
    this.scheduleTick()
  }

  private scheduleTick(): void {
    const now = Date.now()
    const elapsed = now - this.lastTickPush
    const PUSH_INTERVAL = 500
    if (elapsed >= PUSH_INTERVAL) {
      this.pushTick()
      return
    }
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.pushTick()
    }, PUSH_INTERVAL - elapsed)
  }
  private pushTick(): void {
    if (this.state.phase !== 'enrolling') return
    this.lastTickPush = Date.now()
    this.overlay.broadcast({
      kind: 'guessing.tick',
      event: this.fakeEvent(Date.now()),
      extra: {
        bets: this.state.bets,
        pool: this.state.pool,
        bettorCount: this.state.bettorCount
      }
    })
  }

  private fakeEvent(timestamp: number): StandardEvent {
    return {
      kind: 'viewer.enter',
      platform: 'bilibili',
      timestamp,
      user: { uid: '0', uname: '竞猜系统' },
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
    this.bettors.clear()
    this.state = { phase: 'idle' }
  }
}

// 余额不足相关：deduct() 需要 initialBalance 参数（首次开户用），
// 简化方式是 service 持有一个 fallback 常量。真值由 ipc.ts 写 config 时同步
// 实际架构：ipc 层 start() 时把 currency.initialBalance 注入到 service，
// 简化版用常量 + setter
let INITIAL_BALANCE_FALLBACK = 1000

export function setInitialBalanceFallback(n: number): void {
  if (Number.isFinite(n) && n >= 0) INITIAL_BALANCE_FALLBACK = n
}

function validateConfig(
  c: GuessingConfig
): { ok: true; config: GuessingConfig } | { ok: false; error: string } {
  const title = (c.title ?? '').trim()
  if (!title) return { ok: false, error: '标题不能为空' }
  if (title.length > 60) return { ok: false, error: '标题最多 60 字' }

  const options = (c.options ?? [])
    .map((o) => ({ key: (o.key ?? '').trim(), label: (o.label ?? '').trim() }))
    .filter((o) => o.key.length > 0 && o.label.length > 0)
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return { ok: false, error: `选项要 ${MIN_OPTIONS}-${MAX_OPTIONS} 个` }
  }
  const keys = new Set(options.map((o) => o.key))
  if (keys.size !== options.length) return { ok: false, error: '选项 key 不能重复' }
  for (const o of options) {
    if (o.key.length > 8) return { ok: false, error: `选项 key 最多 8 字：${o.key}` }
    if (o.label.length > 30) return { ok: false, error: `选项名最多 30 字：${o.label}` }
  }

  if (!Number.isFinite(c.enrollSec) || c.enrollSec < MIN_ENROLL || c.enrollSec > MAX_ENROLL) {
    return { ok: false, error: `押注时长要 ${MIN_ENROLL}-${MAX_ENROLL} 秒` }
  }
  const defaultBet = Math.max(1, Math.round(c.defaultBet ?? 100))

  return {
    ok: true,
    config: {
      title,
      options,
      enrollSec: Math.round(c.enrollSec),
      defaultBet,
      requireAnchorFansMedal: Boolean(c.requireAnchorFansMedal),
      minFansMedalLevel: Math.max(0, Math.min(40, Math.round(c.minFansMedalLevel ?? 0)))
    }
  }
}

/**
 * 解析弹幕押注。返回 null 表示这条弹幕不是有效押注。
 * 支持格式：
 *   "1"           → 押选项 "1" 默认金额
 *   "1 200"       → 押选项 "1" 200 哈松币
 *   "1, 200"      → 同上
 *   "1：200"      → 同上
 *   "拉夫"        → 押 key="拉夫" 默认
 *   "拉夫 500"    → 押 key="拉夫" 500
 *
 * 关键：key 必须 exactly 等于 option.key（前缀匹配会让"1 万"被识别成"1"，
 * 所以严格相等更安全）
 */
function parseBet(
  text: string,
  options: GuessingOption[],
  defaultBet: number
): { optionKey: string; amount: number } | null {
  // 先尝试"key amount"分两段
  const parts = text.split(/[\s,，：:]+/).filter((p) => p.length > 0)
  if (parts.length === 0) return null

  // parts[0] 必须严格等于某 option.key
  const key = parts[0]
  const matched = options.find((o) => o.key === key)
  if (!matched) return null

  // parts[1] 可选金额；解析失败回退默认
  let amount = defaultBet
  if (parts.length >= 2) {
    const n = Number(parts[1])
    if (Number.isFinite(n) && n > 0) {
      amount = Math.floor(n)
    }
  }
  // 单次押注上限保护：避免主播朋友错填 999999
  amount = Math.max(1, Math.min(100000, amount))

  return { optionKey: matched.key, amount }
}
