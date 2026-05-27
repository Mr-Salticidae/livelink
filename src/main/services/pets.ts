import type { OverlayBroadcaster } from '../actions/overlay'
import type { Bus } from '../events/bus'
import type { StandardEvent } from '../platform/adapter'
import type { WalletStore } from './wallet-store'
import { createPet, PetStore } from './pet-store'
import {
  PET_LEVEL_EXP,
  PET_SPECIES,
  clampPetConfig,
  getPetSpecies,
  getPetSpeciesByInput,
  stageForLevel,
  type PetConfig,
  type PetDisplayItem,
  type PetOwner,
  type PetState,
  type UserPet
} from '../../shared/pets'

export interface PetActionResult {
  ok: true
  owner: PetOwner
  pet: UserPet
  message: string
  leveledUp: boolean
  evolved: boolean
}

type PetErrorResult = { ok: false; error: string }

const WATCH_TICK_MS = 60_000

export class PetService {
  private bus: Bus
  private overlay: OverlayBroadcaster
  private store: PetStore
  private wallet: WalletStore
  private getCurrentRoomId: () => number | null
  private getInitialBalance: () => number
  private getCurrencyName: () => string
  private getConfig: () => PetConfig
  private statusListeners = new Set<(s: PetState) => void>()
  private seenUsers = new Map<string, { uid: string; uname: string; roomId: number }>()
  private watchTimer: NodeJS.Timeout | null = null
  private unsubBus: (() => void) | null = null

  constructor(deps: {
    bus: Bus
    overlay: OverlayBroadcaster
    store: PetStore
    wallet: WalletStore
    getCurrentRoomId: () => number | null
    getInitialBalance: () => number
    getCurrencyName: () => string
    getConfig: () => PetConfig
  }) {
    this.bus = deps.bus
    this.overlay = deps.overlay
    this.store = deps.store
    this.wallet = deps.wallet
    this.getCurrentRoomId = deps.getCurrentRoomId
    this.getInitialBalance = deps.getInitialBalance
    this.getCurrencyName = deps.getCurrencyName
    this.getConfig = deps.getConfig
  }

  attach(): void {
    if (this.unsubBus) return
    const handler = (e: StandardEvent): void => this.handleEvent(e)
    this.bus.on('event', handler)
    this.unsubBus = () => this.bus.off('event', handler)
    this.watchTimer = setInterval(() => this.grantWatchExp(), WATCH_TICK_MS)
  }

  dispose(): void {
    this.unsubBus?.()
    this.unsubBus = null
    if (this.watchTimer) {
      clearInterval(this.watchTimer)
      this.watchTimer = null
    }
    this.seenUsers.clear()
  }

