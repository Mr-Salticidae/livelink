// 弹幕抽奖 service —— 一轮抽奖的完整状态机
//
// 流程：主播在 UI 配置参数 → start() → 收集参与者（弹幕匹配关键词）→
// 倒计时到 → end() Fisher-Yates 洗牌取 N 名 → 推 overlay 公布 → reset 回 idle
//
// 不走规则引擎（抽奖是 stateful 的，规则引擎是 stateless 触发）。
// 直接订阅 bus 'event' 里的 danmu.received，自己过滤匹配 + 去重

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { OverlayBroadcaster } from '../actions/overlay'

export interface LotteryConfig {
  prize: string // 奖品名（空也行，仅用于显示）
  keyword: string // 触发参与的弹幕关键词（包含匹配）
  winnerCount: number // 抽几名
  durationSec: number // 倒计时秒数
  requireAnchorFansMedal: boolean // 是否要求本主播粉丝牌
  minFansMedalLevel: number // 最低粉丝牌等级（0 = 不限制）
}

export interface LotteryParticipant {
  uid: string
  uname: string
}

export interface LotteryWinner {
  uid: string
  uname: string
}

export type LotteryState =
  | { phase: 'idle' }
  | {
      phase: 'running'
      config: LotteryConfig
      startedAt: number
      endsAt: number
      participantCount: number
    }
  | {
      phase: 'done'
      config: LotteryConfig
      endedAt: number
      participantCount: number
      winners: LotteryWinner[]
    }

const MIN_DURATION = 10
const MAX_DURATION = 600
const MIN_WINNERS = 1
const MAX_WINNERS = 50

export class LotteryService {
  private state: LotteryState = { phase: 'idle' }
  private bus: Bus
  private overlay: OverlayBroadcaster
  // 当前轮的参与者池。uid → uname（同 uid 仅 1 名，避免 1 个观众多发多次刷概率）
  private participants = new Map<string, string>()
  private endTimer: NodeJS.Timeout | null = null
  private unsubBus: (() => void) | null = null
  // 参与人数变化推送节流
  private lastParticipantPush = 0
  private pushTimer: NodeJS.Timeout | null = null

  private statusListeners = new Set<(s: LotteryState) => void>()

  constructor(bus: Bus, overlay: OverlayBroadcaster) {
    this.bus = bus
    this.overlay = overlay
  }

  getState(): LotteryState {
    return this.state
  }

  onStatusChange(cb: (s: LotteryState) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }
  private notify(): void {
    for (const l of this.statusListeners) {
      try {
        l(this.state)
      } catch (err) {
        console.error('[LotteryService] status listener threw', err)
      }
    }
  }

  /** 启动一轮抽奖。返回校验后的 config 或错误 */
  start(rawConfig: LotteryConfig): { ok: true } | { ok: false; error: string } {
    if (this.state.phase === 'running') {
      return { ok: false, error: '已有进行中的抽奖，先取消再开新一轮' }
    }
    const v = validateConfig(rawConfig)
    if (!v.ok) return v

    const config = v.config
    const now = Date.now()
    const endsAt = now + config.durationSec * 1000

    this.participants.clear()
    this.state = {
      phase: 'running',
      config,
      startedAt: now,
      endsAt,
      participantCount: 0
    }

    // 订阅 bus，过滤弹幕匹配关键词的用户加入参与者池
    this.attachBus()

    // 倒计时到 → end()
    this.endTimer = setTimeout(() => this.end(), config.durationSec * 1000)

    // 推 overlay 弹出"抽奖进行中"卡片
    this.overlay.broadcast({
      kind: 'lottery.start',
      event: this.fakeEvent(now),
      extra: {
        prize: config.prize,
        keyword: config.keyword,
        winnerCount: config.winnerCount,
        endsAt,
        durationSec: config.durationSec
      }
    })

    this.notify()
    return { ok: true }
  }

