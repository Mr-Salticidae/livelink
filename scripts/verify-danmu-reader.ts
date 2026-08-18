/**
 * 弹幕朗读回归自检（离线跑，不联网、不碰 Electron）
 *
 *   pnpm verify:reader
 *
 * 覆盖三层，每一条都对应一个"不这么做就会在直播里翻车"的点：
 *   A. 文本净化   —— 观众能打出来的垃圾（表情码 / 外链 / 复读 / 纯 emoji）不能进 TTS
 *   B. 过滤与限流 —— scope / 黑名单 / 单人冷却 / 内容去重 / 已被接管的不重念
 *   C. 播报队列   —— 优先级（礼物不能被弹幕挤掉）、低优先级上限、过期丢弃
 *
 * 这里刻意不测 edge-tts 合成本身：那是联网行为，属于 TTS 页「测试声音」的职责。
 */
import {
  collapseRuns,
  dedupeKey,
  normalizeDanmuForSpeech,
  type NormalizeOptions
} from '../src/main/services/danmu-text'
import { DanmuReaderService } from '../src/main/services/danmu-reader'
import { claimSpeech } from '../src/main/services/speech-claim'
import {
  DEFAULT_DANMU_READER_CONFIG,
  sanitizeDanmuReaderConfig,
  type DanmuReaderConfig
} from '../src/shared/danmu-reader'
import type { StandardEvent, UserInfo } from '../src/main/platform/adapter'
import { TTSPlayer } from '../src/main/actions/tts'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
}

const OPTS: NormalizeOptions = {
  stripEmotes: true,
  skipUrls: true,
  collapseRepeats: true,
  minLength: 2,
  maxLength: 30
}

