/**
 * 欢迎语多句随机回归自检（纯逻辑、离线运行，不联网、不碰 Electron）：
 *
 *   pnpm verify:welcome
 *
 * 盯住三件事：
 *   1. 单行模板的行为和以前一模一样 —— 老配置不迁移也不能变味
 *   2. 多句模板真的会轮着来，不是永远挑同一句
 *   3. 同一次进房，TTS 念的和 OBS 显示的是对应的那一句
 *      （这条是真正会被观众看见的 bug：耳朵里听到"哟，张三"、画面上写着"张三，坐"）
 */
import { ActionDispatcher } from '../src/main/actions/dispatcher'
import { defaultRules, upgradeUntouchedWelcome } from '../src/main/rules/defaults'
import { buildTemplateContext, guardName, pickLine, renderPick } from '../src/main/rules/template'
import type { StandardEvent, UserInfo } from '../src/main/platform/adapter'
import type { Rule } from '../src/main/rules/types'

let checks = 0
let failures = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}

function viewer(overrides: Partial<UserInfo> = {}): UserInfo {
  return { uid: '1001', uname: '张三', ...overrides }
}

function enterEvent(user: UserInfo = viewer()): StandardEvent {
  return { kind: 'viewer.enter', platform: 'bilibili', timestamp: 0, user, payload: {} }
}

// 收集派发结果的假依赖。dispatcher 对 tts / overlay / log 这些模块全是 import type，
// 所以离线 bundle 出来跑得起来，不需要 Electron
function makeDispatcher(): {
  dispatcher: ActionDispatcher
  spoken: string[]
  shown: string[]
  logged: string[]
} {
  const spoken: string[] = []
  const shown: string[] = []
  const logged: string[] = []
  const deps = {
    tts: { enqueue: (text: string) => spoken.push(text) },
    overlay: { broadcast: (msg: { text?: string }) => shown.push(msg.text ?? '') },
    log: { writeFromRule: (_r: Rule, _e: StandardEvent, text: string) => logged.push(text) },
    blindboxStore: {},
    wallet: {},
    getCurrentRoomId: () => 26794901,
    getCurrencyName: () => '哈松币',
    getInitialBalance: () => 0
  }
  // 只实现本自检会走到的方法，形状对不上完整接口是预期内的
  const dispatcher = new ActionDispatcher(deps as unknown as ConstructorParameters<typeof ActionDispatcher>[0])
  return { dispatcher, spoken, shown, logged }
}

function makeRule(id: string, actions: Rule['actions']): Rule {
  return {
    id,
    name: id,
    enabled: true,
    trigger: 'viewer.enter',
    match: { kind: 'always' },
    cooldownSec: 0,
    perUserCooldownSec: 0,
    actions
  }
}

const EIGHT = ['一', '二', '三', '四', '五', '六', '七', '八'].join('\n')