  onStatusChange(cb: (s: PetState) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  getState(): PetState {
    const roomId = this.getCurrentRoomId()
    const config = clampPetConfig(this.getConfig())
    if (roomId == null) return { config, totalOwners: 0, totalPets: 0, dock: [] }
    const owners = this.store.listOwners(roomId)
    return {
      config,
      totalOwners: owners.length,
      totalPets: owners.reduce((sum, owner) => sum + owner.pets.length, 0),
      dock: this.getDock(roomId, config.displayLimit)
    }
  }

  top(limit = 20): PetDisplayItem[] {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return []
    return this.getDock(roomId, limit)
  }

  getUser(uid: string, uname: string): PetOwner | null {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return null
    return this.store.getOwner(roomId, uid, uname)
  }

  adopt(uid: string, uname: string, speciesInput: string): PetActionResult | PetErrorResult {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return { ok: false, error: '直播间未连接' }
    const species = getPetSpeciesByInput(speciesInput) ?? PET_SPECIES[0]
    const config = clampPetConfig(this.getConfig())
    const owner = this.store.getOrCreateOwner(roomId, uid, uname)
    const ownedSame = owner.pets.filter((pet) => pet.speciesId === species.id).length
    const pet = createPet(species.id, ownedSame > 0 ? `${species.name}${ownedSame + 1}` : species.name)

    if (config.adoptionCost > 0) {
      const deducted = this.wallet.deduct(
        roomId,
        uid,
        uname,
        config.adoptionCost,
        this.getInitialBalance()
      )
      if (deducted < config.adoptionCost) {
        if (deducted > 0) this.wallet.refund(roomId, uid, uname, deducted)
        return { ok: false, error: `${this.getCurrencyName()}不足，领养需要 ${config.adoptionCost}` }
      }
    }

    owner.pets.push(pet)
    owner.primaryPetId = pet.id
    owner.lastSeenAt = Date.now()
    this.store.saveOwner(roomId, owner)
    this.pushPetCard(owner, pet, `${uname} 领养了 ${pet.nickname}`)
    this.pushDock()
    this.notify()
    return { ok: true, owner, pet, message: '领养成功', leveledUp: false, evolved: false }
  }

  feed(uid: string, uname: string, amount?: number): PetActionResult | PetErrorResult {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return { ok: false, error: '直播间未连接' }
    const config = clampPetConfig(this.getConfig())
    const owner = this.store.getOwner(roomId, uid, uname)
    if (!owner || owner.pets.length === 0) return { ok: false, error: '还没有宠物，先发送“领养宠物 1”' }
    const pet = findPrimaryPet(owner)
    if (!pet) return { ok: false, error: '还没有首选宠物' }

    const cost = Math.max(config.feedCost, Math.round(amount || config.feedCost))
    const deducted = this.wallet.deduct(roomId, uid, uname, cost, this.getInitialBalance())
    if (deducted <= 0) return { ok: false, error: `${this.getCurrencyName()}不足，投喂失败` }
    const exp = Math.max(config.feedExp, Math.floor((deducted / config.feedCost) * config.feedExp))
    const result = this.addExp(owner, pet, exp)
    this.store.saveOwner(roomId, owner)
    this.pushPetCard(owner, pet, `${uname} 投喂了 ${pet.nickname}`)
    this.pushGrowthEvents(owner, pet, result.leveledUp, result.evolved)
    this.pushDock()
    this.notify()
    return { ok: true, owner, pet, message: '投喂成功', ...result }
  }

  setPrimary(uid: string, uname: string, input: string): PetActionResult | PetErrorResult {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return { ok: false, error: '直播间未连接' }
    const owner = this.store.getOwner(roomId, uid, uname)
    if (!owner || owner.pets.length === 0) return { ok: false, error: '还没有宠物' }
    const pet = findPetByInput(owner, input)
    if (!pet) return { ok: false, error: `找不到宠物 ${input}` }
    owner.primaryPetId = pet.id
    owner.lastSeenAt = Date.now()
    pet.lastActiveAt = owner.lastSeenAt
    this.store.saveOwner(roomId, owner)
    this.pushPetCard(owner, pet, `${uname} 切换了首选宠物`)
    this.pushDock()
    this.notify()
    return { ok: true, owner, pet, message: '切换成功', leveledUp: false, evolved: false }
  }

  showCard(uid: string, uname: string): PetOwner | null {
    const roomId = this.getCurrentRoomId()
    if (roomId == null) return null
    const owner = this.store.getOwner(roomId, uid, uname)
    const pet = owner ? findPrimaryPet(owner) : null
    if (owner && pet) this.pushPetCard(owner, pet, `${uname} 的宠物`)
    return owner
  }

  pushDock(): void {
    const state = this.getState()
    this.overlay.broadcast({
      kind: 'pet.dock.update',
      event: this.fakeEvent(Date.now()),
      extra: {
        enabled: state.config.enabled,
        displayLimit: state.config.displayLimit,
        dock: state.dock
      }
    })
  }

  private handleEvent(e: StandardEvent): void {
    if (e.kind === 'viewer.enter') {
      const roomId = this.getCurrentRoomId()
      if (roomId == null) return
      const uname = e.user.uname || '观众'
      const key = PetStore.keyOf(e.user.uid, uname)
      this.seenUsers.set(key, { uid: e.user.uid || '0', uname, roomId })
      const owner = this.store.getOwner(roomId, e.user.uid, uname)
      if (owner) {
        owner.lastSeenAt = e.timestamp
        this.store.saveOwner(roomId, owner)
        this.pushDock()
      }
      return
    }

    if (e.kind !== 'danmu.received') return
    const text = (e.payload.content ?? '').trim()
    if (!text) return
    const uname = e.user.uname || '观众'
    if (/^领养宠物/.test(text)) {
      const speciesInput = text.replace(/^领养宠物/, '').trim() || '1'
      this.adopt(e.user.uid || '0', uname, speciesInput)
      return
    }
    if (text === '我的宠物' || text === '查宠物') {
      this.showCard(e.user.uid || '0', uname)
      return
    }
    if (/^切换宠物/.test(text)) {
      const input = text.replace(/^切换宠物/, '').trim()
      if (input) this.setPrimary(e.user.uid || '0', uname, input)
      return
    }
    if (/^投喂/.test(text)) {
      const raw = text.replace(/^投喂/, '').trim()
      const amount = raw ? Number(raw.split(/[\s,，：:]+/)[0]) : undefined
      this.feed(e.user.uid || '0', uname, Number.isFinite(amount) ? amount : undefined)
    }
  }

  private grantWatchExp(): void {
    const config = clampPetConfig(this.getConfig())
    if (config.watchExpPerMinute <= 0) return
    const currentRoomId = this.getCurrentRoomId()
    if (currentRoomId == null) return
    let changed = false
    for (const seen of this.seenUsers.values()) {
      if (seen.roomId !== currentRoomId) continue
      const owner = this.store.getOwner(seen.roomId, seen.uid, seen.uname)
      const pet = owner ? findPrimaryPet(owner) : null
      if (!owner || !pet) continue
      const result = this.addExp(owner, pet, config.watchExpPerMinute)
      this.store.saveOwner(seen.roomId, owner)
      this.pushGrowthEvents(owner, pet, result.leveledUp, result.evolved)
      changed = true
    }
    if (changed) {
      this.pushDock()
      this.notify()
    }
  }

  private addExp(owner: PetOwner, pet: UserPet, exp: number): { leveledUp: boolean; evolved: boolean } {
    const prevLevel = pet.level
    const prevStage = pet.stage
    pet.exp += Math.max(0, Math.round(exp))
    while (pet.exp >= PET_LEVEL_EXP) {
      pet.exp -= PET_LEVEL_EXP
      pet.level += 1
    }
    pet.stage = stageForLevel(pet.level)
    const now = Date.now()
    pet.lastActiveAt = now
    owner.lastSeenAt = now
    return { leveledUp: pet.level > prevLevel, evolved: pet.stage > prevStage }
  }

  private getDock(roomId: number, limit: number): PetDisplayItem[] {
    return this.store
      .listOwners(roomId)
      .map((owner) => {
        const pet = findPrimaryPet(owner)
        const species = pet ? getPetSpecies(pet.speciesId) : null
        if (!pet || !species) return null
        return { ownerUid: owner.uid, ownerName: owner.uname, pet, species }
      })
      .filter((item): item is PetDisplayItem => Boolean(item))
      .sort((a, b) => {
        if (b.pet.level !== a.pet.level) return b.pet.level - a.pet.level
        return b.pet.lastActiveAt - a.pet.lastActiveAt
      })
      .slice(0, Math.max(1, Math.min(20, limit)))
  }

  private pushPetCard(owner: PetOwner, pet: UserPet, title: string): void {
    const species = getPetSpecies(pet.speciesId)
    if (!species) return
    this.overlay.broadcast({
      kind: 'pet.card',
      event: this.fakeEvent(Date.now()),
      extra: { title, item: { ownerUid: owner.uid, ownerName: owner.uname, pet, species } }
    })
  }

  private pushGrowthEvents(owner: PetOwner, pet: UserPet, leveledUp: boolean, evolved: boolean): void {
    const species = getPetSpecies(pet.speciesId)
    if (!species) return
    if (evolved) {
      this.overlay.broadcast({
        kind: 'pet.evolve',
        event: this.fakeEvent(Date.now()),
        extra: { item: { ownerUid: owner.uid, ownerName: owner.uname, pet, species } }
      })
    } else if (leveledUp) {
      this.overlay.broadcast({
        kind: 'pet.level-up',
        event: this.fakeEvent(Date.now()),
        extra: { item: { ownerUid: owner.uid, ownerName: owner.uname, pet, species } }
      })
    }
  }

  private notify(): void {
    const state = this.getState()
    for (const listener of this.statusListeners) {
      try {
        listener(state)
      } catch (err) {
        console.error('[PetService] listener failed', err)
      }
    }
  }

  private fakeEvent(timestamp: number): StandardEvent {
    return {
      kind: 'viewer.enter',
      platform: 'bilibili',
      timestamp,
      user: { uid: '0', uname: '宠物系统' },
      payload: {}
    }
  }
}

function findPrimaryPet(owner: PetOwner): UserPet | null {
  return owner.pets.find((pet) => pet.id === owner.primaryPetId) ?? owner.pets[0] ?? null
}

function findPetByInput(owner: PetOwner, input: string): UserPet | null {
  const text = input.trim()
  if (!text) return null
  const byIndex = Number(text)
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= owner.pets.length) {
    return owner.pets[byIndex - 1]
  }
  return (
    owner.pets.find((pet) => pet.id === text || pet.nickname === text) ??
    owner.pets.find((pet) => getPetSpecies(pet.speciesId)?.name === text) ??
    null
  )
}
