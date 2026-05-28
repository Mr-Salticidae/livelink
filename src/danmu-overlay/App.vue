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
const pinned = ref<boolean>(false)
const watchedText = ref<string>('') // B 站"X 人看过"文本，未连接前空

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

function togglePin(): void {
  void window.api?.danmuOverlayPinToggle?.()
}

let unsubEvent: (() => void) | null = null
let unsubPinned: (() => void) | null = null
let unsubRoomStats: (() => void) | null = null

onMounted(() => {
  // preload 暴露的 onDanmuOverlayEvent 订阅主进程过滤后的弹幕 / 礼物事件
  const api = window.api
  if (api?.onDanmuOverlayEvent) {
    unsubEvent = api.onDanmuOverlayEvent((evt: DanmuItem) => push(evt))
  }
  // 监听 pinned 状态变化，title bar 视觉跟着变
  if (api?.onDanmuOverlayPinned) {
    unsubPinned = api.onDanmuOverlayPinned((s) => {
      pinned.value = s.pinned
    })
  }
  // 监听在线人数推送（B 站 WATCHED_CHANGE，几秒一次）
  if (api?.onDanmuOverlayRoomStats) {
    unsubRoomStats = api.onDanmuOverlayRoomStats((stats) => {
      watchedText.value = stats.watchedText
    })
  }
  // 初始化时拉一次设置（opacity / fontSize）+ pinned 状态
  api?.getDanmuOverlaySettings?.().then((s) => {
    if (s) settings.value = s
  })
  api?.danmuOverlayStatus?.().then((s) => {
    if (s) pinned.value = s.pinned
  })
})

onBeforeUnmount(() => {
  unsubEvent?.()
  unsubPinned?.()
  unsubRoomStats?.()
})

// 自定义缩放：用 Pointer Capture 而不是 document.mouseup。
// 主进程每 16ms 用 setBounds 让窗口边缘追光标，光标可能短暂落在窗口外，
// 此时 document 收不到 mouseup → resize 停不下来、窗口黏着光标乱跑。
// setPointerCapture 让后续 pointerup 一定回到该 handle（即使指针移出窗口），可靠停止。
function startResize(e: PointerEvent, dir: string): void {
  const el = e.currentTarget as HTMLElement
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    /* 某些环境不支持时退化为普通监听，仍有主进程兜底超时 */
  }
  const onUp = (): void => {
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    window.removeEventListener('pointerup', onUp)
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      /* 已释放则忽略 */
    }
    void window.api?.danmuOverlayResizeStop?.()
  }
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
  // window 级兜底：万一 capture 异常，指针在窗口内松开时这里也能停（stop 幂等）
  window.addEventListener('pointerup', onUp)
  void window.api?.danmuOverlayResizeStart?.(dir)
}
</script>

<template>
  <div
    class="danmu-window"
    :class="{ pinned }"
    :style="{ '--font-size': settings.fontSize + 'px' }"
  >
    <!-- 自定义缩放拖手（transparent frameless 窗口在 Windows 上只能从右下角 resize，手动补全四边） -->
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
    <!-- 标题栏：未钉住时可拖动；钉住后只剩图钉按钮可点 -->
    <header class="title-bar" :class="{ 'title-bar-pinned': pinned }">
      <span v-if="!pinned" class="title">LiveLink · 弹幕</span>
      <span v-else class="title pinned-hint" title="鼠标穿透中 · 到主窗口解开">🔒 已钉住</span>
      <!-- 在线人数（B 站"X 人看过"）。窗口窄时会被 ellipsis 截掉，但 watched 文本一般 < 10 字符 -->
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

    <!-- 滚动列表 -->
    <div ref="scrollEl" class="scroll-area">
      <div v-if="items.length === 0" class="empty">等待弹幕…</div>
      <div
        v-for="i in items"
        :key="i.id"
        class="line text-outline"
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
/* 完全透明设计：窗口本身不画任何背景 / 边框 / 模糊，BrowserWindow 已是
   transparent:true，所以游戏画面 100% 透出，弹幕窗不再挡视野。
   可读性靠每条文字的深色描边阴影（text-shadow 模拟 outline），
   不依赖任何底色——这样无论游戏画面亮暗都能看清。 */
.danmu-window {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: #e2e8f0;
  font-size: var(--font-size, 14px);
  overflow: hidden;
}

/* 文字描边：四向 + 外发光的多层 text-shadow，等效一圈黑边，
   亮背景（雪地 / 白图）也能读 */
