import type { StandardEvent } from '../platform/adapter'

// 把 StandardEvent 拍平成模板可用的 key→string 表
export function buildTemplateContext(e: StandardEvent): Record<string, string> {
  const base: Record<string, string> = {
    uname: e.user.uname,
    uid: e.user.uid,
    guardLevel: String(e.user.guardLevel ?? 0),
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
        guardLevel: String(e.payload.guardLevel)
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
