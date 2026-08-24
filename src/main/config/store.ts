import { safeStorage } from 'electron'
import Store from 'electron-store'
import { defaultRules, upgradeUntouchedWelcome } from '../rules/defaults'
import type { Rule } from '../rules/types'
import { DEFAULT_TTS_CONFIG, VALID_VOICE_VALUES, type TTSConfig } from '../actions/tts'
import { DEFAULT_PET_CONFIG, clampPetConfig, type PetConfig } from '../../shared/pets'
import {
  DEFAULT_AI_REPLY_CONFIG,
  mergeAiReplyPatch,
  sanitizeAiReplyConfig,
  type AiReplyConfig,
  type AiReplyPublicConfig,
  toPublicAiReplyConfig
} from '../../shared/ai-reply'
import {
  DEFAULT_OVERLAY_THEME,
  normalizeOverlayThemeId,
  type OverlayThemeConfig
} from '../../shared/overlay-theme'
import {
  DEFAULT_DANMU_READER_CONFIG,
  sanitizeDanmuReaderConfig,
  type DanmuReaderConfig
} from '../../shared/danmu-reader'
import {
  DEFAULT_SONG_REQUEST_CONFIG,
  sanitizeSongRequestConfig,
  type SongRequestConfig
} from '../../shared/song-request'
import {
  DEFAULT_DANMU_BOARD_CONFIG,
  DEFAULT_DANMU_OVERLAY_SETTINGS,
  normalizeDanmuBoardConfig,
  normalizeDanmuOverlaySettings,
  type DanmuBoardConfig,
  type DanmuBoardPosition,
  type DanmuOverlaySettings
} from '../../shared/danmu-display'

export type {
  DanmuBoardConfig,
  DanmuBoardPosition,
  DanmuOverlaySettings
} from '../../shared/danmu-display'

// B 站登录态。SESSDATA 是 cookie，2023 年 7 月起 B 站对游客限制 DANMU_MSG 推送，需要登录态。
// 仅本地存储，不上传。sessdata 用 Electron safeStorage 加密（Win 上走 DPAPI，与当前用户账号绑定），
// 文件复制到别的电脑解不开 → 防止 cookie 共享/泄露。uid / buvid 不算敏感，明文保存。
export interface BilibiliAuth {
  sessdata: string
  uid: string
  buvid: string // buvid3，可选
}

// 竞猜（猜结果押哈松币）
export interface GuessingOption {
  key: string
  label: string
}
export interface GuessingPreset {
  id: string // 唯一标识（创建时间戳 / uuid）
  name: string // 主播看的 preset 显示名（"出大红地点" / "谁收益最高"）
  title: string // 启动后 Overlay 顶部大字标题
  options: GuessingOption[]
  enrollSec: number
  defaultBet: number
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
}
// 礼物 → 哈松币 自动兑换。打通"氪金 → 玩游戏"闭环：观众送礼自动入金，
// 余额可拿去押竞猜 / 未来赛马等玩法
export interface GiftDepositConfig {
  enabled: boolean // 总开关
  rmbToCoinRate: number // 1 元 礼物价 = 多少哈松币（默认 100）
  includeSilver: boolean // 银瓜子礼物（辣条等免费小礼物）是否换币（默认 false）
}

export interface GuessingGlobalConfig {
  currencyName: string // "哈松币" 主播可改
  initialBalance: number // 首次参与赠送
  giftDeposit: GiftDepositConfig
  presets: GuessingPreset[]
}

