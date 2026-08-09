/**
 * 主播弹幕悬浮窗与 OBS 弹幕板共用的外观契约。
 *
 * 本模块刻意不依赖 Electron / Vue，主进程、preload 和两个 renderer 都可以安全复用。
 * 所有来自持久化配置或 IPC / Socket.IO 的值，都应先经过下方 normalize 函数。
 */

export const DANMU_FONT_OPTIONS = [
  {
    value: 'system',
    label: '系统默认',
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  },
  {
    value: 'sans',
    label: '现代黑体',
    stack: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif'
  },
  {
    value: 'rounded',
    label: '圆润黑体',
    stack: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", sans-serif'
  },
  {
    value: 'serif',
    label: '中文宋体',
    stack: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif'
  },
  {
    value: 'mono',
    label: '等宽字体',
    stack: '"JetBrains Mono", "Cascadia Code", Consolas, "Microsoft YaHei", monospace'
  }
] as const

export type DanmuFontFamily = (typeof DANMU_FONT_OPTIONS)[number]['value']

export const DANMU_FONT_WEIGHT_OPTIONS = [400, 500, 600, 700, 800, 900] as const
export type DanmuFontWeight = (typeof DANMU_FONT_WEIGHT_OPTIONS)[number]

export const DANMU_ANIMATION_OPTIONS = [
  { value: 'none', label: '无动画' },
  { value: 'fade', label: '淡入' },
  { value: 'slide-up', label: '向上滑入' },
  { value: 'slide-left', label: '从右滑入' },
  { value: 'pop', label: '弹性出现' }
] as const

export type DanmuAnimation = (typeof DANMU_ANIMATION_OPTIONS)[number]['value']

export const DANMU_MESSAGE_ORDER_OPTIONS = [
  { value: 'newest-bottom', label: '最新消息在底部' },
  { value: 'newest-top', label: '最新消息在顶部' }
] as const

export type DanmuMessageOrder = (typeof DANMU_MESSAGE_ORDER_OPTIONS)[number]['value']

export interface DanmuAppearanceConfig {
  fontFamily: DanmuFontFamily
  fontSize: number
  fontWeight: DanmuFontWeight
  textColor: string
  textOpacity: number
  usernameColor: string
  giftColor: string
  backgroundColor: string
  backgroundOpacity: number
  lineHeight: number
  lineGap: number
  shadowStrength: number
  borderRadius: number
  animation: DanmuAnimation
  /** 单条消息入场动画时长，单位 ms。 */
  animationDuration: number
  messageOrder: DanmuMessageOrder
  /** 0 表示不按时间自动移除。 */
  messageLifetimeSec: number
  showUsername: boolean
  showBadges: boolean
}

/** 主播自己看的独立弹幕悬浮窗设置。 */
export interface DanmuOverlaySettings extends DanmuAppearanceConfig {
  maxLines: number
  showGift: boolean
}

export interface DanmuBoardPosition {
  /** 0-100；采用对齐百分比语义，0 贴左、100 贴右。 */
  x: number
  /** 0-100；采用对齐百分比语义，0 贴上、100 贴下。 */
  y: number
}

/** 给观众看的 OBS 弹幕信息板设置。 */
export interface DanmuBoardConfig extends DanmuAppearanceConfig {
  enabled: boolean
  position: DanmuBoardPosition
  maxLines: number
  showGift: boolean
  width: number
  maxHeightPct: number
}

export const DANMU_APPEARANCE_LIMITS = {
  fontSize: { min: 10, max: 64 },
  textOpacity: { min: 0, max: 1 },
  backgroundOpacity: { min: 0, max: 1 },
  lineHeight: { min: 1, max: 2.4 },
  lineGap: { min: 0, max: 32 },
  shadowStrength: { min: 0, max: 1 },
  borderRadius: { min: 0, max: 48 },
  animationDuration: { min: 0, max: 2000 },
  messageLifetimeSec: { min: 0, max: 300 }
} as const

export const DANMU_OVERLAY_LIMITS = {
  maxLines: { min: 5, max: 100 }
} as const

