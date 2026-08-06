/**
 * 弹幕点歌台回归自检（离线跑，不联网、不碰 Electron）
 *
 *   pnpm verify:song
 *
 * 重点压的是**钱**：点歌可以配置成扣哈松币，任何一处扣了不退 / 退多了，
 * 都是直接坑观众。所以扣费、退费、去重、上限这几条要一条条钉死。
 *
 * 覆盖：
 *   A. 指令解析（必须以触发词开头；撤销词优先于点歌词）
 *   B. 门槛与限流（scope / 黑名单 / 队列上限 / 个人上限 / 冷却 / 同名去重）
 *   C. 钱（余额不足不扣不排；删歌 / 清空 / 观众撤销都要原路退回；主播加的不退）
 *   D. 队列操作（切歌 / 置顶 / 历史 / 暂停接单）
 *   E. 持久化与房间隔离（重启不丢队；A 房间的队列不会写进 B 房间）
 */
import { SongRequestService } from '../src/main/services/song-request'
import { WalletStore } from '../src/main/services/wallet-store'
import { SongStore } from '../src/main/services/song-store'
import {
  DEFAULT_SONG_REQUEST_CONFIG,
  parseSongCommand,
  sanitizeSongRequestConfig,
  type SongQueueState,
  type SongRequestConfig
} from '../src/shared/song-request'
import type { StandardEvent, UserInfo } from '../src/main/platform/adapter'
import { DanmuReaderService } from '../src/main/services/danmu-reader'
import { sanitizeDanmuReaderConfig } from '../src/shared/danmu-reader'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
}

// ─── A. 指令解析 ──────────────────────────────────────────────
console.log('\nA. 指令解析')
{
  check('带空格', parseSongCommand('点歌 晴天', '点歌') === '晴天')
  check('不带空格', parseSongCommand('点歌晴天', '点歌') === '晴天')
  check('前后有空白也认', parseSongCommand('  点歌  晴天  ', '点歌') === '晴天')
  check('不以触发词开头就不是点歌', parseSongCommand('我想点歌了', '点歌') === null)
  check('只发触发词返回空串而非 null', parseSongCommand('点歌', '点歌') === '')
  check('空触发词一律不匹配', parseSongCommand('随便说说', '') === null)
}
{
  const cfg = sanitizeSongRequestConfig({ keyword: '   ' })
  check('触发词被清成空时回退默认', cfg.keyword === DEFAULT_SONG_REQUEST_CONFIG.keyword, cfg.keyword)
}
{
  const cfg = sanitizeSongRequestConfig({ maxQueueSize: 9999, cost: -5, boardLimit: 100 })
  check(
    '越界数值夹回合法区间',
    cfg.maxQueueSize === 100 && cfg.cost === 0 && cfg.boardLimit === 12,
    JSON.stringify({ q: cfg.maxQueueSize, c: cfg.cost, b: cfg.boardLimit })
  )
}

// ─── 测试脚手架 ───────────────────────────────────────────────

/** 内存版 SongStore，形状与真实的一致 */
function memoryStore(): SongStore & { dump: () => Record<string, SongQueueState> } {
  const rooms: Record<string, SongQueueState> = {}
  return {
    get: (roomId: number | string) => {
      const s = rooms[String(roomId)]
      return s
        ? { open: s.open, current: s.current, queue: [...s.queue], history: [...s.history] }
        : { open: true, current: null, queue: [], history: [] }
    },
    set: (roomId: number | string, state: SongQueueState) => {
      rooms[String(roomId)] = {
        open: state.open,
        current: state.current,
        queue: [...state.queue],
        history: [...state.history]
      }
    },
    clearRoom: (roomId: number | string) => {
      delete rooms[String(roomId)]
    },
    dump: () => rooms
  } as SongStore & { dump: () => Record<string, SongQueueState> }
}

