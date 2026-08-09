<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_DANMU_OVERLAY_SETTINGS,
  buildDanmuTextShadow,
  getDanmuFontStack,
  hexToRgba,
  normalizeDanmuOverlaySettings,
  type DanmuOverlaySettings
} from '../shared/danmu-display'

interface DanmuItem {
  id: string
  kind: 'danmu' | 'gift'
  uname: string
  content?: string
  giftName?: string
  num?: number
  guardLevel?: number
  isAnchor?: boolean
  fansMedalLevel?: number
}

interface StoredDanmuItem extends DanmuItem {
  receivedAt: number
}

const items = ref<StoredDanmuItem[]>([])
const scrollEl = ref<HTMLDivElement | null>(null)
const settings = ref<DanmuOverlaySettings>({ ...DEFAULT_DANMU_OVERLAY_SETTINGS })
const pinned = ref(false)
const watchedText = ref('')
const expiryTimers = new Map<string, number>()

const windowStyle = computed<Record<string, string>>(() => {
  const c = settings.value
  return {
    '--font-family': getDanmuFontStack(c.fontFamily),
    '--font-size': `${c.fontSize}px`,
    '--font-weight': String(c.fontWeight),
    '--text-color': hexToRgba(c.textColor, c.textOpacity),
    '--muted-color': hexToRgba(c.textColor, c.textOpacity * 0.68),
    '--username-color': hexToRgba(c.usernameColor, c.textOpacity),
    '--gift-color': hexToRgba(c.giftColor, c.textOpacity),
    '--background-color': hexToRgba(c.backgroundColor, c.backgroundOpacity),
    '--text-opacity': String(c.textOpacity),
    '--line-height': String(c.lineHeight),
    '--line-gap': `${c.lineGap}px`,
    '--window-radius': `${c.borderRadius}px`,
    '--animation-duration': `${c.animationDuration}ms`,
    '--text-shadow': buildDanmuTextShadow(c.shadowStrength, '#000000', c.textOpacity),
    '--username-weight': String(Math.min(900, c.fontWeight + 200)),
    '--gift-weight': String(Math.min(900, c.fontWeight + 200))
  }
})

const animationClass = computed(() => `animation-${settings.value.animation}`)
const visibleItems = computed<StoredDanmuItem[]>(() => {
  const source = items.value.filter((item) => settings.value.showGift || item.kind !== 'gift')
  return settings.value.messageOrder === 'newest-top' ? [...source].reverse() : source
})

function isDanmuItem(value: unknown): value is DanmuItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DanmuItem>
  return (
    typeof item.id === 'string' &&
    (item.kind === 'danmu' || item.kind === 'gift') &&
    typeof item.uname === 'string'
  )
}

function cancelExpiry(id: string): void {
  const timer = expiryTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  expiryTimers.delete(id)
}

function removeItem(id: string): void {
  cancelExpiry(id)
  const index = items.value.findIndex((item) => item.id === id)
  if (index >= 0) items.value.splice(index, 1)
}

function scheduleExpiry(item: StoredDanmuItem): void {
  cancelExpiry(item.id)
  const lifetimeMs = settings.value.messageLifetimeSec * 1000
  if (lifetimeMs <= 0) return
  const remaining = Math.max(0, lifetimeMs - (Date.now() - item.receivedAt))
  expiryTimers.set(item.id, window.setTimeout(() => removeItem(item.id), remaining))
}

function trimToLimit(): void {
  const overflow = items.value.length - settings.value.maxLines
  if (overflow <= 0) return
  const removed = items.value.splice(0, overflow)
  for (const item of removed) cancelExpiry(item.id)
}

function scrollToLatest(): void {
  void nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    el.scrollTop = settings.value.messageOrder === 'newest-top' ? 0 : el.scrollHeight
  })
}

function push(item: DanmuItem): void {
  if (item.kind === 'gift' && !settings.value.showGift) return
  const stored: StoredDanmuItem = { ...item, receivedAt: Date.now() }
  items.value.push(stored)
  trimToLimit()
  scheduleExpiry(stored)
  scrollToLatest()
}

watch(() => settings.value.maxLines, trimToLimit)
watch(
  () => settings.value.messageLifetimeSec,
  () => {
    for (const item of items.value) scheduleExpiry(item)
  }
)
watch(() => settings.value.messageOrder, scrollToLatest)
watch(
  () => settings.value.showGift,
  (showGift) => {
    if (showGift) return
    const gifts = items.value.filter((item) => item.kind === 'gift')
    items.value = items.value.filter((item) => item.kind !== 'gift')
    for (const item of gifts) cancelExpiry(item.id)
  }
)

function closeWindow(): void {
  void window.api?.danmuOverlayClose?.()
}

function togglePin(): void {
  void window.api?.danmuOverlayPinToggle?.()
}

let unsubEvent: (() => void) | null = null
let unsubPinned: (() => void) | null = null
let unsubRoomStats: (() => void) | null = null
let unsubSettings: (() => void) | null = null
let receivedSettingsUpdate = false

