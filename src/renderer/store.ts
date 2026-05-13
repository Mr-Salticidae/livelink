import { ref, computed } from 'vue'
import type {
  BilibiliAuth,
  ConnectionStatus,
  DanmuBoardConfig,
  HorseRaceState,
  LogEntry,
  LotteryState,
  OverlayState,
  Rule,
  TTSConfig,
  VoiceOption,
  VotingState
} from './types'

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
export const lotteryState = ref<LotteryState>({ phase: 'idle' })
export const votingState = ref<VotingState>({ phase: 'idle' })
export const horseRaceState = ref<HorseRaceState>({ phase: 'idle' })
export const danmuBoard = ref<DanmuBoardConfig>({
  enabled: false,
  position: { x: 2, y: 76 },
  maxLines: 10,
  fontSize: 16,
  showGift: true
})

export type PageKey = 'home' | 'rules' | 'tts' | 'lottery' | 'voting' | 'horserace' | 'logs'
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

  // 弹幕悬浮窗状态初始化 + 订阅
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

  // 抽奖初始化
  await initLottery()
  // 投票初始化
  await initVoting()
  // 赛马初始化
  await initHorseRace()

  // OBS 弹幕信息板配置初始化
  try {
    danmuBoard.value = await api.getDanmuBoard()
  } catch (err) {
    console.error('getDanmuBoard failed', err)
  }
}

export async function patchDanmuBoard(patch: Partial<DanmuBoardConfig>): Promise<void> {
  try {
    danmuBoard.value = await window.api.patchDanmuBoard(patch)
  } catch (err) {
    console.error('patchDanmuBoard failed', err)
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
