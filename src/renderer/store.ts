import { ref, computed } from 'vue'
import type { ConnectionStatus, LogEntry, Rule, TTSConfig, VoiceOption } from './types'

export const status = ref<ConnectionStatus>({ state: 'idle' })
export const room = ref<{ id: string }>({ id: '' })
export const overlayUrl = ref<string>('')
export const overlayPort = ref<number>(0)
export const ttsConfig = ref<TTSConfig | null>(null)
export const voices = ref<VoiceOption[]>([])
export const rules = ref<Rule[]>([])
export const logs = ref<LogEntry[]>([])

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
    overlayPort.value = await api.getOverlayPort()
    overlayUrl.value = await api.getOverlayUrl()
  } catch (err) {
    console.error('overlay info failed', err)
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
}