// ─── A. 文本净化 ──────────────────────────────────────────────
console.log('\nA. 文本净化')
{
  const r = normalizeDanmuForSpeech('主播好厉害[妙][打call]', OPTS)
  check('表情码被剥掉', r.text === '主播好厉害', JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('快去 https://example.com/live 看看', OPTS)
  check('含网址整条跳过', r.text === '' && r.reason === 'url', JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('快去 example.com 看看', { ...OPTS, skipUrls: false })
  check('不跳过时链接念成"网址"', r.text.includes('网址'), JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('这个数字 3.5 很关键', OPTS)
  check('小数点不被误判成网址', r.text.includes('3.5'), JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('6666666', OPTS)
  check('复读被压缩', r.text === '666', JSON.stringify(r))
}
{
  check('多字复读被压缩', collapseRuns('加油加油加油加油') === '加油加油')
  check('哈字复读被压缩', collapseRuns('哈哈哈哈哈哈哈') === '哈哈哈')
  check('正常文本不被误压', collapseRuns('今天天气不错') === '今天天气不错')
}
{
  const r = normalizeDanmuForSpeech('[dog][dog][dog]', OPTS)
  check('纯表情码判定为不该念', r.text === '' && r.reason !== undefined, JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('。。。！！！', OPTS)
  check('纯标点判定为不该念', r.text === '' && r.reason === 'no-readable', JSON.stringify(r))
}
{
  const r = normalizeDanmuForSpeech('6', OPTS)
  check('太短不念', r.text === '' && r.reason === 'too-short', JSON.stringify(r))
}
{
  // 故意用不重复的文本：同一个字重复 60 遍会先被"压缩复读"吃掉，测不到截断
  const long = '主播今天讲的这段内容特别长我要一口气把它全部打出来看看会不会被截断呢真的很长啊'
  const r = normalizeDanmuForSpeech(long, OPTS)
  check(
    '超长被截断且带省略号',
    Array.from(r.text).length === OPTS.maxLength + 1 && r.text.endsWith('…'),
    `len=${Array.from(r.text).length}`
  )
}
{
  // 带 g 标志的正则有 lastIndex 粘性，同一条连测两次必须结果一致
  const a = normalizeDanmuForSpeech('看 https://a.com 啊', OPTS)
  const b = normalizeDanmuForSpeech('看 https://a.com 啊', OPTS)
  check('正则 lastIndex 不串场', a.reason === b.reason && a.reason === 'url')
}
{
  check('去重键忽略标点与大小写', dedupeKey('666！') === dedupeKey('666'))
  check('去重键区分不同内容', dedupeKey('晚上好') !== dedupeKey('早上好'))
}

// ─── B. 过滤与限流 ────────────────────────────────────────────
console.log('\nB. 过滤与限流')

interface Spoken {
  text: string
  priority?: string
  voice?: string
}

/** 只记录入队内容的假 TTSPlayer，避免联网合成 */
function fakeTts(): { spoken: Spoken[]; enqueue: (t: string, o?: Record<string, unknown>) => void } {
  const spoken: Spoken[] = []
  return {
    spoken,
    enqueue(text: string, options?: Record<string, unknown>) {
      spoken.push({
        text,
        priority: options?.priority as string | undefined,
        voice: options?.voiceOverride as string | undefined
      })
    }
  }
}

/** 只支持 on/off/emit 的假 bus，签名与 mitt 对齐 */
function fakeBus(): {
  handlers: ((e: StandardEvent) => void)[]
  on: (k: string, h: (e: StandardEvent) => void) => void
  off: (k: string, h: (e: StandardEvent) => void) => void
  emit: (e: StandardEvent) => void
} {
  const handlers: ((e: StandardEvent) => void)[] = []
  return {
    handlers,
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

function makeReader(patch: Partial<DanmuReaderConfig> = {}): {
  reader: DanmuReaderService
  bus: ReturnType<typeof fakeBus>
  tts: ReturnType<typeof fakeTts>
} {
  const bus = fakeBus()
  const tts = fakeTts()
  const config = sanitizeDanmuReaderConfig({
    ...DEFAULT_DANMU_READER_CONFIG,
    enabled: true,
    perUserCooldownSec: 0,
    dedupeWindowSec: 0,
    ...patch
  })
  const reader = new DanmuReaderService({
    // 假 bus / 假 tts 的形状与真实接口一致，这里的 cast 只是为了绕开结构类型检查
    bus: bus as never,
    tts: tts as never,
    getConfig: () => config
  })
  reader.attach()
  return { reader, bus, tts }
}

{
  const { bus, tts } = makeReader()
  bus.emit(danmu('今天天气不错'))
  check('默认全员朗读', tts.spoken.length === 1, JSON.stringify(tts.spoken))
  check('套用了模板', tts.spoken[0]?.text === '观众甲说：今天天气不错', tts.spoken[0]?.text)
  check('优先级固定 low', tts.spoken[0]?.priority === 'low', tts.spoken[0]?.priority)
}
{
  const { bus, tts } = makeReader({ scope: 'guard' })
  bus.emit(danmu('路人发言'))
  bus.emit(danmu('舰长发言', { uid: '2002', guardLevel: 3 }))
  check('仅舰长时过滤掉路人', tts.spoken.length === 1, JSON.stringify(tts.spoken))
  check('舰长的念了', tts.spoken[0]?.text.includes('舰长发言'), tts.spoken[0]?.text)
}
{
  const { bus, tts } = makeReader({ scope: 'medal', minMedalLevel: 10, requireAnchorMedal: true })
  bus.emit(danmu('没牌子', { uid: '1' }))
  bus.emit(danmu('低等级', { uid: '2', fansMedal: { level: 3, name: 'x', isAnchor: true, isLighted: true } }))
  bus.emit(danmu('别家牌子', { uid: '3', fansMedal: { level: 20, name: 'y', isAnchor: false, isLighted: true } }))
  bus.emit(danmu('够格了', { uid: '4', fansMedal: { level: 12, name: 'z', isAnchor: true, isLighted: true } }))
  check('粉丝牌三种不合格全挡住', tts.spoken.length === 1, JSON.stringify(tts.spoken))
  check('合格的念了', tts.spoken[0]?.text.includes('够格了'), tts.spoken[0]?.text)
}
{
  const { bus, tts } = makeReader({ scope: 'keyword', keywords: ['念一下'] })
  bus.emit(danmu('随便说说'))
  bus.emit(danmu('念一下 主播今天真好看'))
  check('仅关键词时非触发的不念', tts.spoken.length === 1, JSON.stringify(tts.spoken))
  check(
    '触发词本身不被念出来',
    !!tts.spoken[0] && !tts.spoken[0].text.includes('念一下'),
    tts.spoken[0]?.text
  )
}
{
  const { bus, tts } = makeReader({ blockKeywords: ['广告'] })
  bus.emit(danmu('这是广告内容'))
  check('黑名单整条拦下', tts.spoken.length === 0, JSON.stringify(tts.spoken))
}
{
  const { bus, tts } = makeReader({ perUserCooldownSec: 60 })
  bus.emit(danmu('第一条发言'))
  bus.emit(danmu('第二条发言'))
  check('同一个人被冷却挡住', tts.spoken.length === 1, JSON.stringify(tts.spoken))
  bus.emit(danmu('别人的发言', { uid: '9999', uname: '观众乙' }))
  check('冷却只针对同一个人', tts.spoken.length === 2, JSON.stringify(tts.spoken))
}
{
  const { bus, tts } = makeReader({ dedupeWindowSec: 60 })
  bus.emit(danmu('主播好帅', { uid: 'a' }))
  bus.emit(danmu('主播好帅！', { uid: 'b' }))
  check('跟风复读只念一次', tts.spoken.length === 1, JSON.stringify(tts.spoken))
}
{
  const { bus, tts } = makeReader({ skipHandled: true })
  const e = danmu('你好')
  claimSpeech(e) // 模拟问候规则已经接管播报
  bus.emit(e)
  check('已被规则接管的不重复念', tts.spoken.length === 0, JSON.stringify(tts.spoken))
}
{
  const { bus, tts } = makeReader({ skipHandled: false })
  const e = danmu('你好呀朋友')
  claimSpeech(e)
  bus.emit(e)
  check('关掉开关后仍然念', tts.spoken.length === 1, JSON.stringify(tts.spoken))
}
{
  const { bus, tts } = makeReader({ voice: 'zh-CN-YunxiNeural' })
  bus.emit(danmu('换个音色念'))
  check('朗读音色透传给 TTS', tts.spoken[0]?.voice === 'zh-CN-YunxiNeural', tts.spoken[0]?.voice)
}
{
  const { bus, tts } = makeReader({ enabled: false })
  bus.emit(danmu('关掉之后不该念'))
  check('总开关关掉后一条都不念', tts.spoken.length === 0, JSON.stringify(tts.spoken))
}
{
  const { reader, bus, tts } = makeReader({ perUserCooldownSec: 60 })
  bus.emit(danmu('换房间前的发言'))
  reader.resetRuntime()
  bus.emit(danmu('换房间后的发言'))
  check('resetRuntime 清掉冷却记录', tts.spoken.length === 2, JSON.stringify(tts.spoken))
}
{
  const cfg = sanitizeDanmuReaderConfig({ template: '{uname}真棒' })
  check('模板缺 {content} 时回退默认', cfg.template === DEFAULT_DANMU_READER_CONFIG.template, cfg.template)
}
{
  const cfg = sanitizeDanmuReaderConfig({ maxLength: 9999, perUserCooldownSec: -5 })
  check('越界数值被夹回合法区间', cfg.maxLength === 80 && cfg.perUserCooldownSec === 0, JSON.stringify(cfg))
}

// ─── C. 播报队列 ──────────────────────────────────────────────
console.log('\nC. 播报队列（真实 TTSPlayer）')

// 直接驱动真正的 TTSPlayer，而不是在这里复刻一份排队规则——
// 复刻出来的只能验证"我以为的逻辑"，实现改坏了照样全绿。
//
// 唯一要拦住的是 drain()：它会真的去调 edge-tts 合成、开 BrowserWindow 播放。
// 把它换成空实现，enqueue 的入队 / 淘汰 / 排序逻辑就全部裸露出来可断言了。
const MAX_QUEUE = 20
const MAX_LOW = 6

type QueuePeek = { text: string; rank: number; expireAt: number }

function makePlayer(): {
  player: TTSPlayer
  // 必须每次调用时才去读 inner.queue：stop() 是整体换一个新数组，
  // 提前把引用存下来的话断言看到的永远是那个旧数组
  peek: () => QueuePeek[]
  take: () => QueuePeek | null
} {
  const player = new TTSPlayer()
  const inner = player as unknown as {
    drain: () => Promise<void>
    queue: QueuePeek[]
    dequeue: () => QueuePeek | null
  }
  inner.drain = async () => {}
  player.setConfig({ enabled: true, style: 'normal' })
  return { player, peek: () => inner.queue, take: () => inner.dequeue() }
}

{
  const { player, take } = makePlayer()
  player.enqueue('弹幕1', { priority: 'low' })
  player.enqueue('弹幕2', { priority: 'low' })
  player.enqueue('礼物', { priority: 'high' })
  player.enqueue('欢迎', { priority: 'normal' })
  check('礼物插到最前', take()?.text === '礼物')
  check('欢迎排在弹幕前', take()?.text === '欢迎')
  check('同优先级内先进先出', take()?.text === '弹幕1')
}
{
  const { player, peek } = makePlayer()
  for (let i = 0; i < 10; i++) player.enqueue(`弹幕${i}`, { priority: 'low' })
  check('低优先级不超过上限', peek().length === MAX_LOW, `len=${peek().length}`)
  check(
    '留下的是最新的几条',
    peek()[peek().length - 1]?.text === '弹幕9',
    peek()
      .map((i) => i.text)
      .join(',')
  )
}
{
  const { player, peek } = makePlayer()
  for (let i = 0; i < MAX_QUEUE; i++) player.enqueue(`礼物${i}`, { priority: 'high' })
  const before = player.getStats().dropped
  player.enqueue('一条弹幕', { priority: 'low' })
  check('队列被高优先级占满时低优先级直接丢弃', player.getStats().dropped === before + 1)
  check('丢弃不影响已排队的礼物', peek().length === MAX_QUEUE, `len=${peek().length}`)
  check('弹幕确实没进队', !peek().some((i) => i.text === '一条弹幕'))
}
{
  const { player, take } = makePlayer()
  player.enqueue('过期的', { priority: 'low', ttlMs: -1 })
  player.enqueue('新鲜的', { priority: 'low', ttlMs: 60_000 })
  const got = take()
  check('过期条目在出队时被丢掉', got?.text === '新鲜的', got?.text)
  check('丢弃被计数', player.getStats().dropped === 1, `dropped=${player.getStats().dropped}`)
}
{
  const { player, peek } = makePlayer()
  player.enqueue('礼物', { priority: 'high' })
  player.enqueue('弹幕', { priority: 'low' })
  player.stop()
  check('stop 清空整条队列', peek().length === 0, `len=${peek().length}`)
  check('stop 后 stats 也归零', player.getStats().queued === 0)
}
{
  const { player, peek } = makePlayer()
  player.setConfig({ enabled: false })
  player.enqueue('关掉之后', { priority: 'normal' })
  check('TTS 总开关关掉后不入队', peek().length === 0, `len=${peek().length}`)
}
{
  const { player, take } = makePlayer()
  player.setConfig({ style: 'mambo' })
  player.enqueue('今天天气不错', { priority: 'normal' })
  check('曼波风格加了口癖', take()?.text === '曼波，今天天气不错，芜湖')
}

// ─── D. drain 循环（预合成 / 竞态 / 打断）────────────────────
// 这段是本次改动里最容易写出隐蔽 bug 的地方：
//   预合成写错 → 条与条之间又出现静默（等于白改）
//   竞态处理漏 → 播放期间进来的弹幕永远卡在队列里，表现成"念着念着不念了"
//   打断没做对 → 点了停止还在念，或者 await 永久挂住
// 所以直接驱动真实的 drain()，只把"联网合成"和"开窗播放"换成可观测的桩。
console.log('\nD. drain 循环（预合成 / 竞态 / 打断）')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function makeDrivablePlayer(synthMs = 40, playMs = 60): { player: TTSPlayer; events: string[] } {
  const player = new TTSPlayer()
  const events: string[] = []
  const inner = player as unknown as {
    synthesizeOnce: (text: string, voice: string) => Promise<Buffer>
    play: (audio: Buffer) => Promise<void>
  }
  // 把文本塞进 Buffer，play 那头才能认出正在播的是哪一条
  inner.synthesizeOnce = async (text: string) => {
    events.push(`synth-start:${text}`)
    await sleep(synthMs)
    events.push(`synth-end:${text}`)
    return Buffer.from(text, 'utf-8')
  }
  inner.play = async (audio: Buffer) => {
    const text = audio.toString('utf-8')
    events.push(`play-start:${text}`)
    await sleep(playMs)
    events.push(`play-end:${text}`)
  }
  player.setConfig({ enabled: true, style: 'normal' })
  return { player, events }
}

async function runDrainChecks(): Promise<void> {
  {
    const { player, events } = makeDrivablePlayer()
    player.enqueue('A', { priority: 'normal' })
    player.enqueue('B', { priority: 'normal' })
    await sleep(400)
    check('两条都念完了', events.includes('play-end:A') && events.includes('play-end:B'), events.join(' '))
    check('按顺序念', events.indexOf('play-start:A') < events.indexOf('play-start:B'))
    check(
      'B 的合成在 A 播完之前就开始了（预合成生效）',
      events.indexOf('synth-start:B') < events.indexOf('play-end:A'),
      events.join(' ')
    )
  }
  {
    const { player, events } = makeDrivablePlayer()
    player.enqueue('A', { priority: 'normal' })
    player.enqueue('B', { priority: 'normal' })
    await sleep(120) // 正在播 A 的时候插进来一条
    player.enqueue('C', { priority: 'normal' })
    await sleep(500)
    check('播放期间新进的那条没被漏掉', events.includes('play-end:C'), events.join(' '))
  }
  {
    // 队列先空下来、drain 退出之后再来一条，必须能重新启动循环
    const { player, events } = makeDrivablePlayer()
    player.enqueue('A', { priority: 'normal' })
    await sleep(300)
    player.enqueue('B', { priority: 'normal' })
    await sleep(300)
    check('队列空过之后还能重新启动', events.includes('play-end:B'), events.join(' '))
  }
  {
    const { player, events } = makeDrivablePlayer()
    player.enqueue('A', { priority: 'normal' })
    player.enqueue('B', { priority: 'normal' })
    player.enqueue('C', { priority: 'normal' })
    await sleep(120)
    player.stop()
    const afterStop = events.length
    await sleep(400)
    const newPlays = events.slice(afterStop).filter((e) => e.startsWith('play-start:'))
    check('stop 之后不再开新的播放', newPlays.length === 0, events.slice(afterStop).join(' '))
    check('stop 之后 C 没被念', !events.includes('play-start:C'), events.join(' '))
  }
  {
    // 合成失败不能中断整条队列——一条挂了后面的还得念
    const { player, events } = makeDrivablePlayer()
    const inner = player as unknown as {
      synthesizeOnce: (text: string, voice: string) => Promise<Buffer>
    }
    const ok = inner.synthesizeOnce
    inner.synthesizeOnce = async (text: string, voice: string) => {
      if (text === 'BAD') throw new Error('boom')
      return ok(text, voice)
    }
    player.enqueue('BAD', { priority: 'normal' })
    player.enqueue('GOOD', { priority: 'normal' })
    // BAD 会走满 3 次尝试 + 2×400ms 重试间隔，得等它彻底失败后才轮到 GOOD
    await sleep(2600)
    check('某条合成失败不影响后面的', events.includes('play-end:GOOD'), events.join(' '))
  }

  console.log(`\n${failures === 0 ? '全部通过' : '有失败项'}：${checks - failures}/${checks}`)
  process.exit(failures === 0 ? 0 : 1)
}

void runDrainChecks()