  /** 手动结束（取消倒计时直接抽奖）。idle 状态调用无效 */
  drawNow(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'running') {
      return { ok: false, error: '没有进行中的抽奖' }
    }
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.end()
    return { ok: true }
  }

  /** 取消（不抽奖）。idle 状态调用无效 */
  cancel(): { ok: true } | { ok: false; error: string } {
    if (this.state.phase !== 'running') {
      return { ok: false, error: '没有进行中的抽奖' }
    }
    if (this.endTimer) {
      clearTimeout(this.endTimer)
      this.endTimer = null
    }
    this.detachBus()
    this.participants.clear()
    this.state = { phase: 'idle' }

    this.overlay.broadcast({
      kind: 'lottery.cancelled',
      event: this.fakeEvent(Date.now())
    })
    this.notify()
    return { ok: true }
  }

  /** 把 state 回到 idle（done → idle）。用于"我看完结果了，关闭" */
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

    const pool = [...this.participants.entries()].map(([uid, uname]) => ({ uid, uname }))
    const winners = drawWinners(pool, cur.config.winnerCount)
    const now = Date.now()

    this.state = {
      phase: 'done',
      config: cur.config,
      endedAt: now,
      participantCount: pool.length,
      winners
    }

    this.overlay.broadcast({
      kind: 'lottery.result',
      event: this.fakeEvent(now),
      extra: {
        prize: cur.config.prize,
        winners,
        participantCount: pool.length
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
    const text = e.payload.content
    if (!text.includes(this.state.config.keyword)) return

    // 粉丝牌门槛
    const cfg = this.state.config
    if (cfg.requireAnchorFansMedal || cfg.minFansMedalLevel > 0) {
      const m = e.user.fansMedal
      if (!m) return
      if (cfg.requireAnchorFansMedal && !m.isAnchor) return
      if (m.level < cfg.minFansMedalLevel) return
    }

    // 去重：同 uid 重复发关键词只记一次
    const uid = e.user.uid
    if (!uid) return
    if (this.participants.has(uid)) return
    this.participants.set(uid, e.user.uname || '观众')

    // 更新 state 的 participantCount + 节流推 overlay
    if (this.state.phase === 'running') {
      this.state = { ...this.state, participantCount: this.participants.size }
      this.notify()
      this.schedulePushCount()
    }
  }

  /** 参与人数变化节流推 overlay (500ms)，避免每条弹幕都发一次 */
  private schedulePushCount(): void {
    const now = Date.now()
    const elapsed = now - this.lastParticipantPush
    const PUSH_INTERVAL = 500
    if (elapsed >= PUSH_INTERVAL) {
      this.pushParticipantCount()
      return
    }
    if (this.pushTimer) return
    this.pushTimer = setTimeout(
      () => {
        this.pushTimer = null
        this.pushParticipantCount()
      },
      PUSH_INTERVAL - elapsed
    )
  }
  private pushParticipantCount(): void {
    if (this.state.phase !== 'running') return
    this.lastParticipantPush = Date.now()
    this.overlay.broadcast({
      kind: 'lottery.tick',
      event: this.fakeEvent(Date.now()),
      extra: { participantCount: this.state.participantCount }
    })
  }

  private fakeEvent(timestamp: number): StandardEvent {
    // overlay broadcast 要 event 字段。lottery 没有具体 user，构造一个 viewer.enter 占位
    return {
      kind: 'viewer.enter',
      platform: 'bilibili',
      timestamp,
      user: { uid: '0', uname: '抽奖系统' },
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
    this.participants.clear()
    this.state = { phase: 'idle' }
  }
}

function validateConfig(c: LotteryConfig): { ok: true; config: LotteryConfig } | { ok: false; error: string } {
  const keyword = (c.keyword ?? '').trim()
  if (keyword.length === 0) return { ok: false, error: '关键词不能为空' }
  if (keyword.length > 20) return { ok: false, error: '关键词太长（最多 20 字）' }
  if (!Number.isFinite(c.winnerCount) || c.winnerCount < MIN_WINNERS || c.winnerCount > MAX_WINNERS) {
    return { ok: false, error: `中奖人数要在 ${MIN_WINNERS}-${MAX_WINNERS} 之间` }
  }
  if (!Number.isFinite(c.durationSec) || c.durationSec < MIN_DURATION || c.durationSec > MAX_DURATION) {
    return { ok: false, error: `倒计时要在 ${MIN_DURATION}-${MAX_DURATION} 秒之间` }
  }
  return {
    ok: true,
    config: {
      prize: (c.prize ?? '').trim().slice(0, 40),
      keyword,
      winnerCount: Math.round(c.winnerCount),
      durationSec: Math.round(c.durationSec),
      requireAnchorFansMedal: Boolean(c.requireAnchorFansMedal),
      minFansMedalLevel: Math.max(0, Math.min(40, Math.round(c.minFansMedalLevel ?? 0)))
    }
  }
}

/** Fisher-Yates 洗牌取前 N。pool 长度小于 N 时返回 pool 全部 */
function drawWinners(pool: LotteryParticipant[], n: number): LotteryWinner[] {
  const arr = [...pool]
  const take = Math.min(n, arr.length)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, take)
}
