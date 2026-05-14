// 礼物 → 哈松币 自动入金 service
//
// 订阅 bus 的 gift.received 事件，按配置：
//   amount = floor(price * num * rmbToCoinRate)
// 写入观众钱包余额，让付费用户自动拿到游戏货币。
//
// 与 GuessingService 分离：guessing 只管游戏内押注/结算，深度依赖 wallet；
// wallet-deposit 是单向流入，无状态机，常驻 app 生命周期。

import type { StandardEvent } from '../platform/adapter'
import type { Bus } from '../events/bus'
import type { WalletStore } from './wallet-store'
import type { GuessingGlobalConfig } from '../config/store'

export interface WalletDepositDeps {
  bus: Bus
  wallet: WalletStore
  getGuessingConfig: () => GuessingGlobalConfig
  getCurrentRoomId: () => number | null
}

export class WalletDepositService {
  private bus: Bus
  private wallet: WalletStore
  private getGuessingConfig: () => GuessingGlobalConfig
  private getCurrentRoomId: () => number | null
  private unsub: (() => void) | null = null

  constructor(deps: WalletDepositDeps) {
    this.bus = deps.bus
    this.wallet = deps.wallet
    this.getGuessingConfig = deps.getGuessingConfig
    this.getCurrentRoomId = deps.getCurrentRoomId
  }

  attach(): void {
    if (this.unsub) return
    const handler = (e: StandardEvent): void => this.onEvent(e)
    this.bus.on('event', handler)
    this.unsub = () => this.bus.off('event', handler)
  }

  dispose(): void {
    this.unsub?.()
    this.unsub = null
  }

  private onEvent(e: StandardEvent): void {
    if (e.kind !== 'gift.received') return
    const cfg = this.getGuessingConfig()
    if (!cfg.giftDeposit.enabled) return

    // 银瓜子礼物（辣条等免费/超低价小礼物）默认不入金，避免薅羊毛
    if (e.payload.coinType === 'silver' && !cfg.giftDeposit.includeSilver) return

    const roomId = this.getCurrentRoomId()
    if (roomId == null) return

    const totalRmb = e.payload.price * e.payload.num
    if (!Number.isFinite(totalRmb) || totalRmb <= 0) return

    const amount = Math.floor(totalRmb * cfg.giftDeposit.rmbToCoinRate)
    if (amount <= 0) return

    const uname = e.user.uname || '观众'
    if (!e.user.uid && !uname) return

    const result = this.wallet.deposit(
      roomId,
      e.user.uid,
      uname,
      amount,
      cfg.initialBalance
    )
    if (result) {
      console.log(
        `[WalletDeposit] ${uname} 送 ${e.payload.giftName} x${e.payload.num} ` +
          `(${totalRmb} RMB) → +${amount} ${cfg.currencyName} · 余额 ${result.balance}`
      )
    }
  }
}