.text-outline {
  text-shadow:
    0 0 2px rgba(0, 0, 0, 0.95),
    0 0 4px rgba(0, 0, 0, 0.9),
    1px 1px 2px rgba(0, 0, 0, 0.95),
    -1px -1px 2px rgba(0, 0, 0, 0.85),
    1px -1px 2px rgba(0, 0, 0, 0.85),
    -1px 1px 2px rgba(0, 0, 0, 0.85);
}

.title-bar {
  /* 整条标题栏作为拖动区。pin / close 按钮用 no-drag 排除。
     背景透明，平时控件半隐；鼠标移到窗口上才显形，不抢视觉 */
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
  padding: 0 4px 0 8px;
  background: transparent;
  flex-shrink: 0;
  user-select: none;
  opacity: 0.28;
  transition: opacity 0.18s ease;
}
.danmu-window:hover .title-bar { opacity: 1; }
.title-bar-pinned {
  -webkit-app-region: no-drag;
  /* 钉住时标题栏常驻可见（提醒鼠标穿透中），不再依赖 hover */
  opacity: 0.9;
}
.title {
  font-size: 11px;
  color: #cbd5e1;
  letter-spacing: 0.04em;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.9);
}
.pinned-hint { color: #fbbf24; font-weight: 600; opacity: 1; }
.watched {
  flex-shrink: 0;
  margin: 0 6px;
  font-size: 11px;
  color: #7dd3fc;
  white-space: nowrap;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.9);
}
.title-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
  -webkit-app-region: no-drag;
}
.pin-btn,
.close-btn {
  -webkit-app-region: no-drag;
  background: rgba(2, 6, 23, 0.45);
  border: none;
  color: #e2e8f0;
  line-height: 1;
  width: 20px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pin-btn { font-size: 12px; }
.close-btn { font-size: 16px; }
.pin-btn:hover { background: rgba(148, 163, 184, 0.45); }
.close-btn:hover {
  background: rgba(244, 63, 94, 0.6);
  color: white;
}

.scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px 8px;
}
/* 滚动条透明，不画轨道，仅在 hover 时微现 */
.scroll-area::-webkit-scrollbar { width: 5px; }
.scroll-area::-webkit-scrollbar-track { background: transparent; }
.scroll-area::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
.danmu-window:hover .scroll-area::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.35);
}

.empty {
  color: #cbd5e1;
  text-align: center;
  padding-top: 30px;
  font-size: 0.9em;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.9);
}

.line {
  line-height: 1.5;
  word-break: break-word;
  padding: 1px 0;
  /* 进场只用淡入 + 轻微上移，无任何背景色块（不挡视野）。
     forwards 保留终态（完全显示） */
  animation: lineIn 0.35s ease-out forwards;
}
.line + .line { margin-top: 2px; }

@keyframes lineIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.uname {
  color: #7dd3fc;
  font-weight: 700;
}
.sep { color: #cbd5e1; margin-right: 2px; }
.content { color: #f8fafc; font-weight: 500; }

.line-gift .content {
  color: #fde047;
  font-weight: 700;
}
.line-gift .num {
  color: #fcd34d;
  font-weight: 700;
}

.badge {
  display: inline-block;
  font-size: 0.72em;
  padding: 0 4px;
  margin-right: 4px;
  border-radius: 3px;
  vertical-align: 1px;
  font-weight: 700;
  /* 徽章保留小色块（信息密度高、面积小，不挡视野），但加描边防糊 */
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
.badge-guard {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #422006;
}
.badge-fan {
  background: rgba(37, 99, 235, 0.92);
  color: #ffffff;
  min-width: 16px;
  text-align: center;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
}

/* 缩放拖手：贴在窗口四边 / 四角，仅未钉住时显示 */
.resize-handle {
  position: fixed;
  z-index: 9999;
  -webkit-app-region: no-drag;
}
.resize-n  { top: 0;    left: 6px;  right: 6px;  height: 5px; cursor: n-resize; }
.resize-s  { bottom: 0; left: 6px;  right: 6px;  height: 5px; cursor: s-resize; }
.resize-w  { left: 0;   top: 6px;   bottom: 6px; width: 5px;  cursor: w-resize; }
.resize-e  { right: 0;  top: 6px;   bottom: 6px; width: 5px;  cursor: e-resize; }
.resize-nw { top: 0;    left: 0;    width: 8px;  height: 8px; cursor: nw-resize; }
.resize-ne { top: 0;    right: 0;   width: 8px;  height: 8px; cursor: ne-resize; }
.resize-sw { bottom: 0; left: 0;    width: 8px;  height: 8px; cursor: sw-resize; }
.resize-se { bottom: 0; right: 0;   width: 8px;  height: 8px; cursor: se-resize; }
</style>
