import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { ActionDispatcher } from '../actions/dispatcher'
import type { Rule, RuleMatch } from './types'
import { buildTemplateContext, renderTemplate } from './template'

export interface EngineDeps {
  bus: Bus
  dispatcher: ActionDispatcher
}

export class RuleEngine {
  private rules: Rule[] = []
  private bus: Bus
  private dispatcher: ActionDispatcher
  private detachFn: (() => void) | null = null

  // ruleId → lastFireAt(ms)
  private cooldownGlobal = new Map<string, number>()
  // `${ruleId}|${uid}` → lastFireAt(ms)
  private cooldownPerUser = new Map<string, number>()

  constructor(deps: EngineDeps) {
    this.bus = deps.bus
    this.dispatcher = deps.dispatcher
  }

  setRules(rules: Rule[]): void {
    this.rules = rules
  }

  upsertRule(rule: Rule): void {
    const idx = this.rules.findIndex((r) => r.id === rule.id)
    if (idx >= 0) this.rules[idx] = rule
    else this.rules.push(rule)
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id)
    // 清掉相关 cooldown，避免内存泄漏
    this.cooldownGlobal.delete(id)
    for (const k of [...this.cooldownPerUser.keys()]) {
      if (k.startsWith(`${id}|`)) this.cooldownPerUser.delete(k)
    }
  }

  listRules(): Rule[] {
    return [...this.rules]
  }

  attach(): void {
    if (this.detachFn) return
    const handler = (e: StandardEvent): void => this.handle(e)
    this.bus.on('event', handler)
    this.detachFn = () => this.bus.off('event', handler)
  }

  detach(): void {
    this.detachFn?.()
    this.detachFn = null
  }

  private handle(e: StandardEvent): void {
    const now = Date.now()
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      if (rule.trigger !== e.kind) continue
      if (!matches(rule.match, e)) continue

      // 全局冷却
      if (rule.cooldownSec > 0) {
        const last = this.cooldownGlobal.get(rule.id) ?? 0
        if (now - last < rule.cooldownSec * 1000) continue
      }
      // 单用户冷却
      if (rule.perUserCooldownSec > 0) {
        const key = `${rule.id}|${e.user.uid}`
        const last = this.cooldownPerUser.get(key) ?? 0
        if (now - last < rule.perUserCooldownSec * 1000) continue
      }

      // 通过冷却 → 记账 + 派发
      if (rule.cooldownSec > 0) this.cooldownGlobal.set(rule.id, now)
      if (rule.perUserCooldownSec > 0) this.cooldownPerUser.set(`${rule.id}|${e.user.uid}`, now)

      const ctx = buildTemplateContext(e)
      this.dispatcher.dispatch(rule, e, ctx).catch((err) => {
        console.error(`[RuleEngine] dispatch error for rule ${rule.id}`, err)
      })
    }
  }
}

function matches(spec: RuleMatch, e: StandardEvent): boolean {
  if (spec.kind === 'always') return true

  // 关键词 / 正则只对带文本的事件有意义
  const text = extractText(e)
  if (text == null) return false

  if (spec.kind === 'keyword') {
    if (spec.keywords.length === 0) return false
    if (spec.mode === 'all') return spec.keywords.every((k) => text.includes(k))
    return spec.keywords.some((k) => text.includes(k))
  }
  if (spec.kind === 'regex') {
    try {
      return new RegExp(spec.pattern).test(text)
    } catch {
      return false
    }
  }
  return false
}

function extractText(e: StandardEvent): string | null {
  if (e.kind === 'danmu.received') return e.payload.content
  if (e.kind === 'super.chat') return e.payload.message
  return null
}

export { renderTemplate }
