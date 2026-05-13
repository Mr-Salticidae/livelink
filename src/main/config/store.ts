import { safeStorage } from 'electron'
import Store from 'electron-store'
import { defaultRules } from '../rules/defaults'
import type { Rule } from '../rules/types'
import { DEFAULT_TTS_CONFIG, VALID_VOICE_VALUES, type TTSConfig } from '../actions/tts'

// B 站登录态。SESSDATA 是 cookie，2023 年 7 月起 B 站对游客限制 DANMU_MSG 推送，需要登录态。
// 仅本地存储，不上传。sessdata 用 Electron safeStorage 加密（Win 上走 DPAPI，与当前用户账号绑定），
// 文件复制到别的电脑解不开 → 防止 cookie 共享/泄露。uid / buvid 不算敏感，明文保存。
export interface BilibiliAuth {
  sessdata: string
  uid: string
  buvid: string // buvid3，可选
}

// 互动投票上次使用参数
export interface VotingPreset {
  title: string
  options: { key: string; label: string }[]
  durationSec: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
  allowChangeVote: boolean
}

// 弹幕抽奖的上次使用参数，主播下次开新一轮时回填表单
export interface LotteryPreset {
  prize: string
  keyword: string
  winnerCount: number
  durationSec: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}

// OBS 弹幕信息板（给观众看的直播屏 overlay，区别于主播自己看的弹幕悬浮窗）
export type DanmuBoardPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export interface DanmuBoardConfig {
  enabled: boolean
  position: DanmuBoardPosition
  maxLines: number // 同时显示条数上限 5-30
  fontSize: number // 字号 12-24 px
  showGift: boolean // 礼物事件是否也进面板（默认 true）
}

// 弹幕悬浮窗（主播全屏游戏时瞟弹幕用）
export interface DanmuOverlayConfig {
  enabled: boolean // 启动时是否自动打开（持久化记忆）
  pinned: boolean // 是否钉住：不可拖动 + 不抢焦点（游戏窗口里鼠标点穿不被偷走）
  bounds: { x: number; y: number; width: number; height: number } | null
  opacity: number // 背景不透明度 0-1
  fontSize: number // 字号 px
}

export interface AppConfigSchema {
  room: { id: string }
  rules: Rule[]
  tts: TTSConfig
  overlay: { port: number }
  platform: { active: 'bilibili' }
  auth: { bilibili: BilibiliAuth }
  danmuOverlay: DanmuOverlayConfig
  danmuBoard: DanmuBoardConfig
  lottery: LotteryPreset
  voting: VotingPreset
}

const DEFAULT_DANMU_OVERLAY: DanmuOverlayConfig = {
  enabled: false,
  pinned: false,
  bounds: null,
  opacity: 0.85,
  fontSize: 14
}

const DEFAULT_DANMU_BOARD: DanmuBoardConfig = {
  enabled: false, // 默认关闭，避免新装用户直播屏意外多出弹幕板
  position: 'bottom-left',
  maxLines: 10,
  fontSize: 16,
  showGift: true
}

const DEFAULT_LOTTERY_PRESET: LotteryPreset = {
  prize: '神秘奖品',
  keyword: '抽奖',
  winnerCount: 1,
  durationSec: 60,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0
}

const DEFAULT_VOTING_PRESET: VotingPreset = {
  title: '晚饭吃什么？',
  options: [
    { key: '1', label: '米饭' },
    { key: '2', label: '面条' }
  ],
  durationSec: 60,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0,
  allowChangeVote: true
}

const defaults: AppConfigSchema = {
  room: { id: '' },
  rules: defaultRules,
  tts: { ...DEFAULT_TTS_CONFIG },
  overlay: { port: 38501 },
  platform: { active: 'bilibili' },
  auth: { bilibili: { sessdata: '', uid: '', buvid: '' } },
  danmuOverlay: { ...DEFAULT_DANMU_OVERLAY },
  danmuBoard: { ...DEFAULT_DANMU_BOARD },
  lottery: { ...DEFAULT_LOTTERY_PRESET },
  voting: { ...DEFAULT_VOTING_PRESET }
}

export class AppConfig {
  private store: Store<AppConfigSchema>

  constructor() {
    this.store = new Store<AppConfigSchema>({
      name: 'livelink-config',
      defaults,
      clearInvalidConfig: true
    })
  }

  // room
  getRoom(): { id: string } {
    return this.store.get('room')
  }
  setRoomId(id: string): void {
    this.store.set('room', { id })
  }

