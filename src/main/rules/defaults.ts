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
  }
]
