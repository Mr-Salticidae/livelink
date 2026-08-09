<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import {
  DANMU_ANIMATION_OPTIONS,
  DANMU_APPEARANCE_LIMITS,
  DANMU_FONT_OPTIONS,
  DANMU_FONT_WEIGHT_OPTIONS,
  DANMU_MESSAGE_ORDER_OPTIONS,
  DANMU_STYLE_PRESETS,
  buildDanmuTextShadow,
  getDanmuFontStack,
  hexToRgba,
  type DanmuAppearanceConfig
} from '../../shared/danmu-display'

const props = withDefaults(
  defineProps<{
    modelValue: DanmuAppearanceConfig
    defaults: DanmuAppearanceConfig
    usernameWeightOffset?: number
    giftWeightOffset?: number
  }>(),
  {
    usernameWeightOffset: 100,
    giftWeightOffset: 200
  }
)

const emit = defineEmits<{
  patch: [patch: Partial<DanmuAppearanceConfig>]
}>()

const APPEARANCE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'textColor',
  'textOpacity',
  'usernameColor',
  'giftColor',
  'backgroundColor',
  'backgroundOpacity',
  'lineHeight',
  'lineGap',
  'shadowStrength',
  'borderRadius',
  'animation',
  'animationDuration',
  'messageOrder',
  'messageLifetimeSec',
  'showUsername',
  'showBadges'
] as const satisfies readonly (keyof DanmuAppearanceConfig)[]

type NumericAppearanceKey = {
  [Key in keyof DanmuAppearanceConfig]: DanmuAppearanceConfig[Key] extends number ? Key : never
}[keyof DanmuAppearanceConfig]

type ColorAppearanceKey =
  | 'textColor'
  | 'usernameColor'
  | 'giftColor'
  | 'backgroundColor'

interface RangeControl {
  key: NumericAppearanceKey
  label: string
  hint: string
  min: number
  max: number
  step: number
  format: 'px' | 'percent' | 'ratio' | 'ms' | 'seconds'
}

const COLOR_CONTROLS: readonly {
  key: ColorAppearanceKey
  label: string
  hint: string
}[] = [
  { key: 'textColor', label: '正文', hint: '普通弹幕文字' },
  { key: 'usernameColor', label: '昵称', hint: '用户名强调色' },
  { key: 'giftColor', label: '礼物', hint: '礼物事件文字' },
  { key: 'backgroundColor', label: '背景', hint: '弹幕区域底色' }
]

const TEXT_RANGE_CONTROLS: readonly RangeControl[] = [
  {
    key: 'textOpacity',
    label: '文字透明度',
    hint: '正文、昵称与礼物文字统一生效',
    ...DANMU_APPEARANCE_LIMITS.textOpacity,
    step: 0.05,
    format: 'percent'
  },
  {
    key: 'backgroundOpacity',
    label: '背景透明度',
    hint: '设为 0 可获得纯描边弹幕',
    ...DANMU_APPEARANCE_LIMITS.backgroundOpacity,
    step: 0.05,
    format: 'percent'
  }
]

const LAYOUT_RANGE_CONTROLS: readonly RangeControl[] = [
  {
    key: 'lineHeight',
    label: '行高',
    hint: '多行弹幕的文字呼吸感',
    ...DANMU_APPEARANCE_LIMITS.lineHeight,
    step: 0.05,
    format: 'ratio'
  },
  {
    key: 'lineGap',
    label: '消息间距',
    hint: '相邻两条弹幕之间的距离',
    ...DANMU_APPEARANCE_LIMITS.lineGap,
    step: 1,
    format: 'px'
  },
  {
    key: 'shadowStrength',
    label: '文字阴影 / 描边',
    hint: '复杂画面建议保持在 60% 以上',
    ...DANMU_APPEARANCE_LIMITS.shadowStrength,
    step: 0.05,
    format: 'percent'
  },
  {
    key: 'borderRadius',
    label: '背景圆角',
    hint: '设为 0 可获得硬朗直角风格',
    ...DANMU_APPEARANCE_LIMITS.borderRadius,
    step: 1,
    format: 'px'
  }
]

const MOTION_RANGE_CONTROLS: readonly RangeControl[] = [
  {
    key: 'animationDuration',
    label: '入场动画时长',
    hint: '200–400ms 通常最自然',
    ...DANMU_APPEARANCE_LIMITS.animationDuration,
    step: 50,
    format: 'ms'
  },
  {
    key: 'messageLifetimeSec',
    label: '消息停留时间',
    hint: '0 表示不按时间自动隐藏',
    ...DANMU_APPEARANCE_LIMITS.messageLifetimeSec,
    step: 5,
    format: 'seconds'
  }
]