export const DANMU_BOARD_LIMITS = {
  position: { min: 0, max: 100 },
  maxLines: { min: 5, max: 30 },
  width: { min: 240, max: 960 },
  maxHeightPct: { min: 20, max: 95 }
} as const

export const DEFAULT_DANMU_APPEARANCE: Readonly<DanmuAppearanceConfig> = {
  fontFamily: 'system',
  fontSize: 16,
  fontWeight: 400,
  textColor: '#f8fafc',
  textOpacity: 1,
  usernameColor: '#7dd3fc',
  giftColor: '#fde047',
  backgroundColor: '#0f172a',
  backgroundOpacity: 0.72,
  lineHeight: 1.5,
  lineGap: 0,
  shadowStrength: 0.55,
  borderRadius: 14,
  animation: 'slide-up',
  animationDuration: 400,
  messageOrder: 'newest-bottom',
  messageLifetimeSec: 0,
  showUsername: true,
  showBadges: true
}

export const DEFAULT_DANMU_OVERLAY_SETTINGS: Readonly<DanmuOverlaySettings> = {
  ...DEFAULT_DANMU_APPEARANCE,
  fontSize: 14,
  fontWeight: 500,
  backgroundOpacity: 0,
  lineGap: 2,
  borderRadius: 0,
  shadowStrength: 1,
  animationDuration: 350,
  maxLines: 80,
  showGift: true
}

export const DEFAULT_DANMU_BOARD_CONFIG: Readonly<DanmuBoardConfig> = {
  ...DEFAULT_DANMU_APPEARANCE,
  // 与升级前 OBS 弹幕板的静态 CSS 保持接近，老用户未调参时不会突然换风格。
  fontFamily: 'sans',
  textColor: '#e2e8f0',
  usernameColor: '#93c5fd',
  giftColor: '#fde68a',
  shadowStrength: 0.2,
  enabled: false,
  position: { x: 2, y: 76 },
  maxLines: 10,
  showGift: true,
  width: 360,
  maxHeightPct: 80
}

export type DanmuStylePresetId = 'transparent' | 'glass' | 'high-contrast'

export interface DanmuStylePreset {
  id: DanmuStylePresetId
  name: string
  description: string
  appearance: DanmuAppearanceConfig
}

/** 三套开箱即用的样式；业务层可将 appearance 合并进任一端的完整设置。 */
export const DANMU_STYLE_PRESETS: readonly DanmuStylePreset[] = [
  {
    id: 'transparent',
    name: '透明描边',
    description: '完全透出游戏画面，用强描边保证亮暗场景都清晰。',
    appearance: {
      ...DEFAULT_DANMU_APPEARANCE,
      fontWeight: 600,
      backgroundOpacity: 0,
      borderRadius: 0,
      shadowStrength: 1
    }
  },
  {
    id: 'glass',
    name: '轻雾玻璃',
    description: '克制的深色半透明底，适合聊天与综合直播。',
    appearance: {
      ...DEFAULT_DANMU_APPEARANCE
    }
  },
  {
    id: 'high-contrast',
    name: '高对比',
    description: '更粗文字与更深底色，适合高速游戏和复杂画面。',
    appearance: {
      ...DEFAULT_DANMU_APPEARANCE,
      fontWeight: 700,
      textColor: '#ffffff',
      usernameColor: '#67e8f9',
      giftColor: '#facc15',
      backgroundColor: '#020617',
      backgroundOpacity: 0.9,
      lineHeight: 1.6,
      lineGap: 4,
      shadowStrength: 0.85,
      borderRadius: 8,
      animation: 'fade',
      animationDuration: 250
    }
  }
]

type UnknownRecord = Record<string, unknown>

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const FONT_FAMILIES = new Set<DanmuFontFamily>(DANMU_FONT_OPTIONS.map((option) => option.value))
const FONT_WEIGHTS = new Set<number>(DANMU_FONT_WEIGHT_OPTIONS)
const ANIMATIONS = new Set<DanmuAnimation>(DANMU_ANIMATION_OPTIONS.map((option) => option.value))
const MESSAGE_ORDERS = new Set<DanmuMessageOrder>(
  DANMU_MESSAGE_ORDER_OPTIONS.map((option) => option.value)
)

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