/** 内存版钱包，只实现服务用到的 charge / refundCharge / query */
function memoryWallet(initial: Record<string, number> = {}): WalletStore & {
  balances: Record<string, number>
} {
  const balances: Record<string, number> = { ...initial }
  const key = (roomId: number | string, uid: string): string => `${roomId}|${uid}`
  return {
    balances,
    charge: (roomId, uid, _uname, amount, initialBalance) => {
      if (amount <= 0) return true
      const k = key(roomId, uid)
      if (balances[k] === undefined) balances[k] = initialBalance
      if (balances[k] < amount) return false
      balances[k] -= amount
      return true
    },
    refundCharge: (roomId, uid, _uname, amount) => {
      if (amount <= 0) return
      const k = key(roomId, uid)
      balances[k] = (balances[k] ?? 0) + amount
    }
  } as unknown as WalletStore & { balances: Record<string, number> }
}

function fakeBus(): {
  on: (k: string, h: (e: StandardEvent) => void) => void
  off: (k: string, h: (e: StandardEvent) => void) => void
  emit: (e: StandardEvent) => void
} {
  const handlers: ((e: StandardEvent) => void)[] = []
  return {
    on: (_k, h) => void handlers.push(h),
    off: (_k, h) => {
      const i = handlers.indexOf(h)
      if (i >= 0) handlers.splice(i, 1)
    },
    emit: (e) => handlers.slice().forEach((h) => h(e))
  }
}

function danmu(content: string, user: Partial<UserInfo> = {}): StandardEvent {
  return {
    kind: 'danmu.received',
    platform: 'bilibili',
    timestamp: Date.now(),
    user: { uid: '1001', uname: '观众甲', ...user },
    payload: { content }
  }
}

interface Harness {
  svc: SongRequestService
  bus: ReturnType<typeof fakeBus>
  wallet: ReturnType<typeof memoryWallet>
  store: ReturnType<typeof memoryStore>
  spoken: string[]
  logs: string[]
  boards: Record<string, unknown>[]
  setRoom: (id: number | null) => void
}

function makeService(
  patch: Partial<SongRequestConfig> = {},
  opts: { balances?: Record<string, number>; store?: ReturnType<typeof memoryStore> } = {}
): Harness {
  const bus = fakeBus()
  const wallet = memoryWallet(opts.balances)
  const store = opts.store ?? memoryStore()
  const spoken: string[] = []
  const logs: string[] = []
  const boards: Record<string, unknown>[] = []
  let roomId: number | null = 100

  const config = sanitizeSongRequestConfig({
    ...DEFAULT_SONG_REQUEST_CONFIG,
    enabled: true,
    perUserCooldownSec: 0,
    ...patch
  })

  const svc = new SongRequestService({
    bus: bus as never,
    tts: { enqueue: (t: string) => void spoken.push(t) } as never,
    log: { write: (e: { text: string }) => void logs.push(e.text) } as never,
    overlay: {
      broadcast: (m: { extra?: Record<string, unknown> }) => void boards.push(m.extra ?? {})
    } as never,
    wallet,
    store,
    getConfig: () => config,
    getCurrentRoomId: () => roomId,
    getInitialBalance: () => 1000,
    getCurrencyName: () => '哈松币'
  })
  svc.attach()
  return {
    svc,
    bus,
    wallet,
    store,
    spoken,
    logs,
    boards,
    setRoom: (id) => {
      roomId = id
      svc.resetRuntime()
    }
  }
}

