import type { StandardEvent } from '../platform/adapter'

// 大航海等级 → 中文称呼。0 / undefined 一律返回空串：
// 模板里写「{guardName}{uname}来了」，普通观众渲染成"张三来了"，舰长渲染成
// "舰长张三来了"——一句模板同时照顾两种身份，主播不用为此多写一条规则。
export function guardName(level: number | undefined): string {
  if (level === 1) return '总督'
  if (level === 2) return '提督'
  if (level === 3) return '舰长'
  return ''
}

// 把 StandardEvent 拍平成模板可用的 key→string 表
export function buildTemplateContext(e: StandardEvent): Record<string, string> {
  const medal = e.user.fansMedal
  const base: Record<string, string> = {
    uname: e.user.uname,
    uid: e.user.uid,
    guardLevel: String(e.user.guardLevel ?? 0),
    guardName: guardName(e.user.guardLevel),
    // 进房事件常常不带粉丝牌（B 站协议层 caveat，见 adapter.UserInfo），
    // 这时 medalLevel=0、medalName 为空串，模板照样渲染得出通顺的句子
    medalLevel: String(medal?.level ?? 0),
    medalName: medal?.name ?? '',
    platform: e.platform
  }
  switch (e.kind) {
    case 'danmu.received':
      return { ...base, content: e.payload.content }
    case 'gift.received':
      return {
        ...base,
        giftName: e.payload.giftName,
        giftId: String(e.payload.giftId),
        num: String(e.payload.num),
        price: String(e.payload.price),
        coinType: e.payload.coinType
      }
    case 'super.chat':
      return {
        ...base,
        message: e.payload.message,
        content: e.payload.message,
        price: String(e.payload.price),
        durationSec: String(e.payload.durationSec)
      }
    case 'guard.bought':
      return {
        ...base,
        giftName: e.payload.giftName,
        price: String(e.payload.price),
        guardLevel: String(e.payload.guardLevel),
        guardName: guardName(e.payload.guardLevel)
      }
    case 'blindbox.opened':
      return {
        ...base,
        blindBoxName: e.payload.blindBoxName,
        rewardName: e.payload.rewardGiftName,
        cost: String(e.payload.costPerBox.toFixed(2)),
        reward: String((e.payload.rewardPricePerItem * e.payload.rewardNum).toFixed(2)),
        gain: String(e.payload.netGainPerBox.toFixed(2)),
        num: String(e.payload.rewardNum)
      }
    case 'viewer.enter':
    case 'follow.received':
    default:
      return base
  }
}

export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => ctx[key] ?? '')
}

// 一条模板里可以写多句，一行一句，每次事件随机挑一句说 —— 欢迎语只有一句时，
// 观众看三次就知道那是台机器；有十句轮着来，才像屋里坐着个活人。
//
// roll 是这次派发的随机数（0~1），由 dispatcher 统一生成后传给同一条规则的所有动作。
// 必须共用：TTS 念的和 OBS 上显示的得是对应的那一句，各挑各的会出现
// "耳朵里听到 A、画面上写着 B"。两个动作行数不一样时按比例取，也不会错位到离谱。
export function pickLine(text: string, roll: number): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return ''
  if (lines.length === 1) return lines[0]
  const r = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0
  return lines[Math.floor(r * lines.length)]
}

// 先挑句、再填占位符。单行模板的行为和以前完全一致，老配置不用迁移。
export function renderPick(text: string, ctx: Record<string, string>, roll: number): string {
  return renderTemplate(pickLine(text, roll), ctx)
}
