// 哈松币钱包 —— 持久化每个观众在每个直播间的余额
//
// 设计：
// - 独立 electron-store 文件 wallet.json，不污染主配置
// - 按 roomId 隔离（不同主播朋友共用同一应用数据不混）
// - 复合 uid|uname dedupe key（参考 1.0.1 教训：B 站匿名观众 uid 可能相同）
// - 首次参与自动赠送 initialBalance（默认 1000）

import Store from 'electron-store'

export interface WalletEntry {
  uname: string
  balance: number
  totalBet: number // 累计押注金额
  totalWon: number // 累计赢得金额（含本金返还）
  lastActiveAt: number
}

interface WalletStoreSchema {
  // roomId(string) → bettorKey(uid|uname) → WalletEntry
  records: Record<string, Record<string, WalletEntry>>
}

export class WalletStore {
  private store: Store<WalletStoreSchema>

  constructor() {
    this.store = new Store<WalletStoreSchema>({
      name: 'wallet',
      defaults: { records: {} },
      clearInvalidConfig: true
    })
  }

  /** 复合 key dedupe：B 站匿名观众 uid 可能相同，加 uname 区分 */
  private static keyOf(uid: string, uname: string): string {
    return `${uid || '0'}|${uname || '观众'}`
  }

  /** 拿观众余额，没记录则首次开户赠送 initialBalance */
  getOrCreate(
    roomId: number | string,
    uid: string,
    uname: string,
    initialBalance: number
  ): WalletEntry {
    const rid = String(roomId)
    const k = WalletStore.keyOf(uid, uname)
    const all = this.store.get('records')
    const room = all[rid] ?? {}
    if (room[k]) {
      // uname 可能改了（极少见），更新
      if (room[k].uname !== uname && uname) {
        room[k].uname = uname
        all[rid] = room
        this.store.set('records', all)
      }
      return room[k]
    }
    const entry: WalletEntry = {
      uname: uname || '观众',
      balance: initialBalance,
      totalBet: 0,
      totalWon: 0,
      lastActiveAt: Date.now()
    }
    room[k] = entry
    all[rid] = room
    this.store.set('records', all)
    return entry
  }

  /** 扣余额（押注用）。返回实际扣除量（小于 amount 时已不够）*/
  deduct(
    roomId: number | string,
    uid: string,
    uname: string,
    amount: number,
    initialBalance: number
  ): number {
    const entry = this.getOrCreate(roomId, uid, uname, initialBalance)
    const actual = Math.min(amount, entry.balance)
    if (actual <= 0) return 0

    const rid = String(roomId)
    const k = WalletStore.keyOf(uid, uname)
    const all = this.store.get('records')
    const room = all[rid] ?? {}
    room[k] = {
      ...entry,
      balance: entry.balance - actual,
      totalBet: entry.totalBet + actual,
      lastActiveAt: Date.now()
    }
    all[rid] = room
    this.store.set('records', all)
    return actual
  }

  /** 加余额（结算 / 退款用） */
  credit(roomId: number | string, uid: string, uname: string, amount: number): void {
    if (amount <= 0) return
    const rid = String(roomId)
    const k = WalletStore.keyOf(uid, uname)
    const all = this.store.get('records')
    const room = all[rid] ?? {}
    const entry = room[k]
    if (!entry) return // 没记录就不操作（理论上 credit 前应该 deduct 过，记录必在）
    room[k] = {
      ...entry,
      balance: entry.balance + amount,
      totalWon: entry.totalWon + amount,
      lastActiveAt: Date.now()
    }
    all[rid] = room
    this.store.set('records', all)
  }

  /** 退还押注（取消游戏 / 改选项时用）。不计入 totalWon */
  refund(roomId: number | string, uid: string, uname: string, amount: number): void {
    if (amount <= 0) return
    const rid = String(roomId)
    const k = WalletStore.keyOf(uid, uname)
    const all = this.store.get('records')
    const room = all[rid] ?? {}
    const entry = room[k]
    if (!entry) return
    room[k] = {
      ...entry,
      balance: entry.balance + amount,
      totalBet: Math.max(0, entry.totalBet - amount), // 撤销 totalBet 累加
      lastActiveAt: Date.now()
    }
    all[rid] = room
    this.store.set('records', all)
  }

  /** 查询某观众余额 */
  query(roomId: number | string, uid: string, uname: string): WalletEntry | null {
    const rid = String(roomId)
    const k = WalletStore.keyOf(uid, uname)
    const room = this.store.get('records')[rid]
    if (!room) return null
    return room[k] ?? null
  }

  /** 列某直播间余额 top N（主播侧"看观众排名"用，未来加 UI） */
  topByBalance(roomId: number | string, limit: number = 10): WalletEntry[] {
    const room = this.store.get('records')[String(roomId)]
    if (!room) return []
    return Object.values(room)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit)
  }
}