const PREVIEW_MESSAGES = [
  {
    id: 'welcome',
    badge: '粉丝团 12',
    username: '小风铃',
    content: '今晚的画面也太舒服了！',
    gift: false
  },
  {
    id: 'chat',
    badge: '舰长',
    username: '星河旅人',
    content: '这波操作满分，稳稳拿下 ✨',
    gift: false
  },
  {
    id: 'gift',
    badge: '提督',
    username: '橘子汽水',
    content: '赠送了 醒目留言 × 1',
    gift: true
  }
] as const

function pickAppearance(source: DanmuAppearanceConfig): DanmuAppearanceConfig {
  const result = {} as DanmuAppearanceConfig
  for (const key of APPEARANCE_KEYS) {
    ;(result[key] as DanmuAppearanceConfig[typeof key]) = source[key]
  }
  return result
}

const local = ref<DanmuAppearanceConfig>(pickAppearance(props.modelValue))
const previewKey = ref(0)
let pendingPatch: Partial<DanmuAppearanceConfig> = {}
let emitTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.modelValue,
  (value) => {
    // 父级回写期间保留尚未发出的滑杆值，避免拖动中途发生视觉回跳。
    local.value = { ...pickAppearance(value), ...pendingPatch }
  },
  { deep: true }
)

function flushPatch(): void {
  if (emitTimer !== undefined) {
    clearTimeout(emitTimer)
    emitTimer = undefined
  }
  if (Object.keys(pendingPatch).length === 0) return
  const patch = { ...pendingPatch }
  pendingPatch = {}
  emit('patch', patch)
}

function applyPatch(patch: Partial<DanmuAppearanceConfig>, debounce = false): void {
  Object.assign(local.value, patch)
  pendingPatch = { ...pendingPatch, ...patch }

  if ('animation' in patch || 'animationDuration' in patch) previewKey.value += 1

  if (!debounce) {
    flushPatch()
    return
  }

  if (emitTimer !== undefined) clearTimeout(emitTimer)
  emitTimer = setTimeout(flushPatch, 80)
}

function updateNumber(key: NumericAppearanceKey, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  applyPatch({ [key]: value } as Partial<DanmuAppearanceConfig>, true)
}

function updateColor(key: ColorAppearanceKey, event: Event): void {
  applyPatch({ [key]: (event.target as HTMLInputElement).value }, true)
}

function updateFontFamily(event: Event): void {
  applyPatch({
    fontFamily: (event.target as HTMLSelectElement)
      .value as DanmuAppearanceConfig['fontFamily']
  })
}

function updateFontWeight(event: Event): void {
  applyPatch({
    fontWeight: Number(
      (event.target as HTMLSelectElement).value
    ) as DanmuAppearanceConfig['fontWeight']
  })
}

function updateAnimation(event: Event): void {
  applyPatch({
    animation: (event.target as HTMLSelectElement).value as DanmuAppearanceConfig['animation']
  })
}

function updateMessageOrder(event: Event): void {
  applyPatch({
    messageOrder: (event.target as HTMLSelectElement)
      .value as DanmuAppearanceConfig['messageOrder']
  })
}

function toggle(key: 'showUsername' | 'showBadges'): void {
  applyPatch({ [key]: !local.value[key] } as Partial<DanmuAppearanceConfig>)
}

function selectPreset(index: number): void {
  const preset = DANMU_STYLE_PRESETS[index]
  if (!preset) return
  applyPatch(pickAppearance(preset.appearance))
}

function restoreDefaults(): void {
  applyPatch(pickAppearance(props.defaults))
}

function matchesAppearance(candidate: DanmuAppearanceConfig): boolean {
  return APPEARANCE_KEYS.every((key) => local.value[key] === candidate[key])
}

function formatRangeValue(control: RangeControl): string {
  const value = Number(local.value[control.key])
  if (control.format === 'percent') return `${Math.round(value * 100)}%`
  if (control.format === 'ratio') return `${value.toFixed(2).replace(/0$/, '')}×`
  if (control.format === 'seconds') return value === 0 ? '永久' : `${value} 秒`
  return `${value}${control.format === 'px' ? 'px' : 'ms'}`
}

const previewMessages = computed(() =>
  local.value.messageOrder === 'newest-top'
    ? [...PREVIEW_MESSAGES].reverse()
    : [...PREVIEW_MESSAGES]
)