/** 非有限数和非 number 类型回退；不会把空字符串等隐式转换成数字。 */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  const safeFallback = Number.isFinite(fallback)
    ? Math.max(lower, Math.min(upper, fallback))
    : lower
  if (typeof value !== 'number' || !Number.isFinite(value)) return safeFallback
  return Math.max(lower, Math.min(upper, value))
}

/** clampNumber 的整数版本；有效小数按四舍五入处理。 */
export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const roundedFallback = Number.isFinite(fallback) ? Math.round(fallback) : Math.round(min)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.round(clampNumber(roundedFallback, min, max, roundedFallback))
  }
  return Math.round(clampNumber(Math.round(value), min, max, roundedFallback))
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

/** 仅接受 #RRGGBB，统一输出小写；非法值使用一个同样经过校验的 fallback。 */
export function normalizeHexColor(value: unknown, fallback = '#ffffff'): string {
  const safeFallback = isHexColor(fallback) ? fallback.toLowerCase() : '#ffffff'
  return isHexColor(value) ? value.toLowerCase() : safeFallback
}

/** 将严格的 #RRGGBB 转成可直接用于 CSS 的 rgba()。 */
export function hexToRgba(hex: unknown, alpha: unknown = 1, fallback = '#000000'): string {
  const safeHex = normalizeHexColor(hex, normalizeHexColor(fallback, '#000000'))
  const safeAlpha = clampNumber(alpha, 0, 1, 1)
  const r = Number.parseInt(safeHex.slice(1, 3), 16)
  const g = Number.parseInt(safeHex.slice(3, 5), 16)
  const b = Number.parseInt(safeHex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${formatCssNumber(safeAlpha)})`
}

export function getDanmuFontStack(fontFamily: unknown): string {
  const family = FONT_FAMILIES.has(fontFamily as DanmuFontFamily)
    ? (fontFamily as DanmuFontFamily)
    : DEFAULT_DANMU_APPEARANCE.fontFamily
  return DANMU_FONT_OPTIONS.find((option) => option.value === family)!.stack
}

/**
 * 生成多层、无 spread 的 CSS text-shadow。strength=0 返回 none；1 接近主播窗原强描边。
 */
export function buildDanmuTextShadow(
  strength: unknown,
  color: unknown = '#000000',
  textOpacity: unknown = 1
): string {
  const value = clampNumber(strength, 0, 1, DEFAULT_DANMU_APPEARANCE.shadowStrength)
  const opacity = clampNumber(textOpacity, 0, 1, 1)
  if (value === 0 || opacity === 0) return 'none'

  const safeColor = normalizeHexColor(color, '#000000')
  const tightBlur = formatCssNumber(1 + value * 1.5)
  const glowBlur = formatCssNumber(3 + value * 3)
  const tightAlpha = (0.35 + value * 0.6) * opacity
  const glowAlpha = (0.18 + value * 0.42) * opacity
  const edgeAlpha = (0.28 + value * 0.62) * opacity

  return [
    `0 0 ${tightBlur}px ${hexToRgba(safeColor, tightAlpha)}`,
    `0 0 ${glowBlur}px ${hexToRgba(safeColor, glowAlpha)}`,
    `1px 1px ${tightBlur}px ${hexToRgba(safeColor, edgeAlpha)}`,
    `-1px -1px ${tightBlur}px ${hexToRgba(safeColor, edgeAlpha)}`,
    `1px -1px ${tightBlur}px ${hexToRgba(safeColor, edgeAlpha)}`,
    `-1px 1px ${tightBlur}px ${hexToRgba(safeColor, edgeAlpha)}`
  ].join(', ')
}

function formatCssNumber(value: number): string {
  return String(Number(value.toFixed(3)))
}

function clampPrecision(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  decimals: number
): number {
  const safe = clampNumber(value, min, max, fallback)
  const factor = 10 ** decimals
  return Math.round(safe * factor) / factor
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeFontFamily(value: unknown, fallback: DanmuFontFamily): DanmuFontFamily {
  return FONT_FAMILIES.has(value as DanmuFontFamily) ? (value as DanmuFontFamily) : fallback
}

function normalizeFontWeight(value: unknown, fallback: DanmuFontWeight): DanmuFontWeight {
  return FONT_WEIGHTS.has(value as number) ? (value as DanmuFontWeight) : fallback
}

function normalizeAnimation(value: unknown, fallback: DanmuAnimation): DanmuAnimation {
  return ANIMATIONS.has(value as DanmuAnimation) ? (value as DanmuAnimation) : fallback
}

function normalizeMessageOrder(value: unknown, fallback: DanmuMessageOrder): DanmuMessageOrder {
  return MESSAGE_ORDERS.has(value as DanmuMessageOrder)
    ? (value as DanmuMessageOrder)
    : fallback
}

function normalizeAppearanceRecord(
  source: UnknownRecord,
  fallback: Readonly<DanmuAppearanceConfig>
): DanmuAppearanceConfig {
  const limits = DANMU_APPEARANCE_LIMITS
  return {
    fontFamily: normalizeFontFamily(source.fontFamily, fallback.fontFamily),
    fontSize: clampInteger(
      source.fontSize,
      limits.fontSize.min,
      limits.fontSize.max,
      fallback.fontSize
    ),
    fontWeight: normalizeFontWeight(source.fontWeight, fallback.fontWeight),
    textColor: normalizeHexColor(source.textColor, fallback.textColor),
    textOpacity: clampPrecision(
      source.textOpacity,
      limits.textOpacity.min,
      limits.textOpacity.max,
      fallback.textOpacity,
      2
    ),
    usernameColor: normalizeHexColor(source.usernameColor, fallback.usernameColor),
    giftColor: normalizeHexColor(source.giftColor, fallback.giftColor),
    backgroundColor: normalizeHexColor(source.backgroundColor, fallback.backgroundColor),
    backgroundOpacity: clampPrecision(
      source.backgroundOpacity,
      limits.backgroundOpacity.min,
      limits.backgroundOpacity.max,
      fallback.backgroundOpacity,
      2
    ),
    lineHeight: clampPrecision(
      source.lineHeight,
      limits.lineHeight.min,
      limits.lineHeight.max,
      fallback.lineHeight,
      2
    ),
    lineGap: clampInteger(
      source.lineGap,
      limits.lineGap.min,
      limits.lineGap.max,
      fallback.lineGap
    ),
    shadowStrength: clampPrecision(
      source.shadowStrength,
      limits.shadowStrength.min,
      limits.shadowStrength.max,
      fallback.shadowStrength,
      2
    ),
    borderRadius: clampInteger(
      source.borderRadius,
      limits.borderRadius.min,
      limits.borderRadius.max,
      fallback.borderRadius
    ),
    animation: normalizeAnimation(source.animation, fallback.animation),
    animationDuration: clampInteger(
      source.animationDuration,
      limits.animationDuration.min,
      limits.animationDuration.max,
      fallback.animationDuration
    ),
    messageOrder: normalizeMessageOrder(source.messageOrder, fallback.messageOrder),
    messageLifetimeSec: clampInteger(
      source.messageLifetimeSec,
      limits.messageLifetimeSec.min,
      limits.messageLifetimeSec.max,
      fallback.messageLifetimeSec
    ),
    showUsername: normalizeBoolean(source.showUsername, fallback.showUsername),
    showBadges: normalizeBoolean(source.showBadges, fallback.showBadges)
  }
}

export function normalizeDanmuAppearanceConfig(
  value: unknown,
  fallback: Readonly<DanmuAppearanceConfig> = DEFAULT_DANMU_APPEARANCE
): DanmuAppearanceConfig {
  const safeFallback = normalizeAppearanceRecord(asRecord(fallback), DEFAULT_DANMU_APPEARANCE)
  return normalizeAppearanceRecord(asRecord(value), safeFallback)
}

function normalizeOverlayRecord(
  source: UnknownRecord,
  fallback: Readonly<DanmuOverlaySettings>
): DanmuOverlaySettings {
  return {
    ...normalizeAppearanceRecord(source, fallback),
    maxLines: clampInteger(
      source.maxLines,
      DANMU_OVERLAY_LIMITS.maxLines.min,
      DANMU_OVERLAY_LIMITS.maxLines.max,
      fallback.maxLines
    ),
    showGift: normalizeBoolean(source.showGift, fallback.showGift)
  }
}

export function normalizeDanmuOverlaySettings(
  value: unknown,
  fallback: Readonly<DanmuOverlaySettings> = DEFAULT_DANMU_OVERLAY_SETTINGS
): DanmuOverlaySettings {
  const safeFallback = normalizeOverlayRecord(asRecord(fallback), DEFAULT_DANMU_OVERLAY_SETTINGS)
  return normalizeOverlayRecord(asRecord(value), safeFallback)
}

export function normalizeDanmuBoardPosition(
  value: unknown,
  fallback: Readonly<DanmuBoardPosition> = DEFAULT_DANMU_BOARD_CONFIG.position
): DanmuBoardPosition {
  const source = asRecord(value)
  const fallbackSource = asRecord(fallback)
  const min = DANMU_BOARD_LIMITS.position.min
  const max = DANMU_BOARD_LIMITS.position.max
  const fallbackX = clampPrecision(
    fallbackSource.x,
    min,
    max,
    DEFAULT_DANMU_BOARD_CONFIG.position.x,
    2
  )
  const fallbackY = clampPrecision(
    fallbackSource.y,
    min,
    max,
    DEFAULT_DANMU_BOARD_CONFIG.position.y,
    2
  )
  return {
    x: clampPrecision(source.x, min, max, fallbackX, 2),
    y: clampPrecision(source.y, min, max, fallbackY, 2)
  }
}

function normalizeBoardRecord(
  source: UnknownRecord,
  fallback: Readonly<DanmuBoardConfig>
): DanmuBoardConfig {
  return {
    ...normalizeAppearanceRecord(source, fallback),
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    position: normalizeDanmuBoardPosition(source.position, fallback.position),
    maxLines: clampInteger(
      source.maxLines,
      DANMU_BOARD_LIMITS.maxLines.min,
      DANMU_BOARD_LIMITS.maxLines.max,
      fallback.maxLines
    ),
    showGift: normalizeBoolean(source.showGift, fallback.showGift),
    width: clampInteger(
      source.width,
      DANMU_BOARD_LIMITS.width.min,
      DANMU_BOARD_LIMITS.width.max,
      fallback.width
    ),
    maxHeightPct: clampInteger(
      source.maxHeightPct,
      DANMU_BOARD_LIMITS.maxHeightPct.min,
      DANMU_BOARD_LIMITS.maxHeightPct.max,
      fallback.maxHeightPct
    )
  }
}

export function normalizeDanmuBoardConfig(
  value: unknown,
  fallback: Readonly<DanmuBoardConfig> = DEFAULT_DANMU_BOARD_CONFIG
): DanmuBoardConfig {
  const safeFallback = normalizeBoardRecord(asRecord(fallback), DEFAULT_DANMU_BOARD_CONFIG)
  return normalizeBoardRecord(asRecord(value), safeFallback)
}

export function normalizeDanmuStylePresetId(value: unknown): DanmuStylePresetId {
  return DANMU_STYLE_PRESETS.some((preset) => preset.id === value)
    ? (value as DanmuStylePresetId)
    : 'glass'
}

/** 返回一个可安全修改的 preset 副本，避免 UI 意外污染全局常量。 */
export function getDanmuStylePreset(value: unknown): DanmuStylePreset {
  const id = normalizeDanmuStylePresetId(value)
  const preset = DANMU_STYLE_PRESETS.find((candidate) => candidate.id === id)!
  return { ...preset, appearance: { ...preset.appearance } }
}