// 赛马 preset
export interface HorseRacePreset {
  horses: { key: string; name: string; emoji: string }[]
  enrollSec: number
  raceSec: number
  defaultBet: number // 1.3+：弹幕只发马号不带金额时的默认押注（哈松币）
  requireAnchorFansMedal: boolean
  minFansMedalLevel: number
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

// 老配置 (0.6.x 之前) 是 4 角字符串，迁移到 { x, y } 百分比
const LEGACY_POSITION_MAP: Record<string, DanmuBoardPosition> = {
  'top-left': { x: 2, y: 2 },
  'top-right': { x: 80, y: 2 },
  'bottom-left': { x: 2, y: 76 },
  'bottom-right': { x: 80, y: 76 }
}

// 弹幕悬浮窗（主播全屏游戏时瞟弹幕用）。外观字段统一来自 shared/danmu-display。
export interface DanmuOverlayConfig extends DanmuOverlaySettings {
  enabled: boolean // 启动时是否自动打开（持久化记忆）
  pinned: boolean // 是否钉住：不可拖动 + 不抢焦点（游戏窗口里鼠标点穿不被偷走）
  bounds: { x: number; y: number; width: number; height: number } | null
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
  overlayTheme: OverlayThemeConfig
  lottery: LotteryPreset
  voting: VotingPreset
  horseRace: HorseRacePreset
  guessing: GuessingGlobalConfig
  pets: PetConfig
  aiReply: AiReplyConfig
  danmuReader: DanmuReaderConfig
  songRequest: SongRequestConfig
}

const DEFAULT_DANMU_OVERLAY: DanmuOverlayConfig = {
  ...DEFAULT_DANMU_OVERLAY_SETTINGS,
  enabled: false,
  pinned: false,
  bounds: null
}

const DEFAULT_LOTTERY_PRESET: LotteryPreset = {
  prize: '神秘奖品',
  keyword: '抽奖',
  winnerCount: 1,
  durationSec: 60,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0
}

const DEFAULT_GIFT_DEPOSIT: GiftDepositConfig = {
  enabled: true,
  rmbToCoinRate: 1000, // 1 元礼物 = 1000 哈松币（送 1 块的小心心 = 1000 币，够押 10 手默认 100）
  includeSilver: false // 默认排除银瓜子（辣条等免费礼物），避免薅羊毛刷币
}

// 默认竞猜 preset 对照松子的两个玩法
const DEFAULT_GUESSING: GuessingGlobalConfig = {
  currencyName: '哈松币',
  initialBalance: 1000,
  giftDeposit: { ...DEFAULT_GIFT_DEPOSIT },
  presets: [
    {
      id: 'preset-big-red-location',
      name: '出大红地点',
      title: '猜松子今天会从哪里出大红',
      options: [
        { key: '1', label: '零号大坝' },
        { key: '2', label: '长弓溪谷' },
        { key: '3', label: '航天基地' },
        { key: '4', label: '巴克什' }
      ],
      enrollSec: 180,
      defaultBet: 100,
      requireAnchorFansMedal: false,
      minFansMedalLevel: 0
    },
    {
      id: 'preset-highest-profit',
      name: '谁收益最高',
      title: '猜今天谁收益最高并撤离',
      options: [
        { key: '1', label: '松子' },
        { key: '2', label: '待定 1' },
        { key: '3', label: '待定 2' }
      ],
      enrollSec: 120,
      defaultBet: 100,
      requireAnchorFansMedal: false,
      minFansMedalLevel: 0
    }
  ]
}

const DEFAULT_HORSE_RACE_PRESET: HorseRacePreset = {
  horses: [
    { key: '1', name: '红马', emoji: '🐎' },
    { key: '2', name: '黑马', emoji: '🐴' },
    { key: '3', name: '白马', emoji: '🦄' },
    { key: '4', name: '黄马', emoji: '🐎' }
  ],
  enrollSec: 30,
  raceSec: 25,
  defaultBet: 100,
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
  danmuBoard: {
    ...DEFAULT_DANMU_BOARD_CONFIG,
    position: { ...DEFAULT_DANMU_BOARD_CONFIG.position }
  },
  overlayTheme: { ...DEFAULT_OVERLAY_THEME },
  lottery: { ...DEFAULT_LOTTERY_PRESET },
  voting: { ...DEFAULT_VOTING_PRESET },
  horseRace: { ...DEFAULT_HORSE_RACE_PRESET, horses: [...DEFAULT_HORSE_RACE_PRESET.horses] },
  guessing: { ...DEFAULT_GUESSING, presets: DEFAULT_GUESSING.presets.map((p) => ({ ...p, options: [...p.options] })) },
  pets: { ...DEFAULT_PET_CONFIG },
  aiReply: { ...DEFAULT_AI_REPLY_CONFIG },
  danmuReader: { ...DEFAULT_DANMU_READER_CONFIG },
  songRequest: { ...DEFAULT_SONG_REQUEST_CONFIG }
}

export class AppConfig {
  private store: Store<AppConfigSchema>

  constructor() {
    this.store = new Store<AppConfigSchema>({
      name: 'livelink-config',
      defaults,
      clearInvalidConfig: true
    })
    this.upgradeUntouchedWelcome()
  }