async function main(): Promise<void> {
  console.log('\nA. 挑句子本身')
  check('单行模板原样返回（roll=0）', pickLine('欢迎{uname}', 0) === '欢迎{uname}')
  check('单行模板原样返回（roll≈1）', pickLine('欢迎{uname}', 0.999) === '欢迎{uname}')
  check('空模板 → 空串', pickLine('', 0.5) === '')
  check('只有空行空格 → 空串', pickLine('  \n\n   \n', 0.5) === '')
  check('多句：roll=0 取第一句', pickLine(EIGHT, 0) === '一')
  check('多句：roll≈1 取最后一句', pickLine(EIGHT, 0.999999) === '八')
  check('多句：roll=0.5 取中间', pickLine(EIGHT, 0.5) === '五')
  check('每句首尾空白被清掉', pickLine('  甲  \n  乙  ', 0) === '甲')
  check('Windows 换行（\\r\\n）也能拆句', pickLine('甲\r\n乙', 0.999999) === '乙')
  check('空行不占位（不会挑到空句）', pickLine('甲\n\n\n乙', 0.999999) === '乙')
  check('roll 越界不崩（>1）', pickLine(EIGHT, 5) === '八')
  check('roll 越界不崩（<0）', pickLine(EIGHT, -3) === '一')
  check('roll 是 NaN 时退回第一句', pickLine(EIGHT, Number.NaN) === '一')

  console.log('\nB. 真的会轮着来')
  {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i += 1) seen.add(pickLine(EIGHT, Math.random()))
    check('2000 次随机能取遍全部 8 句', seen.size === 8, `取到 ${seen.size} 句`)
    const counts = new Map<string, number>()
    for (let i = 0; i < 8000; i += 1) {
      const line = pickLine(EIGHT, Math.random())
      counts.set(line, (counts.get(line) ?? 0) + 1)
    }
    const min = Math.min(...counts.values())
    const max = Math.max(...counts.values())
    // 均匀分布下每句期望 1000 次；放宽到 600~1400，只为挡住"某句几乎抽不到"的实现错误
    check('八句分布大致均匀，没有哪句几乎抽不到', min > 600 && max < 1400, `最少 ${min} 次 / 最多 ${max} 次`)
  }

  console.log('\nC. 身份占位符')
  check('无大航海 → {guardName} 是空串', guardName(undefined) === '' && guardName(0) === '')
  check(
    '1/2/3 → 总督 / 提督 / 舰长',
    guardName(1) === '总督' && guardName(2) === '提督' && guardName(3) === '舰长'
  )
  {
    const ctx = buildTemplateContext(enterEvent(viewer()))
    check(
      '普通观众：guardName 空、medalLevel 0、medalName 空',
      ctx.guardName === '' && ctx.medalLevel === '0' && ctx.medalName === ''
    )
    check('一句模板照顾两种身份：普通观众', renderPick('{guardName}{uname}到了', ctx, 0) === '张三到了')
  }
  {
    const ctx = buildTemplateContext(
      enterEvent(
        viewer({ guardLevel: 3, fansMedal: { level: 35, name: '赚一菠', isAnchor: true, isLighted: true } })
      )
    )
    check(
      '舰长 + 35 级牌子：占位符都对',
      ctx.guardName === '舰长' && ctx.medalLevel === '35' && ctx.medalName === '赚一菠'
    )
    check('一句模板照顾两种身份：舰长', renderPick('{guardName}{uname}到了', ctx, 0) === '舰长张三到了')
    check(
      '牌子等级能进欢迎语',
      renderPick('{medalName}{medalLevel}级的{uname}来了', ctx, 0) === '赚一菠35级的张三来了'
    )
  }
  {
    const guardEvent = {
      kind: 'guard.bought',
      platform: 'bilibili',
      timestamp: 0,
      user: viewer(),
      payload: { guardLevel: 2, giftName: '提督', price: 1998, num: 1 }
    } as unknown as StandardEvent
    const ctx = buildTemplateContext(guardEvent)
    check('上舰事件用 payload 里的等级，不是 user 上的', ctx.guardName === '提督' && ctx.guardLevel === '2')
  }
  check(
    '未知占位符仍然渲染成空串（沿用旧行为）',
    renderPick('{nope}{uname}', buildTemplateContext(enterEvent()), 0) === '张三'
  )

  console.log('\nD. 同一次进房，听到的和看到的是同一句')
  {
    const rule = makeRule('welcome.test', [
      { kind: 'tts', template: { text: EIGHT } },
      { kind: 'overlay', overlayPayload: { kind: 'viewer.enter', text: EIGHT } }
    ])
    const { dispatcher, spoken, shown } = makeDispatcher()
    const e = enterEvent()
    const ctx = buildTemplateContext(e)
    for (let i = 0; i < 300; i += 1) await dispatcher.dispatch(rule, e, ctx)
    check('派发 300 次，两个出口各 300 条', spoken.length === 300 && shown.length === 300)
    const mismatched = spoken.filter((s, i) => s !== shown[i])
    check('每一次 TTS 与 Overlay 都是同一句', mismatched.length === 0, `错配 ${mismatched.length} 次`)
    check('300 次里确实换过句子（没卡死在某一句）', new Set(spoken).size === 8, `出现 ${new Set(spoken).size} 种`)
  }
  {
    // 两个动作句数不一样时不能崩，也不能越界取到空
    const rule = makeRule('welcome.uneven', [
      { kind: 'tts', template: { text: EIGHT } },
      { kind: 'overlay', overlayPayload: { kind: 'viewer.enter', text: '甲\n乙' } }
    ])
    const { dispatcher, spoken, shown } = makeDispatcher()
    const e = enterEvent()
    for (let i = 0; i < 200; i += 1) await dispatcher.dispatch(rule, e, buildTemplateContext(e))
    check('句数不等时也不会取空', spoken.every((s) => s.length > 0) && shown.every((s) => s.length > 0))
    check(
      '句数不等时前四句配甲、后四句配乙',
      spoken.every((s, i) => (['一', '二', '三', '四'].includes(s) ? shown[i] === '甲' : shown[i] === '乙'))
    )
  }
  {
    // 老的单行配置：走 renderPick 之后行为必须一字不变
    const rule = makeRule('welcome.legacy', [
      { kind: 'log', template: { text: '{uname} 进入了直播间' } },
      { kind: 'tts', template: { text: '欢迎{uname}来到直播间' } },
      { kind: 'overlay', overlayPayload: { kind: 'viewer.enter', text: '欢迎 {uname}' } }
    ])
    const { dispatcher, spoken, shown, logged } = makeDispatcher()
    const e = enterEvent()
    for (let i = 0; i < 50; i += 1) await dispatcher.dispatch(rule, e, buildTemplateContext(e))
    check('老配置：TTS 一字不变', new Set(spoken).size === 1 && spoken[0] === '欢迎张三来到直播间')
    check('老配置：Overlay 一字不变', new Set(shown).size === 1 && shown[0] === '欢迎 张三')
    check('老配置：日志一字不变', new Set(logged).size === 1 && logged[0] === '张三 进入了直播间')
  }

  console.log('\nE. 默认欢迎语自检')
  {
    const welcome = defaultRules.find((r) => r.id === 'welcome.default')
    check('默认欢迎规则还在', Boolean(welcome))
    const tts = welcome?.actions.find((a) => a.kind === 'tts')?.template?.text ?? ''
    const overlayText = String(
      welcome?.actions.find((a) => a.kind === 'overlay')?.overlayPayload?.text ?? ''
    )
    const ttsLines = tts.split('\n').filter((l) => l.trim())
    const overlayLines = overlayText.split('\n').filter((l) => l.trim())
    check('默认欢迎不再只有一句', ttsLines.length >= 5, `${ttsLines.length} 句`)
    // 句数相同才能一一对应；否则第 n 句听到的和看到的会对不上号
    check('TTS 与 Overlay 句数相同', ttsLines.length === overlayLines.length, `${ttsLines.length} vs ${overlayLines.length}`)
    const ctx = buildTemplateContext(enterEvent())
    check('每一句对普通观众都渲染得出非空句子', ttsLines.every((l) => renderPick(l, ctx, 0).trim().length > 0))
    check('每一句都点到了观众的名字', ttsLines.every((l) => l.includes('{uname}')))
    const guardCtx = buildTemplateContext(enterEvent(viewer({ guardLevel: 3 })))
    check('对舰长也句句非空', ttsLines.every((l) => renderPick(l, guardCtx, 0).trim().length > 0))
    check(
      '日志仍然是单句事实记录，不参与玩梗',
      (welcome?.actions.find((a) => a.kind === 'log')?.template?.text ?? '').split('\n').length === 1
    )
  }

  console.log('\nF. 老配置升级：没改过的才动')
  {
    const legacy = (): Rule[] => [
      makeRule('welcome.default', [
        { kind: 'log', template: { text: '{uname} 进入了直播间' } },
        { kind: 'tts', template: { text: '欢迎{uname}来到直播间' } },
        { kind: 'overlay', overlayPayload: { kind: 'viewer.enter', text: '欢迎 {uname}' } }
      ]),
      makeRule('reply.hello', [{ kind: 'tts', template: { text: '{uname}你好呀' } }])
    ]

    const upgraded = upgradeUntouchedWelcome(legacy())
    check('原封不动的老默认欢迎会被升级', upgraded !== null)
    const newTts = upgraded?.[0].actions.find((a) => a.kind === 'tts')?.template?.text ?? ''
    check('升级后变成多句', newTts.split('\n').filter((l) => l.trim()).length >= 5)
    check('别的规则不受影响', upgraded?.[1].actions[0].template?.text === '{uname}你好呀')

    // 主播调过冷却和开关，升级只能换话术，不许把这些改回去
    const tuned = legacy()
    tuned[0] = { ...tuned[0], enabled: false, perUserCooldownSec: 60, name: '我的欢迎' }
    const tunedUp = upgradeUntouchedWelcome(tuned)
    check(
      '升级保留主播调过的开关 / 冷却 / 名字',
      tunedUp?.[0].enabled === false &&
        tunedUp?.[0].perUserCooldownSec === 60 &&
        tunedUp?.[0].name === '我的欢迎'
    )

    // 下面这些都必须一动不动
    const edited = legacy()
    edited[0].actions[1].template = { text: '欢迎{uname}进屋，随便坐' }
    check('主播改过 TTS 文案 → 不动', upgradeUntouchedWelcome(edited) === null)

    const editedOverlay = legacy()
    editedOverlay[0].actions[2].overlayPayload = { kind: 'viewer.enter', text: '{uname} 来了' }
    check('主播只改过 Overlay 文案 → 不动', upgradeUntouchedWelcome(editedOverlay) === null)

    const already = upgradeUntouchedWelcome(legacy()) as Rule[]
    check('升级过一次之后不会再动第二次（幂等）', upgradeUntouchedWelcome(already) === null)

    check('没有欢迎规则时安全返回', upgradeUntouchedWelcome([makeRule('other', [])]) === null)
    check('空规则表不崩', upgradeUntouchedWelcome([]) === null)

    // 删掉 TTS 动作的极端改法也不能误判成"没动过"
    const noTts = legacy()
    noTts[0] = { ...noTts[0], actions: noTts[0].actions.filter((a) => a.kind !== 'tts') }
    check('主播删掉了 TTS 动作 → 不动', upgradeUntouchedWelcome(noTts) === null)
  }

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.error(`${failures} check(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
