<script setup lang="ts">
// 给观众看的 OBS 弹幕信息板（区别于主播自己看的 DanmuOverlayWindow）。
// 风格：简洁清新——半透明深色 + 浅字 + backdrop blur，新弹幕从底部滑入，
// FIFO 超过 maxLines 丢最早

import { nextTick, ref, watch } from 'vue'

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
}>()

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
    <div ref="scrollEl" class="scroll">
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
  /* 容器：固定宽度，高度由内容决定。简洁清新 = 半透明深底 + 浅字 + 圆角 + blur */
  width: 360px;
  max-height: 80vh;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  padding: 10px 12px;
  color: #f1f5f9;
  font-size: var(--font-size, 16px);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px -10px rgba(0, 0, 0, 0.35);
}
.scroll {
  max-height: 72vh;
  overflow-y: auto;
  /* 隐藏 scrollbar 视觉，保留滚动功能 */
  scrollbar-width: none;
}
.scroll::-webkit-scrollbar { display: none; }

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
