/**
 * AI 智能回复回归自检（离线跑，不联网、不碰 Electron）
 *
 *   pnpm verify:ai-reply
 *
 * 起因是一条主播反馈：「我明明把 DeepSeek 的 Key 填进去了，它还说我没填」。
 * 这里把那条链路上每一个"能悄悄吃掉 Key / 悄悄吃掉错误"的地方都钉死：
 *   A. Key 净化   —— 复制粘贴带来的换行、全角空格、零宽字符不能留在 Key 里
 *   B. 保存语义   —— 留空 = 不覆盖，空串 = 清除，有值 = 覆盖；三者不能混
 *   C. 对外快照   —— hasApiKey / 打码提示要如实反映"到底存没存上"
 *   D. 出错说人话 —— Key 无效 / 余额不足 / 限流 / 超时 / 网络挡了，四种说法不能混成一句
 *   E. 弹幕链路   —— 触发、冷却、播报、失败写日志
 *
 * 这里不测真的 DeepSeek 调用（那是联网行为，属于页面上「保存并测试」的职责），
 * fetch 一律打桩。
 */
import {
  DEFAULT_AI_REPLY_CONFIG,
  maskApiKey,
  mergeAiReplyPatch,
  normalizeApiKey,
  sanitizeAiReplyConfig,
  toPublicAiReplyConfig,
  type AiReplyConfig
} from '../src/shared/ai-reply'
import { AiReplyService } from '../src/main/services/ai-reply'
import type { StandardEvent } from '../src/main/platform/adapter'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
}

const KEY = 'sk-0123456789abcdef0123456789abcdef'

// ─── A. Key 净化 ──────────────────────────────────────────────
console.log('\nA. Key 净化（复制粘贴带进来的脏字符）')
{
  check('前后空格 / 换行被清掉', normalizeApiKey(`  ${KEY}\n`) === KEY)
  check('中间的换行也清掉', normalizeApiKey(`sk-0123456789abcdef\n0123456789abcdef`) === KEY)
  check('全角空格被清掉', normalizeApiKey(`${KEY}　`) === KEY)
  check('零宽字符被清掉', normalizeApiKey(`​${KEY}‍`) === KEY)
  check('BOM 被清掉', normalizeApiKey(`﻿${KEY}`) === KEY)
  check('undefined / null 不炸', normalizeApiKey(undefined) === '' && normalizeApiKey(null) === '')
  check('纯空白等于没填', normalizeApiKey('   \n　') === '')
}
{
  const masked = maskApiKey(KEY)
  check('打码保留头尾，够主播认出是哪一把', masked.startsWith('sk-012') && masked.endsWith('cdef'), masked)
  check('打码不泄露中间部分', !masked.includes('6789abcdef0123'), masked)
  check('没有 Key 时打码是空串', maskApiKey('') === '')
}

// ─── B. 保存语义 ──────────────────────────────────────────────
console.log('\nB. 保存语义（留空 / 清除 / 覆盖）')
const saved: AiReplyConfig = sanitizeAiReplyConfig({ ...DEFAULT_AI_REPLY_CONFIG, apiKey: KEY })
{
  // 页面提交的是 public 配置（没有 apiKey 字段）+ 可选的 apiKey
  const patch = { ...toPublicAiReplyConfig(saved), cooldownSec: 12 } as Partial<AiReplyConfig>
  const next = mergeAiReplyPatch(saved, patch)
  check('改别的设置时不会把 Key 冲掉', next.apiKey === KEY, next.apiKey)
  check('别的设置确实生效了', next.cooldownSec === 12)
  check('public 配置里的 hasApiKey 不会污染存储', !('hasApiKey' in next))
  check('public 配置里的 apiKeyHint 不会污染存储', !('apiKeyHint' in next))
}
{
  const next = mergeAiReplyPatch(saved, { apiKey: '' })
  check('显式空串 = 清除 Key', next.apiKey === '')
}
{
  const next = mergeAiReplyPatch(sanitizeAiReplyConfig({}), { apiKey: `  ${KEY} ` })
  check('第一次填 Key：净化后存进去', next.apiKey === KEY, next.apiKey)
}
{
  const next = mergeAiReplyPatch(saved, { apiKey: '   ' })
  check('粘贴失败（只粘到空白）不会留下垃圾 Key', next.apiKey === '')
}
{
  // 老版本配置里没有这些字段 / 类型不对，也不能把保存整条链路搞崩
  const legacy = mergeAiReplyPatch(sanitizeAiReplyConfig({ enabled: true } as never), {
    apiKey: KEY
  })
  check('老配置升级后仍能存下 Key', legacy.apiKey === KEY && legacy.enabled)
}

