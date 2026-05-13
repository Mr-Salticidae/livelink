import { ref, computed } from 'vue'
import type { BilibiliAuth, ConnectionStatus, LogEntry, OverlayState, Rule, TTSConfig, VoiceOption } from './types'

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

export type PageKey = 'home' | 'rules' | 'tts' | 'logs'
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