  // rules
  getRules(): Rule[] {
    return this.store.get('rules')
  }
  setRules(rules: Rule[]): void {
    this.store.set('rules', rules)
  }
  upsertRule(rule: Rule): Rule[] {
    const list = [...this.getRules()]
    const idx = list.findIndex((r) => r.id === rule.id)
    if (idx >= 0) list[idx] = rule
    else list.push(rule)
    this.setRules(list)
    return list
  }
  removeRule(id: string): Rule[] {
    const list = this.getRules().filter((r) => r.id !== id)
    this.setRules(list)
    return list
  }

  // tts
  getTts(): TTSConfig {
    // 兼容老配置：旧版本无 perEventVoice 字段
    const stored = this.store.get('tts')
    let dirty = false
    if (!stored.perEventVoice) {
      stored.perEventVoice = {}
      dirty = true
    }
    // 校验 voice：老配置可能存了 0.5.3 之前的无效 voice (晓梦 / 晓双 / 晓萱)，
    // 这些 voice 现在会抛 NoAudioReceived "No audio was received."。无效回退到默认晓晓
    if (!VALID_VOICE_VALUES.has(stored.voice)) {
      console.warn(`[AppConfig] tts.voice "${stored.voice}" 已下线，回退到默认晓晓`)
      stored.voice = DEFAULT_TTS_CONFIG.voice
      dirty = true
    }
    // perEventVoice 里的无效 voice 直接删除（让该事件回退到全局）
    for (const k of Object.keys(stored.perEventVoice)) {
      const v = stored.perEventVoice[k as keyof typeof stored.perEventVoice]
      if (v && !VALID_VOICE_VALUES.has(v)) {
        console.warn(`[AppConfig] tts.perEventVoice.${k} "${v}" 已下线，清除`)
        delete stored.perEventVoice[k as keyof typeof stored.perEventVoice]
        dirty = true
      }
    }
    // 校正过的配置回写一次，下次启动不再 warn
    if (dirty) this.store.set('tts', stored)
    return stored
  }
  setTts(tts: TTSConfig): void {
    this.store.set('tts', tts)
  }
  patchTts(patch: Partial<TTSConfig>): TTSConfig {
    const next: TTSConfig = { ...this.getTts(), ...patch }
    this.setTts(next)
    return next
  }

  // overlay
  getOverlayPort(): number {
    return this.store.get('overlay').port
  }
  setOverlayPort(port: number): void {
    this.store.set('overlay', { port })
  }

  // bilibili auth
  getBilibiliAuth(): BilibiliAuth {
    // electron-store 在升级老配置时可能读到 undefined（新增 key），用 defaults 兜底
    const stored = this.store.get('auth')?.bilibili ?? { sessdata: '', uid: '', buvid: '' }
    return {
      sessdata: decryptSessdata(stored.sessdata),
      uid: stored.uid,
      buvid: stored.buvid
    }
  }
  setBilibiliAuth(auth: BilibiliAuth): void {
    this.store.set('auth', {
      bilibili: {
        sessdata: encryptSessdata(auth.sessdata),
        uid: auth.uid,
        buvid: auth.buvid
      }
    })
  }
  patchBilibiliAuth(patch: Partial<BilibiliAuth>): BilibiliAuth {
    const next: BilibiliAuth = { ...this.getBilibiliAuth(), ...patch }
    this.setBilibiliAuth(next)
    return next
  }

  // 弹幕悬浮窗
  getDanmuOverlay(): DanmuOverlayConfig {
    // electron-store 在老配置升级时 key 可能为 undefined，用 defaults 兜底
    const stored = this.store.get('danmuOverlay') as DanmuOverlayConfig | undefined
    if (!stored) return { ...DEFAULT_DANMU_OVERLAY }
    return {
      enabled: stored.enabled ?? false,
      pinned: stored.pinned ?? false,
      bounds: stored.bounds ?? null,
      opacity: typeof stored.opacity === 'number' ? stored.opacity : DEFAULT_DANMU_OVERLAY.opacity,
      fontSize:
        typeof stored.fontSize === 'number' ? stored.fontSize : DEFAULT_DANMU_OVERLAY.fontSize
    }
  }
  setDanmuOverlay(cfg: DanmuOverlayConfig): void {
    this.store.set('danmuOverlay', cfg)
  }
  patchDanmuOverlay(patch: Partial<DanmuOverlayConfig>): DanmuOverlayConfig {
    const next: DanmuOverlayConfig = { ...this.getDanmuOverlay(), ...patch }
    this.setDanmuOverlay(next)
    return next
  }