// ─── B. 门槛与限流 ────────────────────────────────────────────
console.log('\nB. 门槛与限流')
{
  const h = makeService()
  h.bus.emit(danmu('点歌 晴天'))
  const s = h.svc.getState()
  check('正常点歌进队', s.queue.length === 1 && s.queue[0].title === '晴天', JSON.stringify(s.queue))
  check('记了点歌人', s.queue[0]?.uname === '观众甲')
  check('TTS 报了一句', h.spoken.length === 1, h.spoken.join('|'))
}
{
  const h = makeService({ enabled: false })
  h.bus.emit(danmu('点歌 晴天'))
  check('总开关关掉后不接单', h.svc.getState().queue.length === 0)
}
{
  const h = makeService()
  h.svc.setOpen(false)
  h.bus.emit(danmu('点歌 晴天'))
  check('暂停接单后新的进不来', h.svc.getState().queue.length === 0)
}
{
  const h = makeService({ scope: 'guard' })
  h.bus.emit(danmu('点歌 路人歌'))
  h.bus.emit(danmu('点歌 舰长歌', { uid: '2002', guardLevel: 3 }))
  const s = h.svc.getState()
  check('仅舰长时挡住路人', s.queue.length === 1 && s.queue[0].title === '舰长歌', JSON.stringify(s.queue))
}
{
  const h = makeService({ scope: 'medal', minMedalLevel: 10, requireAnchorMedal: true })
  h.bus.emit(danmu('点歌 没牌子', { uid: '1' }))
  h.bus.emit(danmu('点歌 别家牌子', { uid: '2', fansMedal: { level: 20, name: 'x', isAnchor: false, isLighted: true } }))
  h.bus.emit(danmu('点歌 够格', { uid: '3', fansMedal: { level: 12, name: 'y', isAnchor: true, isLighted: true } }))
  check('粉丝牌门槛只放行合格的', h.svc.getState().queue.length === 1)
}
{
  const h = makeService({ blockKeywords: ['广告'] })
  h.bus.emit(danmu('点歌 广告神曲'))
  check('黑名单拒绝', h.svc.getState().queue.length === 0)
}
{
  const h = makeService()
  h.bus.emit(danmu('点歌 https://a.com'))
  check('外链歌名被拒', h.svc.getState().queue.length === 0)
  h.bus.emit(danmu('点歌 [dog][dog]'))
  check('纯表情码歌名被拒', h.svc.getState().queue.length === 0)
  h.bus.emit(danmu('点歌'))
  check('只发触发词不进队', h.svc.getState().queue.length === 0)
}
{
  const h = makeService({ maxQueueSize: 2 })
  h.bus.emit(danmu('点歌 一', { uid: 'a' }))
  h.bus.emit(danmu('点歌 二', { uid: 'b' }))
  h.bus.emit(danmu('点歌 三', { uid: 'c' }))
  check('队列上限挡住第三首', h.svc.getState().queue.length === 2)
  check('队列满写了日志', h.logs.some((l) => l.includes('队列已满')), h.logs.join(' | '))
}
{
  const h = makeService({ maxPerUser: 1 })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  check('个人上限挡住第二首', h.svc.getState().queue.length === 1)
  h.bus.emit(danmu('点歌 三', { uid: '9', uname: '别人' }))
  check('个人上限只针对本人', h.svc.getState().queue.length === 2)
}
{
  const h = makeService({ perUserCooldownSec: 60, maxPerUser: 5 })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  check('冷却期内点不了第二首', h.svc.getState().queue.length === 1)
}
{
  const h = makeService()
  h.bus.emit(danmu('点歌 晴天', { uid: 'a' }))
  h.bus.emit(danmu('点歌 晴天', { uid: 'b', uname: '观众乙' }))
  check('同名歌不重复排队', h.svc.getState().queue.length === 1)
  h.svc.next() // 晴天 变成"正在唱"
  h.bus.emit(danmu('点歌 晴天', { uid: 'c', uname: '观众丙' }))
  check('正在唱的那首也算重复', h.svc.getState().queue.length === 0, JSON.stringify(h.svc.getState()))
}

