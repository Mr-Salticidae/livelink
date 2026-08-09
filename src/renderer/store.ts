import { ref, computed } from 'vue'
import type {
  BilibiliAuth,
  ConnectionStatus,
  DanmuBoardConfig,
  GuessingState,
  HorseRaceState,
  LogEntry,
  LotteryState,
  OverlayState,
  PetState,
  Rule,
  TTSConfig,
  VoiceOption,
  VotingState
} from './types'
import { DEFAULT_PET_CONFIG } from '../shared/pets'
import { DEFAULT_OVERLAY_THEME, type OverlayThemeConfig } from '../shared/overlay-theme'
import {
  DEFAULT_DANMU_BOARD_CONFIG,
  DEFAULT_DANMU_OVERLAY_SETTINGS,
  normalizeDanmuBoardConfig,
  normalizeDanmuOverlaySettings,
  type DanmuOverlaySettings
} from '../shared/danmu-display'

export const status = ref<ConnectionStatus>({ state: 'idle' })
export const room = ref<{ id: string }>({ id: '' })
export const overlayUrl = ref<string>('')
export const overlayPort = ref<number>(0)
export const overlayFatalError = ref<string | null>(null)
export const overlayRetrying = ref<boolean>(false)
export const ttsConfig = ref<TTSConfig | null>(null)
export const voices = ref<VoiceOption[]>([])
export const bilibiliAuth = ref<BilibiliAuth>({ sessdata: '', uid: '', buvid: '' })
export const rules = ref<Rule[]>([])
export const logs = ref<LogEntry[]>([])
export const danmuOverlayEnabled = ref<boolean>(false)
export const danmuOverlayPinned = ref<boolean>(false)
export const danmuOverlaySettings = ref<DanmuOverlaySettings>({
  ...DEFAULT_DANMU_OVERLAY_SETTINGS
})
let danmuOverlaySettingsPushVersion = 0
export const lotteryState = ref<LotteryState>({ phase: 'idle' })
export const votingState = ref<VotingState>({ phase: 'idle' })
export const horseRaceState = ref<HorseRaceState>({ phase: 'idle' })
export const guessingState = ref<GuessingState>({ phase: 'idle' })
export const petState = ref<PetState>({
  config: { ...DEFAULT_PET_CONFIG },
  totalOwners: 0,
  totalPets: 0,
  dock: []
})
export const danmuBoard = ref<DanmuBoardConfig>({
  ...DEFAULT_DANMU_BOARD_CONFIG,
  position: { ...DEFAULT_DANMU_BOARD_CONFIG.position }
})
export const overlayTheme = ref<OverlayThemeConfig>({ ...DEFAULT_OVERLAY_THEME })

export type PageKey =
  | 'home'
  | 'rules'
  | 'tts'
  | 'lottery'
  | 'voting'
  | 'horserace'
  | 'guessing'
  | 'pets'
  | 'ai'
  | 'reader'
  | 'song'
  | 'logs'
export const currentPage = ref<PageKey>('home')

export const enabledRuleCount = computed(() => rules.value.filter((r) => r.enabled).length)
export const isConnected = computed(() => status.value.state === 'connected')
export const isBusy = computed(() =>
  ['validating', 'connecting', 'reconnecting'].includes(status.value.state)
)

const MAX_LOG_BUFFER = 500

export async function loadInitialData(): Promise<void> {
  const api = window.api
  try {
    status.value = await api.getStatus()
  } catch (err) {
    console.error('getStatus failed', err)
  }
  try {
    const overlayState = await api.getOverlayStatus()
    applyOverlayState(overlayState)
  } catch (err) {
    console.error('overlay status failed', err)
  }
  try {
    room.value = await api.getRoom()
  } catch (err) {
    console.error('getRoom failed', err)
  }
  try {
    ttsConfig.value = await api.getTts()
    voices.value = await api.ttsVoiceList()
  } catch (err) {
    console.error('tts info failed', err)
  }
  try {
    bilibiliAuth.value = await api.getBilibiliAuth()
  } catch (err) {
    console.error('bilibili auth load failed', err)
  }
  try {
    rules.value = await api.ruleList()
  } catch (err) {
    console.error('ruleList failed', err)
  }
  try {
    logs.value = (await api.logRecent(MAX_LOG_BUFFER)) ?? []
  } catch (err) {
    console.error('logRecent failed', err)
  }

  api.onStatus((s) => {
    status.value = s
  })
  api.onLog((entry) => {
    logs.value.push(entry)
    if (logs.value.length > MAX_LOG_BUFFER) {
      logs.value.splice(0, logs.value.length - MAX_LOG_BUFFER)
    }
  })
  api.onOverlayStatus((s) => applyOverlayState(s))

  // 弹幕悬浮窗状态 + 样式初始化。先订阅再拉快照，避免 get/subscribe 之间漏掉更新。
  try {
    const s = await api.danmuOverlayStatus()
    danmuOverlayEnabled.value = s.enabled
    danmuOverlayPinned.value = s.pinned
  } catch (err) {
    console.error('danmuOverlayStatus failed', err)
  }
  api.onDanmuOverlayStatus((s) => {
    danmuOverlayEnabled.value = s.enabled
    danmuOverlayPinned.value = s.pinned
  })
  api.onDanmuOverlaySettings((next) => {
    danmuOverlaySettingsPushVersion += 1
    danmuOverlaySettings.value = normalizeDanmuOverlaySettings(next)
  })
  try {
    const pushVersion = danmuOverlaySettingsPushVersion
    const snapshot = await api.getDanmuOverlaySettings()
    if (pushVersion === danmuOverlaySettingsPushVersion) {
      danmuOverlaySettings.value = normalizeDanmuOverlaySettings(snapshot)
    }
  } catch (err) {
    console.error('getDanmuOverlaySettings failed', err)
  }

  // 抽奖初始化
  await initLottery()
  // 投票初始化
  await initVoting()
  // 赛马初始化
  await initHorseRace()
  // 竞猜初始化
  await initGuessing()
  // 养宠初始化
  await initPets()

  // OBS 弹幕信息板配置初始化
  try {
    danmuBoard.value = await api.getDanmuBoard()
  } catch (err) {
    console.error('getDanmuBoard failed', err)
  }
  try {
    overlayTheme.value = await api.overlayThemeGet()
  } catch (err) {
    console.error('overlayThemeGet failed', err)
  }
}