  // 欢迎语改成"一行一句、随机挑一句说"之后，老用户配置里存的还是那句单句欢迎。
  // 判断与替换的规矩写在 rules/defaults.ts 的 upgradeUntouchedWelcome（可离线自检），
  // 这里只负责在启动时落一次盘。没改过的才升级，主播改过的一个字都不动。
  private upgradeUntouchedWelcome(): void {
    const next = upgradeUntouchedWelcome(this.getRules())
    if (next) this.setRules(next)
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
    if (!stored.style) {
      stored.style = 'normal'
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
    return normalizeDanmuOverlayConfig(this.store.get('danmuOverlay'))
  }
  setDanmuOverlay(cfg: DanmuOverlayConfig): void {
    this.store.set('danmuOverlay', normalizeDanmuOverlayConfig(cfg))
  }
  patchDanmuOverlay(patch: Partial<DanmuOverlayConfig>): DanmuOverlayConfig {
    const next = normalizeDanmuOverlayConfig({ ...this.getDanmuOverlay(), ...patch })
    this.setDanmuOverlay(next)
    return this.getDanmuOverlay()
  }
  getDanmuOverlaySettings(): DanmuOverlaySettings {
    return normalizeDanmuOverlaySettings(this.getDanmuOverlay(), DEFAULT_DANMU_OVERLAY_SETTINGS)
  }
  setDanmuOverlaySettings(settings: DanmuOverlaySettings): DanmuOverlaySettings {
    const current = this.getDanmuOverlay()
    // normalizeDanmuOverlaySettings 只读取共享 settings 白名单，enabled / pinned / bounds
    // 即使从 IPC 混进来也不会覆盖窗口状态。
    const nextSettings = normalizeDanmuOverlaySettings(settings, DEFAULT_DANMU_OVERLAY_SETTINGS)
    this.setDanmuOverlay({ ...current, ...nextSettings })
    return this.getDanmuOverlaySettings()
  }
  patchDanmuOverlaySettings(patch: Partial<DanmuOverlaySettings>): DanmuOverlaySettings {
    const current = this.getDanmuOverlaySettings()
    const next = normalizeDanmuOverlaySettings(patch, current)
    return this.setDanmuOverlaySettings(next)
  }

  // OBS 弹幕信息板
  getDanmuBoard(): DanmuBoardConfig {
    const stored = this.store.get('danmuBoard')
    const source = asUnknownRecord(stored)
    const legacyPosition =
      typeof source.position === 'string' ? LEGACY_POSITION_MAP[source.position] : undefined
    const normalized = normalizeDanmuBoardConfig(
      legacyPosition ? { ...source, position: legacyPosition } : source,
      DEFAULT_DANMU_BOARD_CONFIG
    )
    // 四角字符串只写回一次，后续读写统一使用 { x, y }。
    if (legacyPosition) this.store.set('danmuBoard', normalized)
    return normalized
  }
  setDanmuBoard(cfg: DanmuBoardConfig): void {
    this.store.set('danmuBoard', normalizeDanmuBoardConfig(cfg, DEFAULT_DANMU_BOARD_CONFIG))
  }
  patchDanmuBoard(patch: Partial<DanmuBoardConfig>): DanmuBoardConfig {
    const current = this.getDanmuBoard()
    const source = asUnknownRecord(patch)
    const patchPosition = asUnknownRecord(source.position)
    const next = normalizeDanmuBoardConfig(
      {
        ...current,
        ...source,
        position:
          Object.keys(patchPosition).length > 0
            ? { ...current.position, ...patchPosition }
            : source.position ?? current.position
      },
      current
    )
    this.setDanmuBoard(next)
    return this.getDanmuBoard()
  }

  // OBS overlay 主题
  getOverlayTheme(): OverlayThemeConfig {
    const stored = this.store.get('overlayTheme') as Partial<OverlayThemeConfig> | undefined
    return { id: normalizeOverlayThemeId(stored?.id) }
  }
  setOverlayTheme(config: OverlayThemeConfig): void {
    this.store.set('overlayTheme', { id: normalizeOverlayThemeId(config.id) })
  }
  patchOverlayTheme(patch: Partial<OverlayThemeConfig>): OverlayThemeConfig {
    const next = { ...this.getOverlayTheme(), ...patch }
    this.setOverlayTheme(next)
    return this.getOverlayTheme()
  }

  // 竞猜（全局货币 + preset 列表）
  getGuessing(): GuessingGlobalConfig {
    const stored = this.store.get('guessing') as GuessingGlobalConfig | undefined
    if (!stored) {
      return {
        ...DEFAULT_GUESSING,
        giftDeposit: { ...DEFAULT_GIFT_DEPOSIT },
        presets: DEFAULT_GUESSING.presets.map((p) => ({ ...p, options: [...p.options] }))
      }
    }
    // giftDeposit 1.1 之后新增，老配置无此字段时回退默认
    const gd = stored.giftDeposit as Partial<GiftDepositConfig> | undefined
    const giftDeposit: GiftDepositConfig = {
      enabled: typeof gd?.enabled === 'boolean' ? gd.enabled : DEFAULT_GIFT_DEPOSIT.enabled,
      rmbToCoinRate:
        typeof gd?.rmbToCoinRate === 'number' && gd.rmbToCoinRate > 0
          ? gd.rmbToCoinRate
          : DEFAULT_GIFT_DEPOSIT.rmbToCoinRate,
      includeSilver:
        typeof gd?.includeSilver === 'boolean' ? gd.includeSilver : DEFAULT_GIFT_DEPOSIT.includeSilver
    }
    return {
      currencyName: stored.currencyName || DEFAULT_GUESSING.currencyName,
      initialBalance:
        typeof stored.initialBalance === 'number'
          ? stored.initialBalance
          : DEFAULT_GUESSING.initialBalance,
      giftDeposit,
      presets:
        Array.isArray(stored.presets) && stored.presets.length > 0
          ? stored.presets.map((p) => ({
              id: p.id || `preset-${Date.now()}`,
              name: p.name || '未命名',
              title: p.title || '',
              options: Array.isArray(p.options) ? p.options.map((o) => ({ ...o })) : [],
              enrollSec: p.enrollSec ?? 180,
              defaultBet: p.defaultBet ?? 100,
              requireAnchorFansMedal: p.requireAnchorFansMedal ?? false,
              minFansMedalLevel: p.minFansMedalLevel ?? 0
            }))
          : DEFAULT_GUESSING.presets.map((p) => ({ ...p, options: [...p.options] }))
    }
  }
  setGuessing(cfg: GuessingGlobalConfig): void {
    this.store.set('guessing', cfg)
  }
  patchGuessing(patch: Partial<GuessingGlobalConfig>): GuessingGlobalConfig {
    const next: GuessingGlobalConfig = { ...this.getGuessing(), ...patch }
    this.setGuessing(next)
    return this.getGuessing()
  }

  // 赛马 preset
  getHorseRacePreset(): HorseRacePreset {
    const stored = this.store.get('horseRace') as HorseRacePreset | undefined
    if (!stored)
      return {
        ...DEFAULT_HORSE_RACE_PRESET,
        horses: [...DEFAULT_HORSE_RACE_PRESET.horses]
      }
    return {
      horses:
        Array.isArray(stored.horses) && stored.horses.length > 0
          ? stored.horses.map((h) => ({ key: h.key, name: h.name, emoji: h.emoji ?? '🐎' }))
          : [...DEFAULT_HORSE_RACE_PRESET.horses],
      enrollSec: stored.enrollSec ?? DEFAULT_HORSE_RACE_PRESET.enrollSec,
      raceSec: stored.raceSec ?? DEFAULT_HORSE_RACE_PRESET.raceSec,
      // 1.3+ 新增字段：老 preset 无此值时回退默认 100
      defaultBet:
        typeof stored.defaultBet === 'number' && stored.defaultBet > 0
          ? Math.round(stored.defaultBet)
          : DEFAULT_HORSE_RACE_PRESET.defaultBet,
      requireAnchorFansMedal:
        stored.requireAnchorFansMedal ?? DEFAULT_HORSE_RACE_PRESET.requireAnchorFansMedal,
      minFansMedalLevel:
        stored.minFansMedalLevel ?? DEFAULT_HORSE_RACE_PRESET.minFansMedalLevel
    }
  }
  setHorseRacePreset(preset: HorseRacePreset): void {
    this.store.set('horseRace', preset)
  }

  // 养宠
  getPets(): PetConfig {
    return clampPetConfig(this.store.get('pets') as Partial<PetConfig> | undefined ?? DEFAULT_PET_CONFIG)
  }
  setPets(config: PetConfig): void {
    this.store.set('pets', clampPetConfig(config))
  }
  patchPets(patch: Partial<PetConfig>): PetConfig {
    const next = clampPetConfig({ ...this.getPets(), ...patch })
    this.setPets(next)
    return next
  }

  // AI 智能回复（DeepSeek，主播自备 Key）
  getAiReply(): AiReplyConfig {
    return sanitizeAiReplyConfig(this.store.get('aiReply') as Partial<AiReplyConfig> | undefined ?? DEFAULT_AI_REPLY_CONFIG)
  }
  getAiReplyPublic(): AiReplyPublicConfig {
    return toPublicAiReplyConfig(this.getAiReply())
  }
  setAiReply(config: AiReplyConfig): void {
    this.store.set('aiReply', sanitizeAiReplyConfig(config))
  }
  patchAiReply(patch: Partial<AiReplyConfig>): AiReplyPublicConfig {
    const merged = mergeAiReplyPatch(this.getAiReply(), patch)
    this.setAiReply(merged)

    // 写完立刻读回来核对。配置文件被安全软件锁住 / 所在目录只读时，写入未必真的落盘，
    // 页面却一路"保存成功"——主播看到的就是"我明明填了 Key，它还说我没填"。
    // 与其让错误消失，不如在这里就抛出来，页面能如实告诉主播哪里出了问题。
    const saved = this.getAiReply()
    if (saved.apiKey !== merged.apiKey) {
      throw new Error(
        `API Key 没能写进配置文件（${this.store.path}），请检查这个文件是不是被占用或只读了`
      )
    }
    return this.getAiReplyPublic()
  }

  // 弹幕朗读（把观众发的弹幕原文念出来）
  getDanmuReader(): DanmuReaderConfig {
    const cfg = sanitizeDanmuReaderConfig(
      this.store.get('danmuReader') as Partial<DanmuReaderConfig> | undefined
    )
    // voice 为空表示"跟随全局音色"；非空但已下线的话必须清掉，
    // 否则每条弹幕合成都会抛 NoAudioReceived，表现成"朗读开了却一声不吭"
    if (cfg.voice && !VALID_VOICE_VALUES.has(cfg.voice)) {
      console.warn(`[AppConfig] danmuReader.voice "${cfg.voice}" 已下线，回退到跟随全局`)
      cfg.voice = ''
      this.store.set('danmuReader', cfg)
    }
    return cfg
  }
  setDanmuReader(config: DanmuReaderConfig): void {
    this.store.set('danmuReader', sanitizeDanmuReaderConfig(config))
  }
  patchDanmuReader(patch: Partial<DanmuReaderConfig>): DanmuReaderConfig {
    const next = sanitizeDanmuReaderConfig({ ...this.getDanmuReader(), ...patch })
    this.setDanmuReader(next)
    return next
  }

  // 弹幕点歌台
  getSongRequest(): SongRequestConfig {
    return sanitizeSongRequestConfig(
      this.store.get('songRequest') as Partial<SongRequestConfig> | undefined
    )
  }
  setSongRequest(config: SongRequestConfig): void {
    this.store.set('songRequest', sanitizeSongRequestConfig(config))
  }
  patchSongRequest(patch: Partial<SongRequestConfig>): SongRequestConfig {
    const next = sanitizeSongRequestConfig({ ...this.getSongRequest(), ...patch })
    this.setSongRequest(next)
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

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeDanmuOverlayConfig(value: unknown): DanmuOverlayConfig {
  const source = asUnknownRecord(value)
  // 1.7.1 及更早版本保存过 opacity=0.85，但渲染端从未实际使用该字段。
  // 不把它迁移成 backgroundOpacity，避免升级后原本透明的主播窗突然出现深色底板；
  // 老配置缺少 backgroundOpacity 时由共享默认值 0（全透明）兜底。
  const settings = normalizeDanmuOverlaySettings(source, DEFAULT_DANMU_OVERLAY_SETTINGS)
  return {
    ...settings,
    enabled:
      typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_DANMU_OVERLAY.enabled,
    pinned: typeof source.pinned === 'boolean' ? source.pinned : DEFAULT_DANMU_OVERLAY.pinned,
    bounds: normalizeDanmuOverlayBounds(source.bounds)
  }
}

function normalizeDanmuOverlayBounds(
  value: unknown
): DanmuOverlayConfig['bounds'] {
  if (value === null || value === undefined) return null
  const source = asUnknownRecord(value)
  const fields = ['x', 'y', 'width', 'height'] as const
  if (!fields.every((field) => typeof source[field] === 'number' && Number.isFinite(source[field]))) {
    return null
  }
  const x = source.x as number
  const y = source.y as number
  const width = source.width as number
  const height = source.height as number
  if (width <= 0 || height <= 0) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}
