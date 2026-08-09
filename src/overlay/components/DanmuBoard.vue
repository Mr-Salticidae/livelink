<script setup lang="ts">
// 给观众看的 OBS 弹幕信息板。只使用 transform + opacity 动画，避免在 OBS CEF
// 常驻浏览器源里启用 backdrop-filter 等高开销效果。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  buildDanmuTextShadow,
  getDanmuFontStack,
  hexToRgba,
  type DanmuBoardConfig
} from '../../shared/danmu-display'

interface BoardItem {
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

interface StoredBoardItem extends BoardItem {
  receivedAt: number
}

const props = defineProps<{
  config: DanmuBoardConfig
  previewFull?: boolean
}>()

const boardStyle = computed<Record<string, string>>(() => {
  const c = props.config
  const panelShadow =
    c.backgroundOpacity <= 0 || c.shadowStrength <= 0
      ? 'none'
      : `0 8px 24px -10px rgba(0, 0, 0, ${Math.min(0.65, 0.18 + c.shadowStrength * 0.45)})`
  return {
    '--font-family': getDanmuFontStack(c.fontFamily),
    '--font-size': `${c.fontSize}px`,
    '--font-weight': String(c.fontWeight),
    '--text-color': hexToRgba(c.textColor, c.textOpacity),
    '--muted-color': hexToRgba(c.textColor, c.textOpacity * 0.62),
    '--username-color': hexToRgba(c.usernameColor, c.textOpacity),
    '--gift-color': hexToRgba(c.giftColor, c.textOpacity),
    '--background-color': hexToRgba(c.backgroundColor, c.backgroundOpacity),
    '--panel-border': hexToRgba(c.textColor, c.backgroundOpacity > 0 ? 0.16 : 0),
    '--text-opacity': String(c.textOpacity),
    '--line-height': String(c.lineHeight),
    '--line-gap': `${c.lineGap}px`,
    '--board-radius': `${c.borderRadius}px`,
    '--animation-duration': `${c.animationDuration}ms`,
    '--text-shadow': buildDanmuTextShadow(c.shadowStrength, '#000000', c.textOpacity),
    '--username-weight': String(Math.min(900, c.fontWeight + 100)),
    '--gift-weight': String(Math.min(900, c.fontWeight + 200)),
    '--panel-shadow': panelShadow,
    '--board-width': `${c.width}px`,
    '--board-max-h': `${c.maxHeightPct}vh`
  }
})

const animationClass = computed(() => `animation-${props.config.animation}`)
const items = ref<StoredBoardItem[]>([])
const scrollEl = ref<HTMLDivElement | null>(null)
const expiryTimers = new Map<string, number>()

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

function scheduleExpiry(item: StoredBoardItem): void {
  cancelExpiry(item.id)
  const lifetimeMs = props.config.messageLifetimeSec * 1000
  if (lifetimeMs <= 0) return
  const remaining = Math.max(0, lifetimeMs - (Date.now() - item.receivedAt))
  expiryTimers.set(item.id, window.setTimeout(() => removeItem(item.id), remaining))
}

function trimToLimit(): void {
  const overflow = items.value.length - props.config.maxLines
  if (overflow <= 0) return
  const removed = items.value.splice(0, overflow)
  for (const item of removed) cancelExpiry(item.id)
}

function scrollToLatest(): void {
  void nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    el.scrollTop = props.config.messageOrder === 'newest-top' ? 0 : el.scrollHeight
  })
}

function push(item: BoardItem): void {
  if (item.kind === 'gift' && !props.config.showGift) return
  const stored: StoredBoardItem = { ...item, receivedAt: Date.now() }
  items.value.push(stored)
  trimToLimit()
  scheduleExpiry(stored)
  scrollToLatest()
}

watch(() => props.config.maxLines, trimToLimit)
watch(
  () => props.config.messageLifetimeSec,
  () => {
    for (const item of items.value) scheduleExpiry(item)
  }
)
watch(() => props.config.messageOrder, scrollToLatest)
watch(
  () => props.config.showGift,
  (showGift) => {
    if (showGift) return
    const gifts = items.value.filter((item) => item.kind === 'gift')
    items.value = items.value.filter((item) => item.kind !== 'gift')
    for (const item of gifts) cancelExpiry(item.id)
  }
)

const FAKE_NAMES = [
  '跳蛛先生', '小明', '观众007', '直播小助理', '哈基米', '摸鱼大王',
  '灯神', '糖糖', '糯米团', '一号粉丝', '打工人', '吃瓜群众', '深夜来访', '路过的'
]
const FAKE_CONTENTS = [
  '666', '主播好猛', '哈哈哈哈', '加油加油', '再来一次',
  '这波操作太秀了', '大佬带带我', '打个赏支持', '这就是直播间气氛', '弹幕板挤一挤'
]
const FAKE_GIFTS = ['辣条', '小心心', '咖啡', '打 call', '灯牌', '应援棒']

const fakeItems = computed<BoardItem[]>(() =>
  Array.from({ length: Math.max(1, props.config.maxLines) }).map((_, i) => {
    const uname = FAKE_NAMES[i % FAKE_NAMES.length]
    const isGift = props.config.showGift && i % 4 === 3
    const isAnchor = i % 5 === 0
    return isGift
      ? {
          id: `fake-${i}`,
          kind: 'gift',
          uname,
          giftName: FAKE_GIFTS[i % FAKE_GIFTS.length],
          num: 1 + (i % 5),
          guardLevel: i % 6 === 0 ? 3 : 0
        }
      : {
          id: `fake-${i}`,
          kind: 'danmu',
          uname,
          content: FAKE_CONTENTS[i % FAKE_CONTENTS.length],
          guardLevel: i % 6 === 0 ? 3 : 0,
          isAnchor,
          fansMedalLevel: isAnchor ? (i % 20) + 1 : 0
        }
  })
)