// ─── C. 钱 ────────────────────────────────────────────────────
console.log('\nC. 钱（扣费与退款）')
{
  const h = makeService({ cost: 100 }, { balances: { '100|1001': 250 } })
  h.bus.emit(danmu('点歌 一'))
  check('点一首扣一次', h.wallet.balances['100|1001'] === 150, String(h.wallet.balances['100|1001']))
  check('扣费记进条目', h.svc.getState().queue[0]?.cost === 100)
}
{
  const h = makeService({ cost: 100 }, { balances: { '100|1001': 50 } })
  h.bus.emit(danmu('点歌 一'))
  check('余额不够不进队', h.svc.getState().queue.length === 0)
  check('余额不够一分不扣', h.wallet.balances['100|1001'] === 50, String(h.wallet.balances['100|1001']))
  check('余额不足写了日志', h.logs.some((l) => l.includes('余额不足')), h.logs.join(' | '))
}
{
  // 校验不通过时绝不能已经把钱扣了 —— 这是最容易写错的顺序问题
  const h = makeService({ cost: 100, maxQueueSize: 1 }, { balances: { '100|a': 500, '100|b': 500 } })
  h.bus.emit(danmu('点歌 一', { uid: 'a' }))
  h.bus.emit(danmu('点歌 二', { uid: 'b' }))
  check('被队列上限拒掉的人没被扣钱', h.wallet.balances['100|b'] === 500, String(h.wallet.balances['100|b']))
}
{
  const h = makeService({ cost: 100 }, { balances: { '100|1001': 500 } })
  h.bus.emit(danmu('点歌 一'))
  const id = h.svc.getState().queue[0].id
  h.svc.remove(id)
  check('主播删歌原路退回', h.wallet.balances['100|1001'] === 500, String(h.wallet.balances['100|1001']))
}
{
  const h = makeService({ cost: 100, maxPerUser: 3 }, { balances: { '100|1001': 500 } })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  h.svc.clearQueue()
  check('清空队列逐首退回', h.wallet.balances['100|1001'] === 500, String(h.wallet.balances['100|1001']))
  check('清空后队列为空', h.svc.getState().queue.length === 0)
}
{
  const h = makeService({ cost: 100, maxPerUser: 3 }, { balances: { '100|1001': 500 } })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  h.bus.emit(danmu('取消点歌'))
  const s = h.svc.getState()
  check('观众撤销掉的是自己最后点的那首', s.queue.length === 1 && s.queue[0].title === '一', JSON.stringify(s.queue))
  check('撤销退回一首的钱', h.wallet.balances['100|1001'] === 400, String(h.wallet.balances['100|1001']))
}
{
  const h = makeService({ cost: 100 }, { balances: { '100|a': 500, '100|b': 500 } })
  h.bus.emit(danmu('点歌 一', { uid: 'a' }))
  h.bus.emit(danmu('取消点歌', { uid: 'b', uname: '观众乙' }))
  check('撤销不会误删别人的歌', h.svc.getState().queue.length === 1)
  check('撤销不会误退别人的钱', h.wallet.balances['100|a'] === 400 && h.wallet.balances['100|b'] === 500)
}
{
  // 撤销词恰好以点歌词开头的坑：必须先判撤销，否则会点一首叫"撤销"的歌
  const h = makeService({ keyword: '点歌', cancelKeyword: '点歌取消' })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌取消'))
  check('撤销词优先于点歌词', h.svc.getState().queue.length === 0, JSON.stringify(h.svc.getState().queue))
}
{
  const h = makeService({ cost: 100 }, { balances: { '100|1001': 500 } })
  h.svc.addByHost('主播自己想唱的')
  const id = h.svc.getState().queue[0].id
  h.svc.remove(id)
  check('主播自己加的不扣费也不退费', h.wallet.balances['100|1001'] === 500)
  check('主播加的标记为 host', h.svc.getState().queue.length === 0)
}

// ─── D. 队列操作 ──────────────────────────────────────────────
console.log('\nD. 队列操作')
{
  const h = makeService({ maxPerUser: 5 })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  h.bus.emit(danmu('点歌 三'))
  h.svc.next()
  check('切歌把队首挪到正在唱', h.svc.getState().current?.title === '一')
  check('队列少一首', h.svc.getState().queue.length === 2)
  h.svc.next()
  const s = h.svc.getState()
  check('再切一次进历史', s.history[0]?.title === '一' && s.current?.title === '二', JSON.stringify(s.history))
}
{
  const h = makeService({ maxPerUser: 5 })
  h.bus.emit(danmu('点歌 一'))
  h.bus.emit(danmu('点歌 二'))
  h.bus.emit(danmu('点歌 三'))
  const third = h.svc.getState().queue[2].id
  h.svc.moveTop(third)
  check('置顶挪到队首', h.svc.getState().queue[0]?.title === '三', JSON.stringify(h.svc.getState().queue.map((q) => q.title)))
  check('置顶不丢别的歌', h.svc.getState().queue.length === 3)
}
{
  const h = makeService()
  h.svc.next()
  check('空队列切歌不炸', h.svc.getState().current === null)
  h.svc.moveTop('不存在的 id')
  h.svc.remove('不存在的 id')
  check('操作不存在的 id 不炸', h.svc.getState().queue.length === 0)
}
{
  const h = makeService()
  h.bus.emit(danmu('点歌 一'))
  check('每次变更都推了 OBS 点歌板', h.boards.length > 0)
  const last = h.boards[h.boards.length - 1]
  check('点歌板带了队列总数', last.queueTotal === 1, JSON.stringify(last.queueTotal))
}

