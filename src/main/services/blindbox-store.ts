// BlindboxStore —— 持久化每个观众在每个直播间的盲盒投喂记录
//
// 设计：
// - 独立 electron-store 文件 blindbox-records.json，不污染主配置
// - 按 roomId 隔离（朋友们用不同直播间，记录不互相污染）
// - 每用户保留累计 + 最近 50 条详细记录
//
// 用法：
//   const store = new BlindboxStore()
//   store.record(roomId, blindboxOpenedEvent)  // bus 订阅里调
//   store.get(roomId, uid)                      // query_blindbox 规则里调

import Store from 'electron-store'
import type { StandardEvent } from '../platform/adapter'

export interface BlindBoxRecordEntry {
  ts: number // 开盒时间
  blindBoxName: string
  cost: number // 单次花费 RMB
  reward: number // 中奖礼物总价 RMB（price × num）
  gain: number // 净盈亏 RMB
  rewardName: string
  rewardNum: number
}

export interface BlindBoxUserRecord {
  uname: string
  firstOpenAt: number
  lastOpenAt: number
  totalCost: number
  totalReward: number
  totalOpenCount: number
  records: BlindBoxRecordEntry[]
}

interface BlindBoxStoreSchema {
  // roomId(string) → uid(string) → BlindBoxUserRecord
  records: Record<string, Record<string, BlindBoxUserRecord>>
}

const MAX_RECENT_RECORDS = 50

export class BlindboxStore {
  private store: Store<BlindBoxStoreSchema>

  constructor() {
    this.store = new Store<BlindBoxStoreSchema>({
      name: 'blindbox-records',
      defaults: { records: {} },
      clearInvalidConfig: true
    })
  }

  /** 把一条 blindbox.opened 事件累加到对应房间 / 用户 */
  record(roomId: number | string, event: StandardEvent): void {
    if (event.kind !== 'blindbox.opened') return
    const rid = String(roomId)
    const uid = event.user.uid
    if (!uid) return

    const all = this.store.get('records')
    const room = all[rid] ?? {}
    const cur = room[uid] ?? {
      uname: event.user.uname,
      firstOpenAt: event.timestamp,
      lastOpenAt: event.timestamp,
      totalCost: 0,
      totalReward: 0,
      totalOpenCount: 0,
      records: []
    }

    const rewardTotal = event.payload.rewardPricePerItem * event.payload.rewardNum
    const newEntry: BlindBoxRecordEntry = {
      ts: event.timestamp,
      blindBoxName: event.payload.blindBoxName,
      cost: event.payload.costPerBox,
      reward: rewardTotal,
      gain: event.payload.netGainPerBox,
      rewardName: event.payload.rewardGiftName,
      rewardNum: event.payload.rewardNum
    }

    const next: BlindBoxUserRecord = {
      uname: event.user.uname || cur.uname,
      firstOpenAt: cur.firstOpenAt || event.timestamp,
      lastOpenAt: event.timestamp,
      totalCost: cur.totalCost + event.payload.costPerBox,
      totalReward: cur.totalReward + rewardTotal,
      totalOpenCount: cur.totalOpenCount + 1,
      records: [...cur.records, newEntry].slice(-MAX_RECENT_RECORDS)
    }

    room[uid] = next
    all[rid] = room
    this.store.set('records', all)
  }

  /** 查询某房间某用户的累计记录。没记录返回 null */
  get(roomId: number | string, uid: string): BlindBoxUserRecord | null {
    const rid = String(roomId)
    const room = this.store.get('records')[rid]
    if (!room) return null
    return room[uid] ?? null
  }

  /** 调试用：导出所有记录 */
  getAll(): BlindBoxStoreSchema['records'] {
    return this.store.get('records')
  }
}
