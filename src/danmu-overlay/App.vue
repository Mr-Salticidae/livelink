<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'

interface DanmuItem {
  id: string
  kind: 'danmu' | 'gift'
  uname: string
  // 弹幕：content；礼物：giftName + num
  content?: string
  giftName?: string
  num?: number
  guardLevel?: number // 1-3 大航海徽章
  isAnchor?: boolean // 本主播的牌子
  fansMedalLevel?: number
}

const MAX_ITEMS = 80 // 列表上限，超过 FIFO 丢最早的
const items = ref<DanmuItem[]>([])
const scrollEl = ref<HTMLDivElement | null>(null)
const settings = ref({ opacity: 0.85, fontSize: 14 })

const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function push(item: DanmuItem): void {
  items.value.push(item)
  if (items.value.length > MAX_ITEMS) items.value.splice(0, items.value.length - MAX_ITEMS)
  // 新事件自动滚到底，让主播总能看到最新
  void nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function closeWindow(): void {
  void window.api?.danmuOverlayClose?.()
}

let unsub: (() => void) | null = null

onMounted(() => {
  // preload 暴露的 onDanmuOverlayEvent 订阅主进程过滤后的弹幕 / 礼物事件
  const api = window.api
  if (api?.onDanmuOverlayEvent) {
    unsub = api.onDanmuOverlayEvent((evt: DanmuItem) => push(evt))
  }
  // 初始化时拉一次设置（opacity / fontSize）
  api?.getDanmuOverlaySettings?.().then((s) => {
    if (s) settings.value = s
  })
})

onBeforeUnmount(() => {
  unsub?.()
})
</script>

<template>
  <div
    class="danmu-window"
    :style="{ '--opacity': settings.opacity, '--font-size': settings.fontSize + 'px' }"
  >
    <!-- 标题栏：可拖动 + 关闭按钮 -->
    <header class="title-bar">
      <span class="title">LiveLink · 弹幕</span>
      <button class="close-btn" @click="closeWindow" title="关闭悬浮窗">×</button>
    </header>

    <!-- 滚动列表 -->
    <div ref="scrollEl" class="scroll-area">
      <div v-if="items.length === 0" class="empty">等待弹幕…</div>
      <div
        v-for="i in items"
        :key="i.id"
        class="line"
        :class="{ 'line-gift': i.kind === 'gift' }"
      >
        <span v-if="i.guardLevel && i.guardLevel > 0" class="badge badge-guard">舰</span>
        <span v-if="i.fansMedalLevel && i.fansMedalLevel > 0 && i.isAnchor" class="badge badge-fan">{{ i.fansMedalLevel }}</span>
        <span class="uname">{{ i.uname }}</span>
        <template v-if="i.kind === 'danmu'">
          <span class="sep">:</span>
          <span class="content">{{ i.content }}</span>
        </template>
        <template v-else>
          <span class="content"> 送出 {{ i.giftName }} </span>
          <span class="num">×{{ i.num }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.danmu-window {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, var(--opacity, 0.85));
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: var(--font-size, 14px);
  overflow: hidden;
}

.title-bar {
  /* 整条标题栏作为拖动区。close button 用 no-drag 排除 */
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px 0 12px;
  background: rgba(2, 6, 23, 0.5);
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  flex-shrink: 0;
  user-select: none;
}
.title {
  font-size: 12px;
  color: #94a3b8;
  letter-spacing: 0.04em;
}
.close-btn {
  -webkit-app-region: no-drag;
  background: transparent;
  border: none;
  color: #cbd5e1;
  font-size: 18px;
  line-height: 1;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
}
.close-btn:hover {
  background: rgba(244, 63, 94, 0.3);
  color: white;
}

.scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px 8px 10px;
}
.scroll-area::-webkit-scrollbar { width: 6px; }
.scroll-area::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 3px; }

.empty {
  color: #64748b;
  text-align: center;
  padding-top: 30px;
  font-size: 0.9em;
}

.line {
  line-height: 1.45;
  word-break: break-word;
  padding: 1px 0;
}
.line + .line { margin-top: 1px; }

.uname {
  color: #7dd3fc;
  font-weight: 500;
}
.sep { color: #64748b; margin-right: 2px; }
.content { color: #e2e8f0; }

.line-gift .content {
  color: #fde68a;
}
.line-gift .num {
  color: #fcd34d;
  font-weight: 600;
}

.badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 0 4px;
  margin-right: 4px;
  border-radius: 3px;
  vertical-align: 1px;
}
.badge-guard {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #422006;
  font-weight: 600;
}
.badge-fan {
  background: rgba(56, 189, 248, 0.25);
  color: #7dd3fc;
  font-weight: 600;
  min-width: 16px;
  text-align: center;
}
</style>
