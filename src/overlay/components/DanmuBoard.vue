<script setup lang="ts">
// 给观众看的 OBS 弹幕信息板（区别于主播自己看的 DanmuOverlayWindow）。
// 风格：半透明深色 + 浅字，新弹幕从底部滑入，FIFO 超过 maxLines 丢最早。
// 刻意不用 backdrop-filter blur —— 它在 OBS 的 CEF 浏览器源里要每帧重采样
// 背景视频，常驻元素开销巨大，直播编码抢 CPU 时会把 socket 事件拖慢堆积，
// 表现为弹幕板严重延迟。

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
  width?: number // 板子宽度 px
  maxHeightPct?: number // 板子最大高度，占视口高度百分比
  previewFull?: boolean // 装修预览模式：装满假弹幕显示满载效果
}>()

// Home 调宽度 / 字号 / 最大高度，实时透传成 CSS 变量
const boardStyle = computed(() => ({
  '--font-size': props.fontSize + 'px',
  '--board-width': (props.width ?? 360) + 'px',
  '--board-max-h': (props.maxHeightPct ?? 80) + 'vh'
}))

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

// 装修预览：按 maxLines 生成假弹幕，混入礼物 / 大航海 / 粉丝牌等元素，
// 让主播看到「真实满载」时的视觉占位，方便对齐直播间装修
const FAKE_NAMES = [
  '跳蛛先生','小明','观众007','直播小助理','哈基米','摸鱼大王',
  '灯神','糖糖','糯米团','一号粉丝','打工人','吃瓜群众','深夜来访','路过的'
]
const FAKE_CONTENTS = [
  '666',
  '主播好猛',
  '哈哈哈哈',
  '加油加油',
  '再来一次',
  '这波操作太秀了',
  '大佬带带我',
  '打个赏支持',
  '这就是直播间气氛',
  '弹幕板挤一挤'
]
const FAKE_GIFTS = ['辣条', '小心心', '咖啡', '打 call', '灯牌', '应援棒']
const fakeItems = computed<BoardItem[]>(() =>
  Array.from({ length: Math.max(1, props.maxLines) }).map((_, i) => {
    const uname = FAKE_NAMES[i % FAKE_NAMES.length]
    const isGift = i % 4 === 3
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
          fansMedalLevel: isAnchor ? ((i % 20) + 1) : 0
        }
  })
)

// 预览模式下要展示满载样子；正常模式展示真实 items
const visibleItems = computed<BoardItem[]>(() =>
  props.previewFull ? fakeItems.value : items.value
)

defineExpose({ push, clear: () => (items.value = []) })
</script>

<template>
  <div class="board" :style="boardStyle">
    <div ref="scrollEl" class="scroll">
      <!-- 没弹幕、又不在装修预览时给个占位，确认板子在工作；
           一旦有弹幕进来这行自然消失，不打扰观众 -->
      <div v-if="!previewFull && items.length === 0" class="placeholder">
        弹幕区 · 等待弹幕…
      </div>
      <div
        v-for="i in visibleItems"
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
    <!-- 装修预览提示徽章：明确告诉主播这是预览不是真实弹幕 -->
    <div v-if="previewFull" class="preview-tag">装修预览 · 假弹幕</div>
  </div>
</template>

<style scoped>
.board {
  position: relative;
  width: var(--board-width, 360px);
  max-height: var(--board-max-h, 80vh);
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
  /* 跟随板子最大高度，减去 .board 上下 padding(20px) + 边框(2px) */
  max-height: calc(var(--board-max-h, 80vh) - 22px);
  overflow-y: auto;
  scrollbar-width: none;
}
.scroll::-webkit-scrollbar { display: none; }

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
  /* 进场：从底部 8px 上滑 + 渐显 */
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

/* 装修预览徽章：钉在板子右上角外侧，醒目提示这是预览状态 */
.preview-tag {
  position: absolute;
  top: -12px;
  right: 8px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.95);
  color: #1f1300;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
</style>
