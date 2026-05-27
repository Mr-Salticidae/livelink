import Store from 'electron-store'
import {
  getPetSpecies,
  stageForLevel,
  type PetConfig,
  type PetOwner,
  type PetSpeciesId,
  type UserPet
} from '../../shared/pets'

interface PetStoreSchema {
  rooms: Record<string, Record<string, PetOwner>>
}

export class PetStore {
  private store: Store<PetStoreSchema>

  constructor() {
    this.store = new Store<PetStoreSchema>({
      name: 'pet-records',
      defaults: { rooms: {} },
      clearInvalidConfig: true
    })
  }

  static keyOf(uid: string, uname: string): string {
    return `${uid || '0'}|${uname || '观众'}`
  }

  getOwner(roomId: number | string, uid: string, uname: string): PetOwner | null {
    const room = this.store.get('rooms')[String(roomId)]
    if (!room) return null
    const owner = room[PetStore.keyOf(uid, uname)]
    return owner ? normalizeOwner(owner, uid, uname) : null
  }

  getOrCreateOwner(roomId: number | string, uid: string, uname: string): PetOwner {
    const rid = String(roomId)
    const key = PetStore.keyOf(uid, uname)
    const all = this.store.get('rooms')
    const room = all[rid] ?? {}
    const existing = room[key]
    if (existing) {
      const normalized = normalizeOwner(existing, uid, uname)
      room[key] = normalized
      all[rid] = room
      this.store.set('rooms', all)
      return normalized
    }

    const owner: PetOwner = {
      uid: uid || '0',
      uname: uname || '观众',
      primaryPetId: null,
      pets: [],
      lastSeenAt: Date.now()
    }
    room[key] = owner
    all[rid] = room
    this.store.set('rooms', all)
    return owner
  }

  saveOwner(roomId: number | string, owner: PetOwner): void {
    const rid = String(roomId)
    const key = PetStore.keyOf(owner.uid, owner.uname)
    const all = this.store.get('rooms')
    const room = all[rid] ?? {}
    room[key] = normalizeOwner(owner, owner.uid, owner.uname)
    all[rid] = room
    this.store.set('rooms', all)
  }

  listOwners(roomId: number | string): PetOwner[] {
    const room = this.store.get('rooms')[String(roomId)]
    if (!room) return []
    return Object.values(room).map((owner) => normalizeOwner(owner, owner.uid, owner.uname))
  }
}

export function createPet(speciesId: PetSpeciesId, nickname?: string): UserPet {
  const species = getPetSpecies(speciesId)
  const now = Date.now()
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    speciesId,
    nickname: (nickname || species?.name || '宠物').slice(0, 16),
    level: 1,
    exp: 0,
    stage: 1,
    adoptedAt: now,
    lastActiveAt: now
  }
}

function normalizeOwner(owner: PetOwner, uid: string, uname: string): PetOwner {
  const pets = Array.isArray(owner.pets)
    ? owner.pets
        .filter((pet) => getPetSpecies(pet.speciesId))
        .map((pet) => ({
          ...pet,
          level: Math.max(1, Math.round(pet.level || 1)),
          exp: Math.max(0, Math.round(pet.exp || 0)),
          stage: stageForLevel(Math.max(1, Math.round(pet.level || 1))),
          lastActiveAt: pet.lastActiveAt || pet.adoptedAt || Date.now()
        }))
    : []
  const primaryStillExists = pets.some((pet) => pet.id === owner.primaryPetId)
  return {
    uid: uid || owner.uid || '0',
    uname: uname || owner.uname || '观众',
    primaryPetId: primaryStillExists ? owner.primaryPetId : pets[0]?.id ?? null,
    pets,
    lastSeenAt: owner.lastSeenAt || Date.now()
  }
}

export type { PetConfig }
