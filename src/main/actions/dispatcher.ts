import type { StandardEvent } from '../platform/adapter'
import type { Rule, ActionSpec } from '../rules/types'
import { renderTemplate } from '../rules/template'
import type { TTSPlayer } from './tts'
import type { OverlayBroadcaster } from './overlay'
import type { LogSink } from './log'
import type { BlindboxStore } from '../services/blindbox-store'

export interface DispatcherDeps {
  tts: TTSPlayer
  overlay: OverlayBroadcaster
  log: LogSink
  blindboxStore: BlindboxStore
  // 当前连接的房间号 getter（adapter.currentRoomId）
  getCurrentRoomId: () => number | null
}

export class ActionDispatcher {
  private tts: TTSPlayer
  private overlay: OverlayBroadcaster
  private log: LogSink
  private blindboxStore: BlindboxStore
  private getCurrentRoomId: () => number | null

  constructor(deps: DispatcherDeps) {
    this.tts = deps.tts
    this.overlay = deps.overlay
    this.log = deps.log
    this.blindboxStore = deps.blindboxStore
    this.getCurrentRoomId = deps.getCurrentRoomId
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
      // 传 eventKind 让 ttsPlayer 按事件类型查 perEventVoice 覆盖（多角色音色）
      this.tts.enqueue(text, { eventKind: event.kind })
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

    // 盲盒盈亏查询：触发者通常是发"查盲盒"弹幕的观众
    // 查 blindbox-store 里该 uid 在当前房间的累计记录，没有就静默；有就推 overlay 卡片
    if (spec.kind === 'query_blindbox') {
      const roomId = this.getCurrentRoomId()
      if (roomId == null) return
      const record = this.blindboxStore.get(roomId, event.user.uid)
      if (!record) return
      this.overlay.broadcast({
        kind: 'blindbox.card',
        event,
        extra: { record }
      })
      return
    }
  }
}
