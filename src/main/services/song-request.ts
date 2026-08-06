// 弹幕点歌台服务
//
// 观众发「点歌 晴天」→ 校验门槛 / 扣哈松币 → 进队列 → OBS 点歌板刷新 + TTS 报一句。
// 主播在控制台切歌、置顶、删歌、清空、暂停接单；删歌和观众撤销都会原路退币。
//
// LiveLink 不放音乐，只管队列和展示 —— 音源和版权都不是这个软件该碰的东西。

import type { Bus } from '../events/bus'
import type { StandardEvent } from '../platform/adapter'
import type { TTSPlayer } from '../actions/tts'
import type { LogSink } from '../actions/log'
import type { OverlayBroadcaster } from '../actions/overlay'
import type { WalletStore } from './wallet-store'
import type { SongStore } from './song-store'
import { normalizeDanmuForSpeech } from './danmu-text'
import { claimSpeech } from './speech-claim'
import {
  EMPTY_SONG_QUEUE,
  parseSongCommand,
  sanitizeSongRequestConfig,
  type SongItem,
  type SongQueueState,
  type SongRejectReason,
  type SongRequestConfig
} from '../../shared/song-request'

export interface SongRequestResult {
  ok: boolean
  reason?: SongRejectReason
  item?: SongItem
  message?: string
}

/** 拒绝原因 → 写进日志的人话。只记主播需要知道的那几种，冷却 / 重复不记免得刷屏 */
const LOGGED_REASONS: Partial<Record<SongRejectReason, string>> = {
  'queue-full': '队列已满',
  'user-limit': '已达个人上限',
  'no-balance': '余额不足'
}

export class SongRequestService {
  private bus: Bus
  private tts: TTSPlayer
  private log: LogSink
  private overlay: OverlayBroadcaster
  private wallet: WalletStore
  private store: SongStore
  private getConfig: () => SongRequestConfig
  private getCurrentRoomId: () => number | null
  private getInitialBalance: () => number
  private getCurrencyName: () => string

  private unsubBus: (() => void) | null = null
  private listeners = new Set<(s: SongQueueState) => void>()
  private perUserAt = new Map<string, number>()
  private seq = 0
  // 当前房间的队列缓存。roomId 变了就重新从 store 读，避免把 A 房间的队列写进 B 房间
  private cacheRoomId: number | null = null
  private cache: SongQueueState = { ...EMPTY_SONG_QUEUE, queue: [], history: [] }

  constructor(deps: {
    bus: Bus
    tts: TTSPlayer
    log: LogSink
    overlay: OverlayBroadcaster
    wallet: WalletStore
    store: SongStore
    getConfig: () => SongRequestConfig
    getCurrentRoomId: () => number | null
    getInitialBalance: () => number
    getCurrencyName: () => string
  }) {
    this.bus = deps.bus
    this.tts = deps.tts
    this.log = deps.log
    this.overlay = deps.overlay
    this.wallet = deps.wallet
    this.store = deps.store
    this.getConfig = deps.getConfig
    this.getCurrentRoomId = deps.getCurrentRoomId
    this.getInitialBalance = deps.getInitialBalance
    this.getCurrencyName = deps.getCurrencyName
  }

  attach(): void {
    if (this.unsubBus) return
    const handler = (e: StandardEvent): void => this.handleEvent(e)
    this.bus.on('event', handler)
    this.unsubBus = () => this.bus.off('event', handler)
  }

  dispose(): void {
    this.unsubBus?.()
    this.unsubBus = null
    this.listeners.clear()
    this.perUserAt.clear()
  }