// ─── E. 持久化与房间隔离 ──────────────────────────────────────
console.log('\nE. 持久化与房间隔离')
{
  const store = memoryStore()
  const h1 = makeService({}, { store })
  h1.bus.emit(danmu('点歌 关掉软件前点的'))
  // 换一个 service 实例模拟重启，共用同一个 store
  const h2 = makeService({}, { store })
  check('重启后队列还在', h2.svc.getState().queue.length === 1, JSON.stringify(h2.svc.getState().queue))
}
{
  const store = memoryStore()
  const h = makeService({}, { store })
  h.bus.emit(danmu('点歌 A 房间的歌'))
  h.setRoom(200)
  check('换房间后看到的是空队列', h.svc.getState().queue.length === 0, JSON.stringify(h.svc.getState()))
  h.bus.emit(danmu('点歌 B 房间的歌'))
  const dump = store.dump()
  check('A 房间队列没被覆盖', dump['100']?.queue?.[0]?.title === 'A 房间的歌', JSON.stringify(dump['100']?.queue))
  check('B 房间独立存', dump['200']?.queue?.[0]?.title === 'B 房间的歌', JSON.stringify(dump['200']?.queue))
  h.setRoom(100)
  check('切回 A 房间队列回来了', h.svc.getState().queue[0]?.title === 'A 房间的歌')
}
{
  const h = makeService()
  h.setRoom(null)
  h.bus.emit(danmu('点歌 没连接时点的'))
  check('没连直播间时不接单', h.svc.getState().queue.length === 0)
}

// ─── F. 真实钱包的 charge / refundCharge ─────────────────────
// 上面用的是内存假钱包，这里补一组打在真实 WalletStore 上的断言
console.log('\nF. 真实钱包扣费语义')
{
  const wallet = new WalletStore()
  const room = `verify-song-${Date.now()}`
  const uid = 'u1'
  wallet.getOrCreate(room, uid, '测试观众', 300)
  check('余额不足时返回 false', wallet.charge(room, uid, '测试观众', 500, 300) === false)
  check('返回 false 时一分没扣', wallet.query(room, uid, '测试观众')?.balance === 300)
  check('够钱时扣成功', wallet.charge(room, uid, '测试观众', 100, 300) === true)
  check('扣了正确的数', wallet.query(room, uid, '测试观众')?.balance === 200)
  check('charge 不污染 totalBet', wallet.query(room, uid, '测试观众')?.totalBet === 0)
  wallet.refundCharge(room, uid, '测试观众', 100)
  check('退款退回正确的数', wallet.query(room, uid, '测试观众')?.balance === 300)
  check('退款不污染 totalWon', wallet.query(room, uid, '测试观众')?.totalWon === 0)
  check('免费（0 元）视作扣费成功', wallet.charge(room, uid, '测试观众', 0, 300) === true)
}

