import { safeStorage } from 'electron'
import Store from 'electron-store'
import { defaultRules } from '../rules/defaults'
import type { Rule } from '../rules/types'
import { DEFAULT_TTS_CONFIG, type TTSConfig } from '../actions/tts'

// B 站登录态。SESSDATA 是 cookie，2023 年 7 月起 B 站对游客限制 DANMU_MSG 推送，需要登录态。
// 仅本地存储，不上传。sessdata 用 Electron safeStorage 加密（Win 上走 DPAPI，与当前用户账号绑定），
// 文件复制到别的电脑解不开 → 防止 cookie 共享/泄露。uid / buvid 不算敏感，明文保存。
export interface BilibiliAuth {
  sessdata: string
  uid: string
  buvid: string // buvid3，可选
}

export interface AppConfigSchema {
  room: { id: string }
  rules: Rule[]
  tts: TTSConfig
  overlay: { port: number }
  platform: { active: 'bilibili' }
  auth: { bilibili: BilibiliAuth }
}

const defaults: AppConfigSchema = {
  room: { id: '' },
  rules: defaultRules,
  tts: { ...DEFAULT_TTS_CONFIG },
  overlay: { port: 38501 },
  platform: { active: 'bilibili' },
  auth: { bilibili: { sessdata: '', uid: '', buvid: '' } }
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