onMounted(() => {
  const api = window.api
  if (api?.onDanmuOverlayEvent) {
    unsubEvent = api.onDanmuOverlayEvent((evt: unknown) => {
      if (isDanmuItem(evt)) push(evt)
    })
  }
  if (api?.onDanmuOverlayPinned) {
    unsubPinned = api.onDanmuOverlayPinned((state) => {
      pinned.value = state.pinned
    })
  }
  if (api?.onDanmuOverlayRoomStats) {
    unsubRoomStats = api.onDanmuOverlayRoomStats((stats) => {
      watchedText.value = stats.watchedText
    })
  }
  // 先订阅再拉快照，设置滑杆在子窗初始化期间变化也不会漏更新。
  if (api?.onDanmuOverlaySettings) {
    unsubSettings = api.onDanmuOverlaySettings((next) => {
      receivedSettingsUpdate = true
      settings.value = normalizeDanmuOverlaySettings(next)
    })
  }
  void api?.getDanmuOverlaySettings?.().then((next) => {
    // 拉取期间若已收到实时推送，不能再让可能较旧的快照覆盖它。
    if (next && !receivedSettingsUpdate) settings.value = normalizeDanmuOverlaySettings(next)
  })
  void api?.danmuOverlayStatus?.().then((state) => {
    if (state) pinned.value = state.pinned
  })
})

onBeforeUnmount(() => {
  unsubEvent?.()
  unsubPinned?.()
  unsubRoomStats?.()
  unsubSettings?.()
  for (const timer of expiryTimers.values()) window.clearTimeout(timer)
  expiryTimers.clear()
})

// transparent frameless 窗口在 Windows 上只可靠支持右下角缩放，四边用 Pointer Capture 补齐。
function startResize(e: PointerEvent, dir: string): void {
  const el = e.currentTarget as HTMLElement
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    // 主进程还有 15 秒兜底停止器。
  }
  const onUp = (): void => {
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    window.removeEventListener('pointerup', onUp)
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      // 已释放则忽略。
    }
    void window.api?.danmuOverlayResizeStop?.()
  }
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
  window.addEventListener('pointerup', onUp)
  void window.api?.danmuOverlayResizeStart?.(dir)
}
</script>

