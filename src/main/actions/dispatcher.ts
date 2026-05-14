import type { StandardEvent } from '../platform/adapter'
import type { Rule, ActionSpec } from '../rules/types'
import { renderTemplate } from '../rules/template'
import type { TTSPlayer } from './tts'
import type { OverlayBroadcaster } from './overlay'
import type { LogSink } from './log'
import type { BlindboxStore } from '../services/blindbox-store'
import type { WalletStore } from '../services/wallet-store'

export interface DispatcherDeps {
  tts: TTSPlayer
  overlay: OverlayBroadcaster
  log: LogSink
  blindboxStore: BlindboxStore
  wallet: WalletStore
  // 当前连接的房间号 getter（adapter.currentRoomId）
  getCurrentRoomId: () => number | null
  // query_wallet 用：货币名 + 新观众初始余额（首次查无记录时显示"待开户"信息）
  getCurrencyName: () => string
  getInitialBalance: () => number
}

export class ActionDispatcher {
  private tts: TTSPlayer
  private overlay: OverlayBroadcaster
  private log: LogSink
  private blindboxStore: BlindboxStore
  private wallet: WalletStore
  private getCurrentRoomId: () => number | null
  private getCurrencyName: () => string
  private getInitialBalance: () => number

  constructor(deps: DispatcherDeps) {
    this.tts = deps.tts
    this.overlay = deps.overlay
    this.log = deps.log
    this.blindboxStore = deps.blindboxStore
    this.wallet = deps.wallet
    this.getCurrentRoomId = deps.getCurrentRoomId
    this.getCurrencyName = deps.getCurrencyName
    this.getInitialBalance = deps.getInitialBalance
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

    // 货币余额查询：观众发"查余额"等关键词触发
    // 注意：query 不开户（避免污染数据）。无记录时推一张"待开户"卡，
    // 告诉观众参与一次（送礼 / 押竞猜）会自动赠送 initialBalance
    if (spec.kind === 'query_wallet') {
      const roomId = this.getCurrentRoomId()
      if (roomId == null) return
      const uname = event.user.uname || '观众'
      const currencyName = this.getCurrencyName()
      const initialBalance = this.getInitialBalance()
      const record = this.wallet.query(roomId, event.user.uid, uname)
      this.overlay.broadcast({
        kind: 'wallet.card',
        event,
        extra: {
          uname,
          currencyName,
          initialBalance,
          // record 为 null 时 overlay 显示"还没开户"提示
          record: record
            ? {
                balance: record.balance,
                totalBet: record.totalBet,
                totalWon: record.totalWon,
                totalDeposited: record.totalDeposited ?? 0
              }
            : null
        }
      })
      return
    }
  }
}