// 装修预览模式：板子在 OBS 里装满假弹幕显示满载效果，方便对齐画面装修
// 非持久（重启即关），调好画面后关掉就恢复真实状态
export const danmuBoardPreviewFull = ref<boolean>(false)

let danmuBoardPatchVersion = 0
export async function patchDanmuBoard(patch: Partial<DanmuBoardConfig>): Promise<void> {
  const previous = danmuBoard.value
  const version = ++danmuBoardPatchVersion
  // 本地先更新，让控制面板和预览不必等 IPC 往返；只让最后一次响应回写，避免滑杆乱序闪回。
  danmuBoard.value = normalizeDanmuBoardConfig(
    { ...danmuBoard.value, ...patch },
    danmuBoard.value
  )
  try {
    const next = await window.api.patchDanmuBoard(patch)
    if (version === danmuBoardPatchVersion) {
      danmuBoard.value = normalizeDanmuBoardConfig(next)
    }
  } catch (err) {
    console.error('patchDanmuBoard failed', err)
    if (version === danmuBoardPatchVersion) danmuBoard.value = previous
  }
}

let danmuOverlayPatchVersion = 0
export async function patchDanmuOverlaySettings(
  patch: Partial<DanmuOverlaySettings>
): Promise<void> {
  const previous = danmuOverlaySettings.value
  const version = ++danmuOverlayPatchVersion
  danmuOverlaySettings.value = normalizeDanmuOverlaySettings(
    { ...danmuOverlaySettings.value, ...patch },
    danmuOverlaySettings.value
  )
  try {
    const next = await window.api.patchDanmuOverlaySettings(patch)
    if (version === danmuOverlayPatchVersion) {
      danmuOverlaySettings.value = normalizeDanmuOverlaySettings(next)
    }
  } catch (err) {
    console.error('patchDanmuOverlaySettings failed', err)
    if (version === danmuOverlayPatchVersion) danmuOverlaySettings.value = previous
  }
}

export async function toggleDanmuBoardPreviewFull(): Promise<void> {
  try {
    const r = await window.api.danmuBoardSetPreviewFull(!danmuBoardPreviewFull.value)
    danmuBoardPreviewFull.value = r.previewFull
  } catch (err) {
    console.error('danmuBoardSetPreviewFull failed', err)
  }
}

export async function toggleDanmuOverlay(): Promise<void> {
  try {
    const next = await window.api.danmuOverlayToggle()
    danmuOverlayEnabled.value = next.enabled
    danmuOverlayPinned.value = next.pinned
  } catch (err) {
    console.error('danmuOverlayToggle failed', err)
  }
}

export async function toggleDanmuOverlayPin(): Promise<void> {
  try {
    const next = await window.api.danmuOverlayPinToggle()
    danmuOverlayEnabled.value = next.enabled
    danmuOverlayPinned.value = next.pinned
  } catch (err) {
    console.error('danmuOverlayPinToggle failed', err)
  }
}

export async function initLottery(): Promise<void> {
  try {
    lotteryState.value = await window.api.lotteryStatus()
  } catch (err) {
    console.error('lotteryStatus failed', err)
  }
  window.api.onLotteryStatus((s) => {
    lotteryState.value = s
  })
}

export async function initVoting(): Promise<void> {
  try {
    votingState.value = await window.api.votingStatus()
  } catch (err) {
    console.error('votingStatus failed', err)
  }
  window.api.onVotingStatus((s) => {
    votingState.value = s
  })
}

export async function initHorseRace(): Promise<void> {
  try {
    horseRaceState.value = await window.api.horseRaceStatus()
  } catch (err) {
    console.error('horseRaceStatus failed', err)
  }
  window.api.onHorseRaceStatus((s) => {
    horseRaceState.value = s
  })
}

export async function initGuessing(): Promise<void> {
  try {
    guessingState.value = await window.api.guessingStatus()
  } catch (err) {
    console.error('guessingStatus failed', err)
  }
  window.api.onGuessingStatus((s) => {
    guessingState.value = s
  })
}

export async function patchOverlayTheme(patch: Partial<OverlayThemeConfig>): Promise<void> {
  try {
    overlayTheme.value = await window.api.overlayThemePatch(patch)
  } catch (err) {
    console.error('overlayThemePatch failed', err)
  }
}

export async function initPets(): Promise<void> {
  try {
    petState.value = await window.api.petStatus()
  } catch (err) {
    console.error('petStatus failed', err)
  }
  window.api.onPetStatus((s) => {
    petState.value = s
  })
}

function applyOverlayState(s: OverlayState): void {
  overlayPort.value = s.port
  overlayUrl.value = s.url
  overlayFatalError.value = s.fatalError
  overlayRetrying.value = s.retrying
}

export async function retryOverlay(): Promise<void> {
  overlayRetrying.value = true
  try {
    const next = await window.api.retryOverlay()
    applyOverlayState(next)
  } catch (err) {
    overlayFatalError.value = (err as Error)?.message ?? '重试失败'
  } finally {
    overlayRetrying.value = false
  }
}