// ─── C. 对外快照 ──────────────────────────────────────────────
console.log('\nC. 页面拿到的快照')
{
  const pub = toPublicAiReplyConfig(saved)
  check('hasApiKey 为真', pub.hasApiKey)
  check('快照里不带明文 Key', !('apiKey' in pub))
  check('带打码提示，页面能证明"存的就是这把"', pub.apiKeyHint === maskApiKey(KEY), pub.apiKeyHint)
}
{
  const pub = toPublicAiReplyConfig(sanitizeAiReplyConfig({ apiKey: '  \n ' }))
  check('只粘到空白时 hasApiKey 为假', !pub.hasApiKey)
  check('没有 Key 时不给打码提示', pub.apiKeyHint === '')
}

async function main(): Promise<void> {
  // ─── D. 出错说人话 ────────────────────────────────────────────
  console.log('\nD. DeepSeek 出错时的提示')
  type FetchLike = typeof globalThis.fetch
  const realFetch = globalThis.fetch

  function serviceWith(config: Partial<AiReplyConfig>, spoken: string[] = [], logs: string[] = []) {
    const listeners: ((e: StandardEvent) => void)[] = []
    const bus = {
      on: (_t: 'event', h: (e: StandardEvent) => void) => listeners.push(h),
      off: (_t: 'event', h: (e: StandardEvent) => void) => {
        const i = listeners.indexOf(h)
        if (i >= 0) listeners.splice(i, 1)
      },
      emit: (_t: 'event', e: StandardEvent) => listeners.slice().forEach((h) => h(e))
    }
    const service = new AiReplyService({
      bus: bus as never,
      tts: { enqueue: (text: string) => spoken.push(text) } as never,
      log: { write: (entry: { text: string }) => logs.push(entry.text) } as never,
      getConfig: () => sanitizeAiReplyConfig(config)
    })
    return { service, bus, spoken, logs }
  }

  function stubFetch(impl: (url: string, init: RequestInit) => unknown): void {
    globalThis.fetch = ((url: string, init: RequestInit) =>
      Promise.resolve(impl(url, init))) as unknown as FetchLike
  }

  function httpStub(status: number, body: unknown) {
    return () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  }

  async function messageOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
      return '(没有抛错)'
    } catch (err) {
      return (err as Error)?.message ?? String(err)
    }
  }

  {
    const { service } = serviceWith({ apiKey: '' })
    const msg = await messageOf(service.test('你好'))
    check('没 Key 时告诉主播下一步干什么', msg.includes('保存') && msg.includes('API Key'), msg)
  }
  {
    stubFetch(httpStub(401, { error: { message: 'Authentication Fails' } }))
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('401 说的是 Key 不对', msg.includes('Key'), msg)
    check('401 不冒充网络问题', !msg.includes('网络'), msg)
  }
  {
    stubFetch(httpStub(402, { error: { message: 'Insufficient Balance' } }))
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('402 说的是余额不足', msg.includes('余额'), msg)
  }
  {
    stubFetch(httpStub(429, {}))
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('429 说的是被限流 + 怎么办', msg.includes('限流') && msg.includes('冷却'), msg)
  }
  {
    stubFetch(httpStub(503, {}))
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('5xx 说的是 DeepSeek 那边的问题', msg.includes('服务器'), msg)
  }
  {
    globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as FetchLike
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('连不上时点名网络 / 代理', msg.includes('网络') && msg.includes('api.deepseek.com'), msg)
  }
  {
    globalThis.fetch = (() => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    }) as unknown as FetchLike
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('超时说的是超时，不是"没返回内容"', msg.includes('15 秒'), msg)
  }
  {
    stubFetch(httpStub(200, { choices: [{ message: { content: '  今天玩\n恐怖游戏  ' } }] }))
    const { service } = serviceWith({ apiKey: KEY })
    const reply = await service.test('今天玩什么')
    check('正常回复：换行被压平，两头空白去掉', reply === '今天玩 恐怖游戏', JSON.stringify(reply))
  }
  {
    // Key 里混进换行时，fetch 会抛 Invalid header value —— 净化之后不该再发生，
    // 但万一发生了也得说人话
    stubFetch(() => {
      throw new TypeError('Invalid header value')
    })
    const { service } = serviceWith({ apiKey: KEY })
    const msg = await messageOf(service.test('你好'))
    check('非法请求头翻译成"Key 里有非法字符"', msg.includes('非法字符'), msg)
  }

  // ─── E. 弹幕链路 ──────────────────────────────────────────────
  console.log('\nE. 弹幕进来之后')
  function danmu(content: string, uid = '1', uname = '观众A'): StandardEvent {
    return {
      kind: 'danmu.received',
      platform: 'bilibili',
      timestamp: Date.now(),
      user: { uid, uname },
      payload: { content }
    } as StandardEvent
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  {
    stubFetch(httpStub(200, { choices: [{ message: { content: '玩恐怖游戏！' } }] }))
    const { service, bus, spoken } = serviceWith({
      enabled: true,
      apiKey: KEY,
      triggerMode: 'mention',
      mentionName: '小助手',
      cooldownSec: 0,
      perUserCooldownSec: 0
    })
    service.attach()
    bus.emit('event', danmu('小助手 今天玩什么'))
    await settle()
    check('点名触发会回复', spoken.length === 1 && spoken[0] === '玩恐怖游戏！', JSON.stringify(spoken))

    bus.emit('event', danmu('今天天气不错'))
    await settle()
    check('没点名的弹幕不回', spoken.length === 1, JSON.stringify(spoken))
    service.dispose()
  }
  {
    stubFetch(httpStub(200, { choices: [{ message: { content: '好的' } }] }))
    const { service, bus, spoken } = serviceWith({
      enabled: true,
      apiKey: KEY,
      triggerMode: 'all',
      cooldownSec: 60,
      perUserCooldownSec: 0
    })
    service.attach()
    bus.emit('event', danmu('第一条'))
    await settle()
    bus.emit('event', danmu('第二条', '2', '观众B'))
    await settle()
    check('全局冷却内只回一条', spoken.length === 1, JSON.stringify(spoken))
    service.dispose()
  }
  {
    const { service, bus, spoken } = serviceWith({ enabled: false, apiKey: KEY, triggerMode: 'all' })
    service.attach()
    bus.emit('event', danmu('在吗'))
    await settle()
    check('总开关关着时一次 API 都不调', spoken.length === 0)
    service.dispose()
  }
  {
    const { service, bus, spoken } = serviceWith({ enabled: true, apiKey: '', triggerMode: 'all' })
    service.attach()
    bus.emit('event', danmu('在吗'))
    await settle()
    check('没 Key 时一次 API 都不调（不会产生费用）', spoken.length === 0)
    service.dispose()
  }
  {
    stubFetch(httpStub(401, { error: { message: 'Authentication Fails' } }))
    const { service, bus, logs } = serviceWith({
      enabled: true,
      apiKey: KEY,
      triggerMode: 'all',
      cooldownSec: 0
    })
    service.attach()
    bus.emit('event', danmu('在吗'))
    await settle()
    await settle()
    check('直播中失败会写进日志页，不是只进 console', logs.some((l) => l.includes('AI 回复失败')), JSON.stringify(logs))
    check('日志里带的是人话原因', logs.some((l) => l.includes('Key')), JSON.stringify(logs))
    service.dispose()
  }

  globalThis.fetch = realFetch

  console.log(`\n${failures === 0 ? '全部通过' : '有失败'}：${checks - failures}/${checks}`)
  process.exit(failures === 0 ? 0 : 1)

}

void main()
