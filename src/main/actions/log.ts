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
}
