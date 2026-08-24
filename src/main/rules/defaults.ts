import type { Rule } from './types'

// 三套默认规则。MVP 阶段，关键词回复仅 TTS + 日志，不实际向 B 站发弹幕（涉及登录态）。
export const defaultRules: Rule[] = [
  {
    id: 'welcome.default',
    name: '默认欢迎',
    enabled: true,
    trigger: 'viewer.enter',
    match: { kind: 'always' },
    cooldownSec: 0,
    perUserCooldownSec: 600, // 同一人 10 分钟内只欢迎一次，避免反复进出刷屏
    // 欢迎语一行一句，每次随机挑一句说（见 rules/template.ts 的 pickLine）。
    // 只有一句的欢迎，观众看三次就知道那是台机器；轮着来才像屋里坐着个活人。
    // TTS 与 overlay 写成一一对应的八句：同一次进房，耳朵里听到第 n 句、
    // 画面上就显示第 n 句。想更皮、更玩梗，主播在"规则"页往里加行即可。
    actions: [
      { kind: 'log', template: { text: '{uname} 进入了直播间' } },
      {
        kind: 'tts',
        template: {
          text: [
            '欢迎{uname}',
            '{uname}来了',
            '哟，{uname}',
            '{guardName}{uname}到了',
            '{uname}，坐',
            '欢迎{uname}，随便看',
            '哎，{uname}来了',
            '{uname}，来得正好'
          ].join('\n')
        }
      },
      {
        kind: 'overlay',
        overlayPayload: {
          kind: 'viewer.enter',
          text: [
            '欢迎 {uname}',
            '{uname} 来了',
            '哟，{uname}',
            '{guardName}{uname} 到了',
            '{uname}，坐',
            '欢迎 {uname}，随便看',
            '哎，{uname} 来了',
            '{uname}，来得正好'
          ].join('\n')
        }
      }
    ]
  },
  {
    id: 'reply.hello',
    name: '问候关键词回复',
    enabled: true,
    trigger: 'danmu.received',
    match: { kind: 'keyword', keywords: ['你好', '哈喽', 'hi', 'hello'], mode: 'any' },
    cooldownSec: 10,
    perUserCooldownSec: 30,
    actions: [
      { kind: 'log', template: { text: '匹配问候：{uname} 说 {content}' } },
      { kind: 'tts', template: { text: '{uname}你好呀' } }
    ]
  },
  {
    id: 'gift.thanks.default',
    name: '默认礼物感谢',
    enabled: true,
    trigger: 'gift.received',
    match: { kind: 'always' },
    cooldownSec: 0,
    // perUserCooldownSec=0：每个礼物都进 TTS 队列。靠 TTSPlayer 队列上限 20 自然限流。
    // 真正的"窗口内合并累加"实现是 P1 任务（需要 engine 加聚合逻辑，工程量 1+ 小时）。
    perUserCooldownSec: 0,
    actions: [
      { kind: 'log', template: { text: '{uname} 送出 {giftName} x{num}' } },
      { kind: 'tts', template: { text: '感谢{uname}送出的{giftName}{num}个' } },
      { kind: 'overlay', overlayPayload: { kind: 'gift.received' } } // dispatcher 会把事件原始字段也带上
    ]
  },
  {
    id: 'super.chat.thanks.default',
    name: '默认 SC 感谢',
    enabled: true,
    trigger: 'super.chat',
    match: { kind: 'always' },
    cooldownSec: 0,
    perUserCooldownSec: 0,
    actions: [
      { kind: 'log', template: { text: '{uname} SC ¥{price}：{message}' } },
      { kind: 'tts', template: { text: '感谢{uname}的{price}元醒目留言' } }
      // overlay 横幅由系统级 broadcast 推送（main/index.ts 直接发），
      // 不在这里 overlay action，避免主播改规则时关掉横幅
    ]
  },
  {
    id: 'blindbox.query.default',
    name: '盲盒盈亏查询',
    enabled: true,
    trigger: 'danmu.received',
    match: { kind: 'keyword', keywords: ['查盲盒', '查盈亏', '我的盲盒'], mode: 'any' },
    cooldownSec: 5,
    perUserCooldownSec: 30,
    actions: [
      { kind: 'log', template: { text: '{uname} 查询盲盒记录' } },
      // query_blindbox 自己从 blindbox-store 读，没有则静默；有就推 overlay 卡片
      { kind: 'query_blindbox' }
    ]
  },
  {
    id: 'wallet.query.default',
    name: '查余额',
    enabled: true,
    trigger: 'danmu.received',
    match: { kind: 'keyword', keywords: ['查余额', '我的余额', '查货币', '我的哈松币'], mode: 'any' },
    cooldownSec: 3,
    perUserCooldownSec: 30,
    actions: [
      { kind: 'log', template: { text: '{uname} 查询货币余额' } },
      // query_wallet 自己从 wallet-store 读，无记录时也推一张"待开户"提示卡
      { kind: 'query_wallet' }
    ]
  }
]

// 1.8.x 那两句单句欢迎的原文。老配置里存的就是它们
const LEGACY_WELCOME_TTS = '欢迎{uname}来到直播间'
const LEGACY_WELCOME_OVERLAY = '欢迎 {uname}'

/**
 * 把"一个字都没动过"的默认欢迎升级成多句语料。
 *
 * defaults 只在首次初始化时写入，老用户配置里存着的还是那句单句欢迎 ——
 * 不管的话，新语料对已经在用的人等于不存在。
 *
 * 但只升级原封不动的那条：模板和 1.8.x 旧默认值完全一致才替换。主播自己改过
 * 一个字，就说明那是他要的话，谁也不许替他改回去。开关、冷却这些也原样保留。
 *
 * @returns 升级后的新数组；不需要升级时返回 null（调用方据此决定要不要写盘）
 */
export function upgradeUntouchedWelcome(rules: Rule[]): Rule[] | null {
  const idx = rules.findIndex((r) => r.id === 'welcome.default')
  if (idx < 0) return null

  const current = rules[idx]
  const tts = current.actions.find((a) => a.kind === 'tts')
  const overlay = current.actions.find((a) => a.kind === 'overlay')
  if ((tts?.template?.text ?? '') !== LEGACY_WELCOME_TTS) return null
  if (String(overlay?.overlayPayload?.text ?? '') !== LEGACY_WELCOME_OVERLAY) return null

  const fresh = defaultRules.find((r) => r.id === 'welcome.default')
  if (!fresh) return null

  const next = [...rules]
  // 只换话术：enabled / cooldownSec / perUserCooldownSec / name 全部保留主播现有的
  next[idx] = { ...current, actions: fresh.actions.map((a) => structuredClone(a)) }
  return next
}
