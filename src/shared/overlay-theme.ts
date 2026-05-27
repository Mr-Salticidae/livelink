export type OverlayThemeId = 'classic' | 'sakura' | 'candy' | 'neon'

export interface OverlayThemeConfig {
  id: OverlayThemeId
}

export interface OverlayThemePreset {
  id: OverlayThemeId
  name: string
  desc: string
  swatches: string[]
}

export const DEFAULT_OVERLAY_THEME: OverlayThemeConfig = { id: 'sakura' }

export const OVERLAY_THEME_PRESETS: OverlayThemePreset[] = [
  {
    id: 'sakura',
    name: '樱花甜心',
    desc: '粉白、柔光、可爱系，适合聊天和陪伴感直播间',
    swatches: ['#fb7185', '#f9a8d4', '#fff7ed']
  },
  {
    id: 'candy',
    name: '糖果泡泡',
    desc: '薄荷蓝、蜜桃粉、奶油黄，活泼但不刺眼',
    swatches: ['#2dd4bf', '#f9a8d4', '#fde68a']
  },
  {
    id: 'neon',
    name: '霓虹夜场',
    desc: '紫粉电光、深色玻璃，适合游戏高能时刻',
    swatches: ['#a855f7', '#22d3ee', '#f472b6']
  },
  {
    id: 'classic',
    name: '经典简约',
    desc: '保留原本克制风格，信息密度高、不抢画面',
    swatches: ['#38bdf8', '#f59e0b', '#0f172a']
  }
]

export function normalizeOverlayThemeId(id: string | undefined): OverlayThemeId {
  return OVERLAY_THEME_PRESETS.some((theme) => theme.id === id)
    ? (id as OverlayThemeId)
    : DEFAULT_OVERLAY_THEME.id
}