  onStatusChange(cb: (s: SongQueueState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getState(): SongQueueState {
    return cloneState(this.load())
  }

  /** 给 OBS 点歌板用的消息体。socket 刚连上时也要推一次，否则浏览器源刷新后是空的 */
  boardMessage(): { kind: string; event: StandardEvent; extra: Record<string, unknown> } {
    const config = sanitizeSongRequestConfig(this.getConfig())
    const state = this.load()
    return {
      kind: 'song.board.update',
      event: this.fakeEvent(Date.now()),
      extra: {
        enabled: config.enabled && config.showBoard,
        corner: config.boardCorner,
        open: state.open,
        keyword: config.keyword,
        cost: config.cost,
        currencyName: this.getCurrencyName(),
        current: state.current,
        queue: state.queue.slice(0, config.boardLimit),
        queueTotal: state.queue.length
      }
    }
  }

  /** 只重推一次 OBS 点歌板（改了展示类配置时用，队列本身没变） */
  pushBoard(): void {
    this.overlay.broadcast(this.boardMessage())
  }

  // ─── 主播侧操作 ────────────────────────────────────────────

  /** 暂停 / 恢复接单。已排的照唱 */
  setOpen(open: boolean): SongQueueState {
    const state = this.load()
    state.open = open
    return this.commit(state)
  }

  /** 唱完当前这首，换下一首上来 */
  next(): SongQueueState {
    const state = this.load()
    if (state.current) state.history.unshift(state.current)
    state.current = state.queue.shift() ?? null
    return this.commit(state)
  }

  /** 把某首挪到队首 */
  moveTop(id: string): SongQueueState {
    const state = this.load()
    const idx = state.queue.findIndex((s) => s.id === id)
    if (idx > 0) {
      const [item] = state.queue.splice(idx, 1)
      state.queue.unshift(item)
    }
    return this.commit(state)
  }

  /** 删歌。花过哈松币的原路退回 —— 不退等于白扣观众的钱 */
  remove(id: string): SongQueueState {
    const state = this.load()
    const idx = state.queue.findIndex((s) => s.id === id)
    if (idx >= 0) {
      const [item] = state.queue.splice(idx, 1)
      this.refund(item)
    } else if (state.current?.id === id) {
      this.refund(state.current)
      state.current = null
    }
    return this.commit(state)
  }

  /** 清空待唱队列（不动正在唱的那首），逐首退币 */
  clearQueue(): SongQueueState {
    const state = this.load()
    for (const item of state.queue) this.refund(item)
    state.queue = []
    return this.commit(state)
  }

  clearHistory(): SongQueueState {
    const state = this.load()
    state.history = []
    return this.commit(state)
  }

  /** 主播自己加一首（不扣费、不受门槛和上限限制） */
  addByHost(rawTitle: string): SongRequestResult {
    // 没连直播间时必须拒掉。队列是按 roomId 存盘的，此时 commit 不会落盘，
    // 而一旦连上，load() 会按新 roomId 重新从磁盘读，把这几首直接冲掉——
    // 主播开播前先排的歌会静默消失。宁可现在报错，也不能让他白排
    if (this.getCurrentRoomId() == null) {
      return { ok: false, reason: 'no-room', message: '还没连上直播间，连上之后才能加歌' }
    }
    const config = sanitizeSongRequestConfig(this.getConfig())
    const title = this.normalizeTitle(rawTitle, config)
    if (!title) return { ok: false, reason: 'empty-title', message: '歌名是空的' }
    const state = this.load()
    const item: SongItem = {
      id: this.nextId(),
      title,
      uid: '0',
      uname: '主播',
      requestedAt: Date.now(),
      cost: 0,
      source: 'host'
    }
    state.queue.push(item)
    this.commit(state)
    return { ok: true, item }
  }

  /** 换房间 / 断开时清掉冷却记录并重读队列 */
  resetRuntime(): void {
    this.perUserAt.clear()
    this.cacheRoomId = null
    this.notify()
  }

  // ─── 观众侧 ────────────────────────────────────────────────

  private handleEvent(e: StandardEvent): void {
    if (e.kind !== 'danmu.received') return
    const config = sanitizeSongRequestConfig(this.getConfig())
    if (!config.enabled) return
    const content = (e.payload.content ?? '').trim()
    if (!content) return

    // 撤销必须先判：万一主播把撤销词设成「点歌取消」，它也以「点歌」开头，
    // 先判点歌的话会被当成点了一首叫"取消"的歌
    if (config.cancelKeyword && content.startsWith(config.cancelKeyword)) {
      claimSpeech(e)
      this.cancelLatestOf(e.user.uid || '0', e.user.uname || '观众')
      return
    }

    const rawTitle = parseSongCommand(content, config.keyword)
    if (rawTitle === null) return
    // 只要是点歌指令就打标记：让弹幕朗读别把"点歌 晴天"这条命令原样念出来。
    // 被拒的也照样打——念一条失败的指令同样是噪音
    claimSpeech(e)

    const result = this.request(e, config, rawTitle)
    if (!result.ok && result.reason) {
      const label = LOGGED_REASONS[result.reason]
      if (label) {
        this.log.write({
          timestamp: Date.now(),
          ruleId: 'song.request',
          ruleName: '点歌台',
          eventKind: 'danmu.received',
          uname: e.user.uname,
          text: `${e.user.uname} 点歌未成功：${label}`
        })
      }
    }
  }

  private request(
    e: StandardEvent,
    config: SongRequestConfig,
    rawTitle: string
  ): SongRequestResult {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return { ok: false, reason: 'no-room' }

    const state = this.load()
    if (!state.open) return { ok: false, reason: 'closed' }
    if (!inScope(config, e)) return { ok: false, reason: 'scope' }
    if (config.blockKeywords.some((k) => rawTitle.includes(k))) {
      return { ok: false, reason: 'blocked' }
    }

    const title = this.normalizeTitle(rawTitle, config)
    if (!title) return { ok: false, reason: 'empty-title' }

    const uid = e.user.uid || '0'
    const uname = e.user.uname || '观众'
    const now = Date.now()

    if (config.perUserCooldownSec > 0) {
      const last = this.perUserAt.get(uid) ?? 0
      if (now - last < config.perUserCooldownSec * 1000) return { ok: false, reason: 'cooldown' }
    }
    if (state.queue.length >= config.maxQueueSize) return { ok: false, reason: 'queue-full' }
    const mine = state.queue.filter((s) => s.uid === uid).length
    if (mine >= config.maxPerUser) return { ok: false, reason: 'user-limit' }
    // 同名歌已经在队列里（或正在唱）就别重复排，不然一首歌能被刷十遍
    const key = title.toLowerCase()
    const dup =
      state.queue.some((s) => s.title.toLowerCase() === key) ||
      state.current?.title.toLowerCase() === key
    if (dup) return { ok: false, reason: 'duplicate' }

    // 扣费放在所有校验之后：任何一条不通过都不该先把钱扣掉
    if (config.cost > 0) {
      const paid = this.wallet.charge(roomId, uid, uname, config.cost, this.getInitialBalance())
      if (!paid) return { ok: false, reason: 'no-balance' }
    }

    const item: SongItem = {
      id: this.nextId(),
      title,
      uid,
      uname,
      requestedAt: now,
      cost: config.cost,
      source: 'danmu'
    }
    state.queue.push(item)
    this.perUserAt.set(uid, now)
    this.commit(state)

    this.log.write({
      timestamp: now,
      ruleId: 'song.request',
      ruleName: '点歌台',
      eventKind: 'danmu.received',
      uname,
      text: `${uname} 点了《${title}》，队列第 ${state.queue.length} 位`
    })
    if (config.speakOnRequest) {
      this.tts.enqueue(`${uname}点了一首${title}`, {
        eventKind: 'danmu.received',
        priority: 'normal'
      })
    }
    return { ok: true, item }
  }

  /** 观众撤销自己最后排的那一首 */
  private cancelLatestOf(uid: string, uname: string): void {
    const state = this.load()
    for (let i = state.queue.length - 1; i >= 0; i--) {
      if (state.queue[i].uid !== uid) continue
      const [item] = state.queue.splice(i, 1)
      this.refund(item)
      this.commit(state)
      this.log.write({
        timestamp: Date.now(),
        ruleId: 'song.request',
        ruleName: '点歌台',
        eventKind: 'danmu.received',
        uname,
        text: `${uname} 撤销了《${item.title}》`
      })
      return
    }
  }

  // ─── 内部 ──────────────────────────────────────────────────

  private normalizeTitle(raw: string, config: SongRequestConfig): string {
    // 复用弹幕净化：剥表情码、挡外链、去 emoji。
    // 但不压缩复读——歌名里的重复字是合法的（《哈哈哈》真有这首）
    const r = normalizeDanmuForSpeech(raw, {
      stripEmotes: true,
      skipUrls: true,
      collapseRepeats: false,
      minLength: 1,
      maxLength: config.maxTitleLength
    })
    return r.text
  }

  private refund(item: SongItem): void {
    if (item.cost <= 0 || item.source !== 'danmu') return
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return
    this.wallet.refundCharge(roomId, item.uid, item.uname, item.cost)
  }

  /** 读当前房间的队列。房间变了要重新从磁盘读，绝不能沿用上一个房间的缓存 */
  private load(): SongQueueState {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) {
      // 没连接时给一份空的，避免 UI 显示上一个房间的残留
      if (this.cacheRoomId !== null) {
        this.cacheRoomId = null
        this.cache = { ...EMPTY_SONG_QUEUE, queue: [], history: [] }
      }
      return this.cache
    }
    if (this.cacheRoomId !== roomId) {
      this.cacheRoomId = roomId
      this.cache = this.store.get(roomId)
    }
    return this.cache
  }

  private commit(state: SongQueueState): SongQueueState {
    this.cache = state
    const roomId = this.getCurrentRoomId()
    if (roomId != null) {
      this.cacheRoomId = roomId
      this.store.set(roomId, state)
    }
    this.notify()
    return cloneState(state)
  }

  private notify(): void {
    const snapshot = this.getState()
    for (const l of this.listeners) {
      try {
        l(snapshot)
      } catch (err) {
        console.error('[SongRequest] listener threw', err)
      }
    }
    this.overlay.broadcast(this.boardMessage())
  }

  private nextId(): string {
    this.seq += 1
    return `song-${Date.now().toString(36)}-${this.seq}`
  }

  private fakeEvent(ts: number): StandardEvent {
    return {
      kind: 'danmu.received',
      platform: 'bilibili',
      timestamp: ts,
      user: { uid: '0', uname: '点歌台' },
      payload: { content: '' }
    }
  }
}

function inScope(config: SongRequestConfig, e: StandardEvent): boolean {
  if (config.scope === 'all') return true
  if (config.scope === 'guard') return (e.user.guardLevel ?? 0) > 0
  const m = e.user.fansMedal
  if (!m) return false
  if (config.requireAnchorMedal && !m.isAnchor) return false
  return m.level >= config.minMedalLevel
}

function cloneState(s: SongQueueState): SongQueueState {
  return {
    open: s.open,
    current: s.current ? { ...s.current } : null,
    queue: s.queue.map((i) => ({ ...i })),
    history: s.history.map((i) => ({ ...i }))
  }
}
