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
    actions: [
      { kind: 'log', template: { text: '{uname} 进入了直播间' } },
      { kind: 'tts', template: { text: '欢迎{uname}来到直播间' } },
      { kind: 'overlay', overlayPayload: { kind: 'viewer.enter', text: '欢迎 {uname}' } }
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
  }
]
