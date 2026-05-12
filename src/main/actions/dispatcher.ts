import type { StandardEvent } from '../platform/adapter'
import type { Rule, ActionSpec } from '../rules/types'
import { renderTemplate } from '../rules/template'
import type { TTSPlayer } from './tts'
import type { OverlayBroadcaster } from './overlay'
import type { LogSink } from './log'

export interface DispatcherDeps {
  tts: TTSPlayer
  overlay: OverlayBroadcaster
  log: LogSink
}

export class ActionDispatcher {
  private tts: TTSPlayer
  private overlay: OverlayBroadcaster
  private log: LogSink

  constructor(deps: DispatcherDeps) {
    this.tts = deps.tts
    this.overlay = deps.overlay
    this.log = deps.log
  }

  async dispatch(rule: Rule, event: StandardEvent, ctx: Record<string, string>): Promise<void> {
    for (const spec of rule.actions) {
      try {
        await this.runAction(spec, rule, event, ctx)
      } catch (err) {
        console.error(`[Dispatcher] action ${spec.kind} failed for rule ${rule.id}`, err)
      }
    }
  }

  private async runAction(
    spec: ActionSpec,
    rule: Rule,
    event: StandardEvent,
    ctx: Record<string, string>
  ): Promise<void> {
    if (spec.kind === 'log') {
      const text = spec.template ? renderTemplate(spec.template.text, ctx) : `${rule.name}`
      this.log.writeFromRule(rule, event, text)
      return
    }

    if (spec.kind === 'tts') {
      const text = spec.template ? renderTemplate(spec.template.text, ctx) : ''
      this.tts.enqueue(text)
      return
    }

    if (spec.kind === 'overlay') {
      // overlayPayload 里的字符串字段也允许带占位符（比如 {uname}）
      const renderedExtra: Record<string, unknown> = {}
      if (spec.overlayPayload) {
        for (const [k, v] of Object.entries(spec.overlayPayload)) {
          renderedExtra[k] = typeof v === 'string' ? renderTemplate(v, ctx) : v
        }
      }
      const kind = (renderedExtra['kind'] as string | undefined) ?? event.kind
      const text = renderedExtra['text'] as string | undefined
      this.overlay.broadcast({
        kind,
        text,
        event,
        extra: renderedExtra
      })
      return
    }
  }
}
