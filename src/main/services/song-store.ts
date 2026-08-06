// 点歌队列持久化。独立 songs.json，按 roomId 隔离。
//
// 为什么要落盘：一场直播里主播重启软件是常事（换设置、卡了、更新），
// 队列只存内存的话观众排的十几首全没了，还得让人重新点一遍。
// 观众点歌花掉的哈松币也已经扣了，丢队列等于白扣。

import Store from 'electron-store'
import { EMPTY_SONG_QUEUE, type SongItem, type SongQueueState } from '../../shared/song-request'

interface SongStoreSchema {
  // roomId(string) → 该房间的点歌队列
  rooms: Record<string, SongQueueState>
}

const HISTORY_LIMIT = 50

export class SongStore {
  private store: Store<SongStoreSchema>

  constructor() {
    this.store = new Store<SongStoreSchema>({
      name: 'songs',
      defaults: { rooms: {} },
      clearInvalidConfig: true
    })
  }

  get(roomId: number | string): SongQueueState {
    const raw = this.store.get('rooms')[String(roomId)]
    return normalize(raw)
  }

  set(roomId: number | string, state: SongQueueState): void {
    const all = this.store.get('rooms')
    all[String(roomId)] = {
      open: state.open,
      current: state.current,
      queue: [...state.queue],
      history: state.history.slice(0, HISTORY_LIMIT)
    }
    this.store.set('rooms', all)
  }

  clearRoom(roomId: number | string): void {
    const all = this.store.get('rooms')
    delete all[String(roomId)]
    this.store.set('rooms', all)
  }
}

/** 磁盘上的数据可能是旧版本 / 被手改坏的，读出来一律过一遍形状校验 */
function normalize(raw: unknown): SongQueueState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SONG_QUEUE, queue: [], history: [] }
  const r = raw as Partial<SongQueueState>
  return {
    open: typeof r.open === 'boolean' ? r.open : true,
    current: normalizeItem(r.current),
    queue: Array.isArray(r.queue) ? r.queue.map(normalizeItem).filter(isItem) : [],
    history: Array.isArray(r.history)
      ? r.history.map(normalizeItem).filter(isItem).slice(0, HISTORY_LIMIT)
      : []
  }
}

function normalizeItem(raw: unknown): SongItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SongItem>
  const title = String(r.title ?? '').trim()
  const id = String(r.id ?? '').trim()
  if (!title || !id) return null
  return {
    id,
    title,
    uid: String(r.uid ?? '0'),
    uname: String(r.uname ?? '观众'),
    requestedAt: Number.isFinite(r.requestedAt) ? Number(r.requestedAt) : Date.now(),
    cost: Number.isFinite(r.cost) ? Math.max(0, Number(r.cost)) : 0,
    source: r.source === 'host' ? 'host' : 'danmu'
  }
}

function isItem(item: SongItem | null): item is SongItem {
  return item !== null
}