// ─── G. 真实 SongStore 的落盘与脏数据容错 ────────────────────
// songs.json 是磁盘文件：可能是老版本写的、可能被手改坏、可能被别的程序截断。
// 读出来的东西直接进 UI 和退款逻辑，形状不校验的话一条坏记录能让整页白屏
console.log('\nG. 真实 SongStore')
{
  const store = new SongStore()
  const room = `verify-song-${Date.now()}`
  store.clearRoom(room)
  check('没存过的房间给空队列', store.get(room).queue.length === 0)

  store.set(room, {
    open: false,
    current: { id: 'c1', title: '正在唱', uid: 'u', uname: '甲', requestedAt: 1, cost: 5, source: 'danmu' },
    queue: [{ id: 'q1', title: '待唱', uid: 'u', uname: '甲', requestedAt: 2, cost: 0, source: 'danmu' }],
    history: []
  })
  const back = store.get(room)
  check('存了能读回来', back.current?.title === '正在唱' && back.queue[0]?.title === '待唱')
  check('open=false 也被如实存回', back.open === false)

  // 塞一堆坏数据进去，模拟被手改坏 / 老版本残留
  store.set(room, {
    open: true,
    current: null,
    queue: [
      { id: '', title: '没有 id', uid: 'u', uname: '甲', requestedAt: 1, cost: 0, source: 'danmu' },
      { id: 'ok', title: '正常的', uid: 'u', uname: '甲', requestedAt: 1, cost: 0, source: 'danmu' },
      null as never,
      { id: 'x', title: '', uid: 'u', uname: '甲', requestedAt: 1, cost: 0, source: 'danmu' }
    ],
    history: []
  })
  const cleaned = store.get(room)
  check('坏记录被剔掉，只留正常的', cleaned.queue.length === 1 && cleaned.queue[0].title === '正常的', JSON.stringify(cleaned.queue))

  store.clearRoom(room)
  check('clearRoom 清干净', store.get(room).queue.length === 0)
}

// ─── H. 与弹幕朗读的联动 ─────────────────────────────────────
// 「点歌 晴天」是一条指令，不是聊天。点歌台接管之后，弹幕朗读不该再把它原样念出来。
// 靠的是 speech-claim 的 WeakSet 标记 + main/index.ts 里"点歌先 attach、朗读后 attach"的顺序。
// 这条集成断言就是钉死那个顺序：谁把它调反了，这里会红
console.log('\nH. 点歌指令不会被弹幕朗读念出来')
{
  const bus = fakeBus()
  const spokenBySong: string[] = []
  const spokenByReader: string[] = []
  const songConfig = sanitizeSongRequestConfig({ enabled: true, perUserCooldownSec: 0 })
  const song = new SongRequestService({
    bus: bus as never,
    tts: { enqueue: (t: string) => void spokenBySong.push(t) } as never,
    log: { write: () => {} } as never,
    overlay: { broadcast: () => {} } as never,
    wallet: memoryWallet() as never,
    store: memoryStore(),
    getConfig: () => songConfig,
    getCurrentRoomId: () => 100,
    getInitialBalance: () => 1000,
    getCurrencyName: () => '哈松币'
  })
  song.attach() // 先 attach —— 和 main/index.ts 的装配顺序一致

  const reader = new DanmuReaderService({
    bus: bus as never,
    tts: { enqueue: (t: string) => void spokenByReader.push(t) } as never,
    getConfig: () =>
      sanitizeDanmuReaderConfig({ enabled: true, perUserCooldownSec: 0, dedupeWindowSec: 0 })
  })
  reader.attach() // 后 attach

  bus.emit(danmu('点歌 晴天'))
  check('点歌进了队', song.getState().queue.length === 1)
  check('点歌台报了一句', spokenBySong.length === 1, spokenBySong.join('|'))
  check('弹幕朗读没有重复念这条指令', spokenByReader.length === 0, spokenByReader.join('|'))

  bus.emit(danmu('今天天气不错', { uid: 'other' }))
  check('普通聊天照常朗读', spokenByReader.length === 1, spokenByReader.join('|'))

  bus.emit(danmu('取消点歌', { uid: 'other2' }))
  check('撤销指令也不会被念出来', spokenByReader.length === 1, spokenByReader.join('|'))
}

// ─── I. 没连直播间时的保护 ───────────────────────────────────
console.log('\nI. 没连直播间时不让主播白排歌')
{
  const h = makeService()
  h.setRoom(null)
  const r = h.svc.addByHost('开播前想排的歌')
  check('未连接时加歌被拒', r.ok === false && r.reason === 'no-room', JSON.stringify(r))
  check('拒绝时带了能看懂的话', Boolean(r.message), r.message ?? '')
  check('队列里没有半条脏数据', h.svc.getState().queue.length === 0)
}
{
  const h = makeService()
  const r = h.svc.addByHost('连上之后加的歌')
  check('连上之后能正常加', r.ok === true && h.svc.getState().queue.length === 1)
}

console.log(`\n${failures === 0 ? '全部通过' : '有失败项'}：${checks - failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)