const previewContainerStyle = computed<CSSProperties>(
  () =>
    ({
      fontFamily: getDanmuFontStack(local.value.fontFamily),
      fontSize: `${local.value.fontSize}px`,
      fontWeight: local.value.fontWeight,
      gap: `${local.value.lineGap}px`,
      padding: '10px 12px',
      backgroundColor: hexToRgba(local.value.backgroundColor, local.value.backgroundOpacity),
      borderRadius: `${local.value.borderRadius}px`,
      '--danmu-preview-duration': `${local.value.animationDuration}ms`
    }) as CSSProperties
)

const previewRowStyle = computed<CSSProperties>(() => ({
  lineHeight: local.value.lineHeight,
  textShadow: buildDanmuTextShadow(
    local.value.shadowStrength,
    '#000000',
    local.value.textOpacity
  )
}))

const bodyTextStyle = computed<CSSProperties>(() => ({
  color: hexToRgba(local.value.textColor, local.value.textOpacity)
}))

const usernameStyle = computed<CSSProperties>(() => ({
  color: hexToRgba(local.value.usernameColor, local.value.textOpacity),
  fontWeight: Math.min(900, local.value.fontWeight + props.usernameWeightOffset)
}))

const giftStyle = computed<CSSProperties>(() => ({
  color: hexToRgba(local.value.giftColor, local.value.textOpacity),
  fontWeight: Math.min(900, local.value.fontWeight + props.giftWeightOffset)
}))

const animationClass = computed(() => `danmu-preview-enter--${local.value.animation}`)

onBeforeUnmount(flushPatch)
</script>

