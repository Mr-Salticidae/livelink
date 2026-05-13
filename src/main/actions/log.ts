import type { StandardEvent } from '../platform/adapter'
import type { Rule } from '../rules/types'

export interface LogEntry {
  timestamp: number
  ruleId: string | null // null = 平台原生事件直推（不经规则）
  ruleName: string | null
  eventKind: StandardEvent['kind']
  uname: string | null
  text: string
}

export type LogSinkListener = (entry: LogEntry) => void

// 日志环形缓冲。控制台 UI 通过 IPC 拉取最近 N 条 + 订阅新增。
export class LogSink {
  private buffer: LogEntry[] = []
  private capacity: number
  private listeners = new Set<LogSinkListener>()

  constructor(capacity = 500) {
    this.capacity = capacity
  }

  write(entry: LogEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length > this.capacity) this.buffer.shift()
    for (const l of this.listeners) {
      try {
        l(entry)
      } catch (err) {
        console.error('[LogSink] listener threw', err)
      }
    }
  }

  recent(limit = this.capacity): LogEntry[] {
    return this.buffer.slice(-limit)
  }

  clear(): void {
    this.buffer = []
  }

  subscribe(cb: LogSinkListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // 便捷方法：直接从规则 / 事件 / 已渲染文本构造一条日志写入
  writeFromRule(rule: Rule, event: StandardEvent, renderedText: string): void {
    this.write({
      timestamp: event.timestamp || Date.now(),
      ruleId: rule.id,
      ruleName: rule.name,
      eventKind: event.kind,
      uname: event.user.uname,
      text: renderedText
    })
  }

  // 原始事件直接入日志（不经规则）。让 Logs 页反映直播间实际发生的所有事，
  // 而不是只显示规则命中的。规则的 LogAction 仍可叠加写更详细的"命中"日志。
  writeRawEvent(event: StandardEvent): void {
    // room.stats 高频（每几秒），不进日志免得刷屏淹掉真正的事件
    if (event.kind === 'room.stats') return
    this.write({
      timestamp: event.timestamp || Date.now(),
      ruleId: null,
      ruleName: null,
      eventKind: event.kind,
      uname: event.user.uname,
      text: formatRawEventText(event)
    })
  }
}

// 把 StandardEvent 渲染成日志页能看的文字
function formatRawEventText(e: StandardEvent): string {
  const uname = e.user.uname || '匿名'
  switch (e.kind) {
    case 'viewer.enter':
      return `${uname} 进入直播间`
    case 'danmu.received':
      return `${uname}: ${e.payload.content}`
    case 'gift.received':
      return `${uname} 送出 ${e.payload.giftName} × ${e.payload.num}`
    case 'follow.received':
      return `${uname} 关注了主播`
    case 'guard.bought': {
      const lvlText =
        e.payload.guardLevel === 1
          ? '总督'
          : e.payload.guardLevel === 2
            ? '提督'
            : e.payload.guardLevel === 3
              ? '舰长'
              : '上舰'
      return `${uname} 开通 ${lvlText} (¥${e.payload.price})`
    }
    case 'super.chat':
      return `${uname} SC (¥${e.payload.price}): ${e.payload.message}`
    case 'blindbox.opened': {
      const gainStr =
        e.payload.netGainPerBox >= 0
          ? `+¥${e.payload.netGainPerBox.toFixed(2)}`
          : `-¥${Math.abs(e.payload.netGainPerBox).toFixed(2)}`
      return `${uname} 开 ${e.payload.blindBoxName} → ${e.payload.rewardGiftName} ×${e.payload.rewardNum} (${gainStr})`
    }
    default:
      return uname
  }
}