<template>
  <div class="danmu-window" :class="[{ pinned }, animationClass]" :style="windowStyle">
    <template v-if="!pinned">
      <div class="resize-handle resize-n"  @pointerdown.stop="startResize($event, 'n')"></div>
      <div class="resize-handle resize-s"  @pointerdown.stop="startResize($event, 's')"></div>
      <div class="resize-handle resize-w"  @pointerdown.stop="startResize($event, 'w')"></div>
      <div class="resize-handle resize-e"  @pointerdown.stop="startResize($event, 'e')"></div>
      <div class="resize-handle resize-nw" @pointerdown.stop="startResize($event, 'nw')"></div>
      <div class="resize-handle resize-ne" @pointerdown.stop="startResize($event, 'ne')"></div>
      <div class="resize-handle resize-sw" @pointerdown.stop="startResize($event, 'sw')"></div>
      <div class="resize-handle resize-se" @pointerdown.stop="startResize($event, 'se')"></div>
    </template>

    <header class="title-bar" :class="{ 'title-bar-pinned': pinned }">
      <span v-if="!pinned" class="title">LiveLink · 弹幕</span>
      <span v-else class="title pinned-hint" title="鼠标穿透中 · 到主窗口解开">🔒 已钉住</span>
      <span v-if="watchedText" class="watched" :title="`累计 ${watchedText} 人看过`">
        👁 {{ watchedText }}
      </span>
      <div class="title-buttons">
        <button
          class="pin-btn"
          @click="togglePin"
          :title="pinned ? '解开钉住（恢复可拖动）' : '钉住（防误触移动 / 不抢游戏焦点）'"
        >{{ pinned ? '📍' : '📌' }}</button>
        <button v-if="!pinned" class="close-btn" @click="closeWindow" title="关闭悬浮窗">×</button>
      </div>
    </header>

    <div ref="scrollEl" class="scroll-area">
      <div v-if="visibleItems.length === 0" class="empty">等待弹幕…</div>
      <TransitionGroup name="message-list" tag="div" class="message-list">
        <div
          v-for="i in visibleItems"
          :key="i.id"
          class="line"
          :class="{ 'line-gift': i.kind === 'gift' }"
        >
          <div class="line-body">
            <template v-if="settings.showBadges">
              <span v-if="i.guardLevel && i.guardLevel > 0" class="badge badge-guard">舰</span>
              <span
                v-if="i.fansMedalLevel && i.fansMedalLevel > 0 && i.isAnchor"
                class="badge badge-fan"
              >{{ i.fansMedalLevel }}</span>
            </template>
            <span v-if="settings.showUsername" class="uname">{{ i.uname }}</span>
            <template v-if="i.kind === 'danmu'">
              <span v-if="settings.showUsername" class="sep">:</span>
              <span class="content">{{ i.content }}</span>
            </template>
            <template v-else>
              <span class="content">{{ settings.showUsername ? ' 送出 ' : '送出 ' }}{{ i.giftName }} </span>
              <span class="num">×{{ i.num }}</span>
            </template>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.danmu-window {
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border-radius: var(--window-radius, 0);
  background: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-family);
  font-size: var(--font-size, 14px);
  font-weight: var(--font-weight, 600);
  text-shadow: var(--text-shadow);
}
.title-bar {
  -webkit-app-region: drag;
  height: 24px;
  padding: 0 4px 0 8px;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  user-select: none;
  opacity: 0.28;
  transition: opacity 0.18s ease;
}
.danmu-window:hover .title-bar { opacity: 1; }
.title-bar-pinned { -webkit-app-region: no-drag; opacity: 0.9; }
.title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--muted-color);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pinned-hint { color: var(--gift-color); font-weight: 700; opacity: 1; }
.watched {
  margin: 0 6px;
  flex-shrink: 0;
  color: var(--username-color);
  font-size: 11px;
  white-space: nowrap;
}
.title-buttons { -webkit-app-region: no-drag; display: flex; align-items: center; gap: 2px; }
.pin-btn,
.close-btn {
  -webkit-app-region: no-drag;
  width: 20px;
  height: 18px;
  border: none;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.45);
  color: #e2e8f0;
  line-height: 1;
  cursor: pointer;
}
.pin-btn { font-size: 12px; }
.close-btn { font-size: 16px; }
.pin-btn:hover { background: rgba(148, 163, 184, 0.45); }
.close-btn:hover { background: rgba(244, 63, 94, 0.6); color: white; }
.scroll-area { flex: 1; overflow-y: auto; padding: 4px 8px 8px; }
.scroll-area::-webkit-scrollbar { width: 5px; }
.scroll-area::-webkit-scrollbar-track { background: transparent; }
.scroll-area::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.danmu-window:hover .scroll-area::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.35); }
.message-list { display: flex; flex-direction: column; gap: var(--line-gap, 2px); }
.empty { padding-top: 30px; color: var(--muted-color); font-size: 0.9em; text-align: center; }
.line {
  padding: 1px 0;
  line-height: var(--line-height, 1.5);
  word-break: break-word;
}
.animation-none .line-body { animation: none; }
.animation-fade .line-body { animation: lineFadeIn var(--animation-duration) ease-out; }
.animation-slide-up .line-body { animation: lineSlideUp var(--animation-duration) ease-out; }
.animation-slide-left .line-body { animation: lineSlideLeft var(--animation-duration) ease-out; }
.animation-pop .line-body { animation: linePopIn var(--animation-duration) cubic-bezier(0.2, 0.9, 0.25, 1.2); }
@keyframes lineFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lineSlideUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lineSlideLeft { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
@keyframes linePopIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
.message-list-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.message-list-leave-to { opacity: 0; transform: translateY(-4px); }
.message-list-move { transition: transform 180ms ease; }
.uname { color: var(--username-color); font-weight: var(--username-weight, 700); }
.sep { margin-right: 2px; color: var(--muted-color); }
.content { color: var(--text-color); }
.line-gift .content,
.line-gift .num { color: var(--gift-color); font-weight: var(--gift-weight, 700); }
.badge {
  margin-right: 4px;
  padding: 0 4px;
  display: inline-block;
  border-radius: 3px;
  opacity: var(--text-opacity, 1);
  font-size: 0.72em;
  font-weight: var(--gift-weight, 700);
  line-height: 1.3;
  text-shadow: none;
  vertical-align: 1px;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
.badge-guard { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #422006; }
.badge-fan { min-width: 16px; background: rgba(37, 99, 235, 0.92); color: #fff; text-align: center; }
.resize-handle { -webkit-app-region: no-drag; position: fixed; z-index: 9999; }
.resize-n  { top: 0;    left: 6px;  right: 6px;  height: 5px; cursor: n-resize; }
.resize-s  { bottom: 0; left: 6px;  right: 6px;  height: 5px; cursor: s-resize; }
.resize-w  { left: 0;   top: 6px;   bottom: 6px; width: 5px;  cursor: w-resize; }
.resize-e  { right: 0;  top: 6px;   bottom: 6px; width: 5px;  cursor: e-resize; }
.resize-nw { top: 0;    left: 0;    width: 8px;  height: 8px; cursor: nw-resize; }
.resize-ne { top: 0;    right: 0;   width: 8px;  height: 8px; cursor: ne-resize; }
.resize-sw { bottom: 0; left: 0;    width: 8px;  height: 8px; cursor: sw-resize; }
.resize-se { bottom: 0; right: 0;   width: 8px;  height: 8px; cursor: se-resize; }
@media (prefers-reduced-motion: reduce) {
  .line-body { animation: none !important; }
  .message-list-leave-active,
  .message-list-move { transition: none !important; }
}
</style>
