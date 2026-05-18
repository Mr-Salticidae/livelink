<script setup lang="ts">
// 给观众看的 OBS 弹幕信息板（区别于主播自己看的 DanmuOverlayWindow）。
// 风格：简洁清新——半透明深色 + 浅字 + backdrop blur，新弹幕从底部滑入，
// FIFO 超过 maxLines 丢最早

import { computed, nextTick, ref, watch } from 'vue'

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

const props = defineProps<{
  maxLines: number
  fontSize: number
  debugMs?: number | null
}>()

// 仅当 overlay URL 带 ?debug=1 才显示延迟读数，正常直播不受影响
const showDebug = computed(
  () => new URLSearchParams(window.location.search).get('debug') === '1'
)

const items = ref<BoardItem[]>([])
const scrollEl = ref<HTMLDivElement | null>(null)

function push(item: BoardItem): void {
  items.value.push(item)
  if (items.value.length > props.maxLines) {
    items.value.splice(0, items.value.length - props.maxLines)
  }
  void nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// maxLines 变小时立即裁剪
watch(
  () => props.maxLines,
  (n) => {
    if (items.value.length > n) items.value.splice(0, items.value.length - n)
  }
)

defineExpose({ push, clear: () => (items.value = []) })
</script>

<template>
  <div class="board" :style="{ '--font-size': fontSize + 'px' }">
    <Teleport to="body">
      <div
        v-if="showDebug"
        class="debug-badge"
        :class="{
          warn: debugMs != null && debugMs >= 1000,
          ok: debugMs != null && debugMs < 1000
        }"
      >
        延迟 {{ debugMs == null ? '—' : debugMs + 'ms' }}
      </div>
    </Teleport>
    <div ref="scrollEl" class="scroll">
      <!-- 还没弹幕时给个占位，主播开板后能立刻确认它在工作；
           一旦有弹幕进来这行自然消失，不打扰观众 -->
      <div v-if="items.length === 0" class="placeholder">弹幕区 · 等待弹幕…</div>
      <div
        v-for="i in items"
        :key="i.id"
        class="line"
        :class="{ 'line-gift': i.kind === 'gift' }"
      >
        <span v-if="i.guardLevel && i.guardLevel > 0" class="badge badge-guard">舰</span>
        <span
          v-if="i.fansMedalLevel && i.fansMedalLevel > 0 && i.isAnchor"
          class="badge badge-fan"
        >{{ i.fansMedalLevel }}</span>
        <span class="uname">{{ i.uname }}</span>
        <template v-if="i.kind === 'danmu'">
          <span class="sep">:</span>
          <span class="content">{{ i.content }}</span>
        </template>
        <template v-else>
          <span class="content"> 送 {{ i.giftName }} </span>
          <span class="num">×{{ i.num }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board {
  /* 容器：固定宽度，高度由内容决定。
     注意：刻意不用 backdrop-filter blur —— 它在 OBS 的 CEF 浏览器源里要每帧
     重采样背景视频，是常驻元素时开销巨大，直播编码抢 CPU 时会把 socket 事件
     拖慢堆积，表现为弹幕板严重延迟。改用稍实的半透明纯底 + 文字阴影保证可读。 */
  position: relative;
  width: 360px;
  max-height: 80vh;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  padding: 10px 12px;
  color: #f1f5f9;
  font-size: var(--font-size, 16px);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  box-shadow: 0 6px 20px -10px rgba(0, 0, 0, 0.4);
}
.scroll {
  max-height: 72vh;
  overflow-y: auto;
  /* 隐藏 scrollbar 视觉，保留滚动功能 */
  scrollbar-width: none;
}
.scroll::-webkit-scrollbar { display: none; }

.debug-badge {
  /* 钉死在屏幕左上角，与板子位置无关——板子可能被拖到屏幕边缘外，
     贴板子的话徽章会跟着跑出可视区。仅 ?debug=1 出现 */
  position: fixed;
  top: 6px;
  left: 6px;
  z-index: 9999;
  font-size: 14px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.92);
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
}
.debug-badge.ok { color: #4ade80; }
.debug-badge.warn { color: #f87171; }

.placeholder {
  color: #94a3b8;
  font-size: 0.85em;
  text-align: center;
  padding: 6px 0;
  opacity: 0.7;
}

.line {
  line-height: 1.5;
  word-break: break-word;
  padding: 3px 0;
  /* 进场：从底部 12px 上滑 + 渐显，0.4s ease-out。forwards 保留终态 */
  animation: lineIn 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.line + .line {
  border-top: 1px solid rgba(148, 163, 184, 0.08);
}

@keyframes lineIn {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}

.uname {
  color: #93c5fd;
  font-weight: 500;
}
.sep { color: #64748b; margin-right: 2px; }
.content { color: #e2e8f0; }

.line-gift .content { color: #fde68a; }
.line-gift .num { color: #fcd34d; font-weight: 600; }

.badge {
  display: inline-block;
  font-size: 0.7em;
  padding: 1px 5px;
  margin-right: 5px;
  border-radius: 4px;
  vertical-align: 1px;
}
.badge-guard {
  background: linear-gradient(135deg, #fde68a, #f59e0b);
  color: #422006;
  font-weight: 600;
}
.badge-fan {
  background: rgba(147, 197, 253, 0.22);
  color: #bfdbfe;
  font-weight: 600;
  min-width: 16px;
  text-align: center;
}
</style>