const visibleItems = computed<BoardItem[]>(() => {
  const source: BoardItem[] = props.previewFull
    ? fakeItems.value
    : items.value.filter((item) => props.config.showGift || item.kind !== 'gift')
  return props.config.messageOrder === 'newest-top' ? [...source].reverse() : source
})

function clear(): void {
  for (const timer of expiryTimers.values()) window.clearTimeout(timer)
  expiryTimers.clear()
  items.value = []
}

onBeforeUnmount(clear)
defineExpose({ push, clear })
</script>

<template>
  <div class="board" :class="animationClass" :style="boardStyle">
    <div ref="scrollEl" class="scroll">
      <div v-if="!previewFull && visibleItems.length === 0" class="placeholder">
        弹幕区 · 等待弹幕…
      </div>
      <TransitionGroup name="message-list" tag="div" class="message-list">
        <div
          v-for="i in visibleItems"
          :key="i.id"
          class="line"
          :class="{ 'line-gift': i.kind === 'gift' }"
        >
          <div class="line-body">
            <template v-if="config.showBadges">
              <span v-if="i.guardLevel && i.guardLevel > 0" class="badge badge-guard">舰</span>
              <span
                v-if="i.fansMedalLevel && i.fansMedalLevel > 0 && i.isAnchor"
                class="badge badge-fan"
              >{{ i.fansMedalLevel }}</span>
            </template>
            <span v-if="config.showUsername" class="uname">{{ i.uname }}</span>
            <template v-if="i.kind === 'danmu'">
              <span v-if="config.showUsername" class="sep">:</span>
              <span class="content">{{ i.content }}</span>
            </template>
            <template v-else>
              <span class="content">{{ config.showUsername ? ' 送 ' : '送 ' }}{{ i.giftName }} </span>
              <span class="num">×{{ i.num }}</span>
            </template>
          </div>
        </div>
      </TransitionGroup>
    </div>
    <div v-if="previewFull" class="preview-tag">装修预览 · 假弹幕</div>
  </div>
</template>

<style scoped>
.board {
  position: relative;
  width: var(--board-width, 360px);
  max-height: var(--board-max-h, 80vh);
  padding: 10px 12px;
  border: 1px solid var(--panel-border);
  border-radius: var(--board-radius, 14px);
  background: var(--background-color);
  color: var(--text-color);
  font-family: var(--font-family);
  font-size: var(--font-size, 16px);
  font-weight: var(--font-weight, 400);
  text-shadow: var(--text-shadow);
  box-shadow: var(--panel-shadow);
}
.scroll {
  max-height: calc(var(--board-max-h, 80vh) - 22px);
  overflow-y: auto;
  scrollbar-width: none;
}
.scroll::-webkit-scrollbar { display: none; }
.message-list {
  display: flex;
  flex-direction: column;
  gap: var(--line-gap, 2px);
}
.placeholder {
  padding: 6px 0;
  color: var(--muted-color);
  font-size: 0.85em;
  text-align: center;
}
.line {
  padding: 3px 0;
  line-height: var(--line-height, 1.5);
  word-break: break-word;
}
.line + .line { border-top: 1px solid var(--panel-border); }
.animation-none .line-body { animation: none; }
.animation-fade .line-body { animation: lineFadeIn var(--animation-duration) ease-out; }
.animation-slide-up .line-body { animation: lineSlideUp var(--animation-duration) cubic-bezier(0.2, 0.7, 0.2, 1); }
.animation-slide-left .line-body { animation: lineSlideLeft var(--animation-duration) cubic-bezier(0.2, 0.7, 0.2, 1); }
.animation-pop .line-body { animation: linePopIn var(--animation-duration) cubic-bezier(0.2, 0.9, 0.25, 1.2); }
@keyframes lineFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lineSlideUp { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes lineSlideLeft { from { transform: translateX(12px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes linePopIn { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.message-list-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.message-list-leave-to { opacity: 0; transform: translateY(-4px); }
.message-list-move { transition: transform 180ms ease; }
.uname { color: var(--username-color); font-weight: var(--username-weight, 500); }
.sep { margin-right: 2px; color: var(--muted-color); }
.content { color: var(--text-color); }
.line-gift .content,
.line-gift .num { color: var(--gift-color); font-weight: var(--gift-weight, 600); }
.badge {
  display: inline-block;
  margin-right: 5px;
  padding: 1px 5px;
  border-radius: 4px;
  opacity: var(--text-opacity, 1);
  font-size: 0.7em;
  font-weight: var(--gift-weight, 600);
  line-height: 1.25;
  text-shadow: none;
  vertical-align: 1px;
}
.badge-guard { background: linear-gradient(135deg, #fde68a, #f59e0b); color: #422006; }
.badge-fan { min-width: 16px; background: rgba(147, 197, 253, 0.22); color: #bfdbfe; text-align: center; }
.preview-tag {
  position: absolute;
  top: -12px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.95);
  color: #1f1300;
  font-size: 11px;
  font-weight: 700;
  text-shadow: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
@media (prefers-reduced-motion: reduce) {
  .line-body { animation: none !important; }
  .message-list-leave-active,
  .message-list-move { transition: none !important; }
}
</style>
