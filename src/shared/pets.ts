export type PetSpeciesId = 'sproutling' | 'embermew' | 'bubblepup'
export type PetStage = 1 | 2 | 3

export interface PetSpecies {
  id: PetSpeciesId
  key: string
  name: string
  title: string
  accent: string
  stageNames: Record<PetStage, string>
  assets: Record<PetStage, string>
}

export interface PetConfig {
  enabled: boolean
  displayLimit: number
  adoptionCost: number
  feedCost: number
  feedExp: number
  watchExpPerMinute: number
  dockOffsetY: number // 宠物栏距底部的像素偏移（0 = 贴底，正值 = 向上移）
}

export interface UserPet {
  id: string
  speciesId: PetSpeciesId
  nickname: string
  level: number
  exp: number
  stage: PetStage
  adoptedAt: number
  lastActiveAt: number
}

export interface PetOwner {
  uid: string
  uname: string
  primaryPetId: string | null
  pets: UserPet[]
  lastSeenAt: number
}

export interface PetDisplayItem {
  ownerUid: string
  ownerName: string
  pet: UserPet
  species: PetSpecies
}

export interface PetState {
  config: PetConfig
  totalOwners: number
  totalPets: number
  dock: PetDisplayItem[]
}

export const PET_SPECIES: PetSpecies[] = [
  {
    id: 'sproutling',
    key: '1',
    name: '芽芽灵',
    title: '会发光的小叶子',
    accent: '#74d680',
    stageNames: { 1: '嫩芽', 2: '花苞', 3: '森冠' },
    assets: {
      1: '/assets/pets/sproutling-stage1.png',
      2: '/assets/pets/sproutling-stage2.png',
      3: '/assets/pets/sproutling-stage3.png'
    }
  },
  {
    id: 'embermew',
    key: '2',
    name: '焰喵',
    title: '尾巴暖暖的小火苗',
    accent: '#fb923c',
    stageNames: { 1: '火星', 2: '焰尾', 3: '赤辉' },
    assets: {
      1: '/assets/pets/embermew-stage1.png',
      2: '/assets/pets/embermew-stage2.png',
      3: '/assets/pets/embermew-stage3.png'
    }
  },
  {
    id: 'bubblepup',
    key: '3',
    name: '泡泡汪',
    title: '戴着水泡围巾的小伙伴',
    accent: '#38bdf8',
    stageNames: { 1: '水泡', 2: '浪花', 3: '潮星' },
    assets: {
      1: '/assets/pets/bubblepup-stage1.png',
      2: '/assets/pets/bubblepup-stage2.png',
      3: '/assets/pets/bubblepup-stage3.png'
    }
  }
]

export const DEFAULT_PET_CONFIG: PetConfig = {
  enabled: true,
  displayLimit: 10,
  adoptionCost: 500,
  feedCost: 100,
  feedExp: 25,
  watchExpPerMinute: 3,
  dockOffsetY: 0
}

export const PET_LEVEL_EXP = 100
export const PET_STAGE_2_LEVEL = 5
export const PET_STAGE_3_LEVEL = 12

export function getPetSpecies(id: string): PetSpecies | null {
  return PET_SPECIES.find((s) => s.id === id) ?? null
}

export function getPetSpeciesByInput(input: string): PetSpecies | null {
  const text = input.trim()
  if (!text) return null
  return PET_SPECIES.find((s) => s.key === text || s.id === text || s.name === text) ?? null
}

export function stageForLevel(level: number): PetStage {
  if (level >= PET_STAGE_3_LEVEL) return 3
  if (level >= PET_STAGE_2_LEVEL) return 2
  return 1
}

export function clampPetConfig(config: Partial<PetConfig>): PetConfig {
  const base = { ...DEFAULT_PET_CONFIG, ...config }
  return {
    enabled: Boolean(base.enabled),
    displayLimit: clampInt(base.displayLimit, 1, 20),
    adoptionCost: clampInt(base.adoptionCost, 0, 100000),
    feedCost: clampInt(base.feedCost, 1, 100000),
    feedExp: clampInt(base.feedExp, 1, 10000),
    watchExpPerMinute: clampInt(base.watchExpPerMinute, 0, 1000),
    dockOffsetY: clampInt(base.dockOffsetY ?? 0, 0, 800)
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
