import Store from 'electron-store'
import { defaultRules } from '../rules/defaults'
import type { Rule } from '../rules/types'
import { DEFAULT_TTS_CONFIG, type TTSConfig } from '../actions/tts'

export interface AppConfigSchema {
  room: { id: string }
  rules: Rule[]
  tts: TTSConfig
  overlay: { port: number }
  platform: { active: 'bilibili' }
}

const defaults: AppConfigSchema = {
  room: { id: '' },
  rules: defaultRules,
  tts: { ...DEFAULT_TTS_CONFIG },
  overlay: { port: 38501 },
  platform: { active: 'bilibili' }
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
    return this.store.get('tts')
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
}