  // OBS 弹幕信息板
  getDanmuBoard(): DanmuBoardConfig {
    const stored = this.store.get('danmuBoard') as DanmuBoardConfig | undefined
    if (!stored) return { ...DEFAULT_DANMU_BOARD }
    return {
      enabled: stored.enabled ?? DEFAULT_DANMU_BOARD.enabled,
      position: stored.position ?? DEFAULT_DANMU_BOARD.position,
      maxLines: typeof stored.maxLines === 'number' ? stored.maxLines : DEFAULT_DANMU_BOARD.maxLines,
      fontSize: typeof stored.fontSize === 'number' ? stored.fontSize : DEFAULT_DANMU_BOARD.fontSize,
      showGift: stored.showGift ?? DEFAULT_DANMU_BOARD.showGift
    }
  }
  setDanmuBoard(cfg: DanmuBoardConfig): void {
    this.store.set('danmuBoard', cfg)
  }
  patchDanmuBoard(patch: Partial<DanmuBoardConfig>): DanmuBoardConfig {
    const next: DanmuBoardConfig = { ...this.getDanmuBoard(), ...patch }
    this.setDanmuBoard(next)
    return next
  }

  // 互动投票 preset
  getVotingPreset(): VotingPreset {
    const stored = this.store.get('voting') as VotingPreset | undefined
    if (!stored) return { ...DEFAULT_VOTING_PRESET, options: [...DEFAULT_VOTING_PRESET.options] }
    return {
      title: stored.title ?? DEFAULT_VOTING_PRESET.title,
      options: Array.isArray(stored.options) && stored.options.length > 0
        ? stored.options.map((o) => ({ key: o.key, label: o.label }))
        : [...DEFAULT_VOTING_PRESET.options],
      durationSec: stored.durationSec ?? DEFAULT_VOTING_PRESET.durationSec,
      requireAnchorFansMedal:
        stored.requireAnchorFansMedal ?? DEFAULT_VOTING_PRESET.requireAnchorFansMedal,
      minFansMedalLevel: stored.minFansMedalLevel ?? DEFAULT_VOTING_PRESET.minFansMedalLevel,
      allowChangeVote: stored.allowChangeVote ?? DEFAULT_VOTING_PRESET.allowChangeVote
    }
  }
  setVotingPreset(preset: VotingPreset): void {
    this.store.set('voting', preset)
  }

  // 弹幕抽奖 preset
  getLotteryPreset(): LotteryPreset {
    const stored = this.store.get('lottery') as LotteryPreset | undefined
    if (!stored) return { ...DEFAULT_LOTTERY_PRESET }
    return {
      prize: stored.prize ?? DEFAULT_LOTTERY_PRESET.prize,
      keyword: stored.keyword ?? DEFAULT_LOTTERY_PRESET.keyword,
      winnerCount: stored.winnerCount ?? DEFAULT_LOTTERY_PRESET.winnerCount,
      durationSec: stored.durationSec ?? DEFAULT_LOTTERY_PRESET.durationSec,
      requireAnchorFansMedal:
        stored.requireAnchorFansMedal ?? DEFAULT_LOTTERY_PRESET.requireAnchorFansMedal,
      minFansMedalLevel: stored.minFansMedalLevel ?? DEFAULT_LOTTERY_PRESET.minFansMedalLevel
    }
  }
  setLotteryPreset(preset: LotteryPreset): void {
    this.store.set('lottery', preset)
  }
}

// SESSDATA 加密包装。safeStorage 仅在 app.whenReady 之后可用——这里 get/set 调用时机
// 都在 IPC handler 里（早于一切 IPC，app 已 ready），安全。
//
// 三种存储格式：
//   "enc:<base64>"  — safeStorage 加密成功的密文（新版默认）
//   "plain:<raw>"   — 写入时机器不支持加密（虚拟机 / 没登录 Win 账号）的明文 fallback
//   "<raw>"         — 老版本配置（patch3 及更早）的裸明文。第一次 set 后会被覆盖为 enc:
function encryptSessdata(plain: string): string {
  if (!plain) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    return `plain:${plain}`
  }
  const buf = safeStorage.encryptString(plain)
  return `enc:${buf.toString('base64')}`
}

function decryptSessdata(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) return stored.slice('plain:'.length)
  if (stored.startsWith('enc:')) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[AppConfig] sessdata is encrypted but safeStorage unavailable; returning empty')
      return ''
    }
    try {
      const buf = Buffer.from(stored.slice('enc:'.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch (err) {
      console.error('[AppConfig] sessdata decrypt failed', err)
      return ''
    }
  }
  return stored
}
