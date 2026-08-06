// 弹幕点歌台。主进程 / 控制台 / OBS overlay 三端共用，所以放 shared。
//
// 观众发「点歌 晴天」→ 进队列 → 主播在控制台按顺序唱 → OBS 上显示"正在唱 / 接下来"。
// LiveLink 不播放音乐（版权 + 音源问题），只做队列与展示，歌由主播自己放 / 自己唱。

export type SongScope = 'all' | 'guard' | 'medal'

/** OBS 点歌板贴在画面哪个角 */
export type SongBoardCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface SongRequestConfig {
  enabled: boolean
  /** 点歌触发词，弹幕必须以它开头 */
  keyword: string
  /** 撤销自己最后一次点歌的触发词 */
  cancelKeyword: string
  /** 队列最多排多少首（不含正在唱的那首） */
  maxQueueSize: number
  /** 同一个人同时最多能排几首 */
  maxPerUser: number
  /** 同一个人两次点歌的最小间隔 */
  perUserCooldownSec: number
  /** 谁能点歌 */
  scope: SongScope
  minMedalLevel: number
  requireAnchorMedal: boolean
  /** 点一首要花多少哈松币，0 = 免费。主播删歌 / 观众撤销会原路退回 */
  cost: number
  /** 歌名最长多少字 */
  maxTitleLength: number
  /** 歌名命中任意一条就拒绝 */
  blockKeywords: string[]
  /** 有人点歌时 TTS 念一句 */
  speakOnRequest: boolean
  /** 在 OBS 上显示点歌板 */
  showBoard: boolean
  /** 点歌板上最多列几首待唱 */
  boardLimit: number
  boardCorner: SongBoardCorner
}

export const DEFAULT_SONG_REQUEST_CONFIG: SongRequestConfig = {
  enabled: false,
  keyword: '点歌',
  cancelKeyword: '取消点歌',
  maxQueueSize: 20,
  maxPerUser: 2,
  perUserCooldownSec: 30,
  scope: 'all',
  minMedalLevel: 1,
  requireAnchorMedal: true,
  cost: 0,
  maxTitleLength: 24,
  blockKeywords: [],
  speakOnRequest: true,
  showBoard: true,
  boardLimit: 5,
  boardCorner: 'top-right'
}

export interface SongItem {
  id: string
  /** 净化后的歌名，就是显示和播报用的那个 */
  title: string
  uid: string
  uname: string
  requestedAt: number
  /** 实际扣掉的哈松币；删歌 / 撤销时按这个数原路退回 */
  cost: number
  /** danmu = 观众点的，host = 主播自己加的（不扣费、不受门槛限制） */
  source: 'danmu' | 'host'
}

export interface SongQueueState {
  /** 是否还在接单。关掉后已排的照唱，新的点不进来 */
  open: boolean
  current: SongItem | null
  queue: SongItem[]
  /** 已唱完的，最近若干首 */
  history: SongItem[]
}

/** 点歌被拒的原因，控制台把它翻成人话写进日志 */
export type SongRejectReason =
  | 'disabled'
  | 'closed'
  | 'scope'
  | 'blocked'
  | 'empty-title'
  | 'queue-full'
  | 'user-limit'
  | 'cooldown'
  | 'duplicate'
  | 'no-balance'
  | 'no-room'

export const EMPTY_SONG_QUEUE: SongQueueState = {
  open: true,
  current: null,
  queue: [],
  history: []
}

const SCOPES: SongScope[] = ['all', 'guard', 'medal']
const CORNERS: SongBoardCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export function sanitizeSongRequestConfig(
  config: Partial<SongRequestConfig> | undefined | null
): SongRequestConfig {
  const base = { ...DEFAULT_SONG_REQUEST_CONFIG, ...(config ?? {}) }
  const keyword = String(base.keyword ?? '').trim().slice(0, 12)
  const cancelKeyword = String(base.cancelKeyword ?? '').trim().slice(0, 12)
  return {
    enabled: Boolean(base.enabled),
    // 触发词为空会让每一条弹幕都变成点歌，必须挡住
    keyword: keyword || DEFAULT_SONG_REQUEST_CONFIG.keyword,
    cancelKeyword: cancelKeyword || DEFAULT_SONG_REQUEST_CONFIG.cancelKeyword,
    maxQueueSize: clampInt(base.maxQueueSize, 1, 100),
    maxPerUser: clampInt(base.maxPerUser, 1, 20),
    perUserCooldownSec: clampInt(base.perUserCooldownSec, 0, 3600),
    scope: SCOPES.includes(base.scope) ? base.scope : 'all',
    minMedalLevel: clampInt(base.minMedalLevel, 0, 40),
    requireAnchorMedal: Boolean(base.requireAnchorMedal),
    cost: clampInt(base.cost, 0, 1_000_000),
    maxTitleLength: clampInt(base.maxTitleLength, 4, 60),
    blockKeywords: cleanList(base.blockKeywords),
    speakOnRequest: Boolean(base.speakOnRequest),
    showBoard: Boolean(base.showBoard),
    boardLimit: clampInt(base.boardLimit, 1, 12),
    boardCorner: CORNERS.includes(base.boardCorner) ? base.boardCorner : 'top-right'
  }
}

/**
 * 从弹幕里取歌名。要求以触发词开头——否则"我想点歌了"这种闲聊也会被当成点歌。
 * 触发词后面跟不跟空格都认（点歌晴天 / 点歌 晴天）。
 * 返回 null 表示这条不是点歌。
 */
export function parseSongCommand(content: string, keyword: string): string | null {
  const text = (content ?? '').trim()
  if (!text || !keyword) return null
  if (!text.startsWith(keyword)) return null
  return text.slice(keyword.length).trim()
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const raw of value) {
    const s = String(raw ?? '').trim().slice(0, 30)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= 30) break
  }
  return out
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}