<template>
  <div class="space-y-5">
    <section class="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
      <div class="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <p class="text-xs font-medium text-slate-200">本地即时预览</p>
          <p class="mt-0.5 text-[11px] text-slate-500">设置会同时决定真实弹幕的视觉效果</p>
        </div>
        <button
          type="button"
          class="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-400 transition hover:border-sky-500 hover:text-slate-200"
          @click="previewKey += 1"
        >
          重播动画
        </button>
      </div>

      <div class="danmu-preview-stage relative min-h-[230px] overflow-hidden p-4 sm:p-5">
        <div class="pointer-events-none absolute inset-0 bg-slate-950/10"></div>
        <div
          :key="previewKey"
          class="relative flex min-h-[190px] flex-col overflow-hidden"
          :class="local.messageOrder === 'newest-top' ? 'justify-start' : 'justify-end'"
          :style="previewContainerStyle"
          aria-label="弹幕样式预览"
        >
          <div
            v-for="message in previewMessages"
            :key="message.id"
            class="danmu-preview-enter max-w-full break-words py-1"
            :class="animationClass"
            :style="previewRowStyle"
          >
            <span
              v-if="local.showBadges"
              class="mr-1.5 inline-flex translate-y-[-1px] items-center rounded bg-amber-400/20 px-1.5 py-0.5 align-middle text-[0.64em] text-amber-200"
              :style="{ opacity: local.textOpacity, textShadow: 'none', fontWeight: giftStyle.fontWeight }"
            >
              {{ message.badge }}
            </span>
            <span v-if="local.showUsername" class="mr-1" :style="usernameStyle">
              {{ message.username }}:
            </span>
            <span :style="message.gift ? giftStyle : bodyTextStyle">{{ message.content }}</span>
          </div>
        </div>
      </div>
    </section>

    <fieldset>
      <legend class="ll-eyebrow mb-2">Quick Style · 一键风格</legend>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <button
          v-for="(preset, index) in DANMU_STYLE_PRESETS"
          :key="preset.id"
          type="button"
          class="rounded-xl border px-3 py-2.5 text-left transition"
          :class="
            matchesAppearance(preset.appearance)
              ? 'border-sky-500 bg-sky-500/10 text-slate-100'
              : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:border-slate-600'
          "
          :title="preset.description"
          @click="selectPreset(index)"
        >
          <span class="block text-xs font-medium">{{ preset.name }}</span>
          <span class="mt-1 block text-[10px] leading-relaxed text-slate-500">
            {{ preset.description }}
          </span>
        </button>
        <button
          type="button"
          class="rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2.5 text-left text-slate-300 transition hover:border-slate-600"
          @click="restoreDefaults"
        >
          <span class="block text-xs font-medium">恢复样式默认</span>
          <span class="mt-1 block text-[10px] leading-relaxed text-slate-500">
            仅重置本面板的外观与动画。
          </span>
        </button>
      </div>
    </fieldset>

    <fieldset class="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <legend class="px-1 text-xs font-medium text-slate-300">字体与字号</legend>
      <div class="grid gap-4 pt-1 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          字体族
          <select
            :value="local.fontFamily"
            class="ll-input mt-1.5 w-full py-1.5"
            @change="updateFontFamily"
          >
            <option v-for="font in DANMU_FONT_OPTIONS" :key="font.value" :value="font.value">
              {{ font.label }}
            </option>
          </select>
        </label>
        <label class="text-xs text-slate-400">
          字重
          <select
            :value="local.fontWeight"
            class="ll-input mt-1.5 w-full py-1.5"
            @change="updateFontWeight"
          >
            <option
              v-for="weight in DANMU_FONT_WEIGHT_OPTIONS"
              :key="weight"
              :value="weight"
            >
              {{ weight }}{{ weight >= 700 ? ' · 粗体' : weight >= 500 ? ' · 中等' : ' · 常规' }}
            </option>
          </select>
        </label>
        <label class="sm:col-span-2">
          <span class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-400">字号</span>
            <output class="tabular-nums font-mono text-[11px] text-sky-300">{{ local.fontSize }}px</output>
          </span>
          <input
            type="range"
            :min="DANMU_APPEARANCE_LIMITS.fontSize.min"
            :max="DANMU_APPEARANCE_LIMITS.fontSize.max"
            step="1"
            :value="local.fontSize"
            class="danmu-range mt-2 w-full"
            @input="updateNumber('fontSize', $event)"
          />
          <span class="mt-1 flex justify-between text-[10px] text-slate-600">
            <span>{{ DANMU_APPEARANCE_LIMITS.fontSize.min }}px</span>
            <span>{{ DANMU_APPEARANCE_LIMITS.fontSize.max }}px</span>
          </span>
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <legend class="px-1 text-xs font-medium text-slate-300">颜色与透明度</legend>
      <div class="grid gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-4">
        <label
          v-for="color in COLOR_CONTROLS"
          :key="color.key"
          class="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"
        >
          <input
            type="color"
            :value="local[color.key]"
            class="danmu-color h-9 w-9 shrink-0 cursor-pointer"
            :aria-label="`${color.label}颜色`"
            @input="updateColor(color.key, $event)"
          />
          <span class="min-w-0">
            <span class="block text-xs text-slate-300">{{ color.label }}</span>
            <span class="block truncate font-mono text-[9px] uppercase text-slate-500">
              {{ local[color.key] }} · {{ color.hint }}
            </span>
          </span>
        </label>
      </div>
      <div class="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <label v-for="control in TEXT_RANGE_CONTROLS" :key="control.key">
          <span class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-400">{{ control.label }}</span>
            <output class="tabular-nums font-mono text-[11px] text-sky-300">
              {{ formatRangeValue(control) }}
            </output>
          </span>
          <input
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="local[control.key]"
            class="danmu-range mt-2 w-full"
            @input="updateNumber(control.key, $event)"
          />
          <span class="mt-1 block text-[10px] text-slate-600">{{ control.hint }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <legend class="px-1 text-xs font-medium text-slate-300">排版细节</legend>
      <div class="grid gap-x-5 gap-y-4 pt-1 sm:grid-cols-2">
        <label v-for="control in LAYOUT_RANGE_CONTROLS" :key="control.key">
          <span class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-400">{{ control.label }}</span>
            <output class="tabular-nums font-mono text-[11px] text-sky-300">
              {{ formatRangeValue(control) }}
            </output>
          </span>
          <input
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="local[control.key]"
            class="danmu-range mt-2 w-full"
            @input="updateNumber(control.key, $event)"
          />
          <span class="mt-1 block text-[10px] text-slate-600">{{ control.hint }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <legend class="px-1 text-xs font-medium text-slate-300">动画与消息行为</legend>
      <div class="grid gap-4 pt-1 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          入场动画
          <select
            :value="local.animation"
            class="ll-input mt-1.5 w-full py-1.5"
            @change="updateAnimation"
          >
            <option
              v-for="animation in DANMU_ANIMATION_OPTIONS"
              :key="animation.value"
              :value="animation.value"
            >
              {{ animation.label }}
            </option>
          </select>
        </label>
        <label class="text-xs text-slate-400">
          最新消息方向
          <select
            :value="local.messageOrder"
            class="ll-input mt-1.5 w-full py-1.5"
            @change="updateMessageOrder"
          >
            <option
              v-for="order in DANMU_MESSAGE_ORDER_OPTIONS"
              :key="order.value"
              :value="order.value"
            >
              {{ order.label }}
            </option>
          </select>
        </label>
        <label v-for="control in MOTION_RANGE_CONTROLS" :key="control.key">
          <span class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-400">{{ control.label }}</span>
            <output class="tabular-nums font-mono text-[11px] text-sky-300">
              {{ formatRangeValue(control) }}
            </output>
          </span>
          <input
            type="range"
            :min="control.min"
            :max="control.max"
            :step="control.step"
            :value="local[control.key]"
            class="danmu-range mt-2 w-full"
            @input="updateNumber(control.key, $event)"
          />
          <span class="mt-1 block text-[10px] text-slate-600">{{ control.hint }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <legend class="px-1 text-xs font-medium text-slate-300">信息显示</legend>
      <div class="grid gap-2 pt-1 sm:grid-cols-2">
        <button
          type="button"
          role="switch"
          :aria-checked="local.showUsername"
          class="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-left"
          @click="toggle('showUsername')"
        >
          <span>
            <span class="block text-xs text-slate-300">显示用户名</span>
            <span class="mt-0.5 block text-[10px] text-slate-500">关闭后只保留弹幕正文</span>
          </span>
          <span
            class="relative h-5 w-9 shrink-0 rounded-full transition"
            :class="local.showUsername ? 'bg-sky-500' : 'bg-slate-600'"
          >
            <span
              class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition"
              :class="local.showUsername ? 'translate-x-4' : 'translate-x-0'"
            ></span>
          </span>
        </button>
        <button
          type="button"
          role="switch"
          :aria-checked="local.showBadges"
          class="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-left"
          @click="toggle('showBadges')"
        >
          <span>
            <span class="block text-xs text-slate-300">显示徽章</span>
            <span class="mt-0.5 block text-[10px] text-slate-500">粉丝牌与舰长身份标识</span>
          </span>
          <span
            class="relative h-5 w-9 shrink-0 rounded-full transition"
            :class="local.showBadges ? 'bg-sky-500' : 'bg-slate-600'"
          >
            <span
              class="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition"
              :class="local.showBadges ? 'translate-x-4' : 'translate-x-0'"
            ></span>
          </span>
        </button>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.danmu-preview-stage {
  background-color: #232437;
  background-image:
    radial-gradient(circle at 18% 22%, rgba(101, 163, 255, 0.34), transparent 30%),
    radial-gradient(circle at 82% 78%, rgba(217, 139, 255, 0.3), transparent 34%),
    linear-gradient(135deg, rgba(9, 18, 36, 0.82), rgba(36, 24, 52, 0.72));
}

.danmu-preview-enter {
  animation-duration: var(--danmu-preview-duration, 350ms);
  animation-fill-mode: both;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.danmu-preview-enter--none {
  animation: none;
}

.danmu-preview-enter--fade {
  animation-name: danmu-preview-fade;
}

.danmu-preview-enter--slide-up {
  animation-name: danmu-preview-slide-up;
}

.danmu-preview-enter--slide-left {
  animation-name: danmu-preview-slide-left;
}

.danmu-preview-enter--pop {
  animation-name: danmu-preview-pop;
  animation-timing-function: cubic-bezier(0.16, 1.35, 0.3, 1);
}

.danmu-preview-enter:nth-child(2) {
  animation-delay: 45ms;
}

.danmu-preview-enter:nth-child(3) {
  animation-delay: 90ms;
}

.danmu-range {
  height: 4px;
  cursor: pointer;
  appearance: none;
  border-radius: 999px;
  background: #2a2738;
  accent-color: #9b85ff;
}

.danmu-range::-webkit-slider-thumb {
  width: 15px;
  height: 15px;
  appearance: none;
  border: 2px solid #ece8f5;
  border-radius: 999px;
  background: #9b85ff;
  box-shadow: 0 0 0 3px rgba(155, 133, 255, 0.16);
}

.danmu-range:focus-visible {
  outline: 2px solid rgba(176, 154, 255, 0.8);
  outline-offset: 4px;
}

.danmu-color {
  overflow: hidden;
  appearance: none;
  border: 1px solid #3d3856;
  border-radius: 9px;
  background: transparent;
  padding: 0;
}

.danmu-color::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.danmu-color::-webkit-color-swatch {
  border: 0;
  border-radius: 6px;
}

@keyframes danmu-preview-fade {
  from {
    opacity: 0;
  }
}

@keyframes danmu-preview-slide-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

@keyframes danmu-preview-slide-left {
  from {
    opacity: 0;
    transform: translateX(22px);
  }
}

@keyframes danmu-preview-pop {
  from {
    opacity: 0;
    transform: scale(0.88);
  }
}

@media (prefers-reduced-motion: reduce) {
  .danmu-preview-enter {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
  }
}
</style>
