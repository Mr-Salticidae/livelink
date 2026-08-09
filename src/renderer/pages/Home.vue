<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  status,
  room,
  overlayUrl,
  overlayFatalError,
  overlayRetrying,
  isConnected,
  isBusy,
  retryOverlay,
  rules,
  danmuOverlayEnabled,
  danmuOverlayPinned,
  danmuOverlaySettings,
  toggleDanmuOverlay,
  toggleDanmuOverlayPin,
  patchDanmuOverlaySettings,
  danmuBoard,
  patchDanmuBoard,
  danmuBoardPreviewFull,
  toggleDanmuBoardPreviewFull,
  overlayTheme,
  patchOverlayTheme
} from '../store'
import type { Rule } from '../types'
import { OVERLAY_THEME_PRESETS, type OverlayThemeId } from '../../shared/overlay-theme'
import {
  DEFAULT_DANMU_BOARD_CONFIG,
  DEFAULT_DANMU_OVERLAY_SETTINGS
} from '../../shared/danmu-display'
import DanmuStyleControls from '../components/DanmuStyleControls.vue'

// 预览框 16:9 比例的拖动逻辑。容器尺寸 onmounted 测量
const previewRef = ref<HTMLDivElement | null>(null)
const dragging = ref(false)

// 假设直播画布 1920×1080。预览框里板子缩略图的宽/高占比 = 真实尺寸 / 画布尺寸
const boardWidthPct = computed(() =>
  Math.max(5, Math.min(80, ((danmuBoard.value.width || 360) / 1920) * 100))
)
const boardHeightPct = computed(() =>
  Math.max(10, Math.min(95, danmuBoard.value.maxHeightPct || 80))
)

// overlay 端用 translate(-x%, -y%) 让 position 是「对齐百分比」语义：
//   x=0 → 板子左边贴视口左；x=100 → 板子右边贴视口右；x=50 → 水平居中
// 所以 drag / snap 都直接用 [0, 100]，不再减 widthPct（之前那套是错的，
// 导致 snap 到右下时只到 87% × 80%，离边缘还差一截）
function startDragBoard(e: MouseEvent): void {
  if (!previewRef.value) return
  dragging.value = true
  e.preventDefault()
  const update = (evt: MouseEvent): void => {
    const rect = previewRef.value!.getBoundingClientRect()
    const x = ((evt.clientX - rect.left) / rect.width) * 100
    const y = ((evt.clientY - rect.top) / rect.height) * 100
    patchDanmuBoard({
      position: {
        x: Math.round(Math.max(0, Math.min(100, x)) * 100) / 100,
        y: Math.round(Math.max(0, Math.min(100, y)) * 100) / 100
      }
    })
  }
  update(e)
  const move = (evt: MouseEvent): void => {
    if (!dragging.value) return
    update(evt)
  }
  const up = (): void => {
    dragging.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// 在预览框里拖拽缩放：板子缩略图右下角的小角标
const resizing = ref(false)
function startResizeBoard(e: MouseEvent): void {
  if (!previewRef.value) return
  e.preventDefault()
  e.stopPropagation()
  resizing.value = true
  const rect = previewRef.value.getBoundingClientRect()
  // 用 translate 诡计后，板子缩略图的左上角 = 锚点(左上对齐量)
  // 缩略图左上像素 = position.x% × previewW - widthPct% × previewW
  const px = danmuBoard.value.position.x / 100
  const boxLeftPx = px * rect.width - (boardWidthPct.value / 100) * rect.width * px
  const py = danmuBoard.value.position.y / 100
  const boxTopPx = py * rect.height - (boardHeightPct.value / 100) * rect.height * py
  const update = (evt: MouseEvent): void => {
    const relX = evt.clientX - rect.left - boxLeftPx
    const relY = evt.clientY - rect.top - boxTopPx
    const newWidth = Math.max(240, Math.min(960, Math.round((relX / rect.width) * 1920)))
    const newMaxHeightPct = Math.max(
      20,
      Math.min(95, Math.round((relY / rect.height) * 100))
    )
    patchDanmuBoard({ width: newWidth, maxHeightPct: newMaxHeightPct })
  }
  update(e)
  const move = (evt: MouseEvent): void => {
    if (!resizing.value) return
    update(evt)
  }
  const up = (): void => {
    resizing.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// 5 个一键贴边按钮：直接用对齐百分比，0 / 50 / 100 三档
function snapBoardTo(fx: number, fy: number): void {
  patchDanmuBoard({
    position: { x: fx * 100, y: fy * 100 }
  })
}

function selectOverlayTheme(id: OverlayThemeId): void {
  void patchOverlayTheme({ id })
}
import BilibiliAuthAdvanced from '../components/BilibiliAuthAdvanced.vue'

// Home 页快捷开关：直接读 / 写规则 store 里默认那三条
// 用户改名 / 删除后这些开关会变成"未配置"（toggle 仍可点，但什么也不会 toggle）。
// 跳蛛先生：保留默认规则 id 是基础前提，不要重命名。
const QUICK_TOGGLES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'welcome.default', label: '欢迎进房', hint: '观众进入直播间时播报欢迎' },
  { id: 'reply.hello', label: '关键词回复', hint: '观众发"你好/hi/哈喽"自动回复' },
  { id: 'gift.thanks.default', label: '礼物感谢', hint: '收到礼物时 TTS 致谢 + 特效' }
]

const quickToggleError = ref<string | null>(null)

function ruleById(id: string): Rule | undefined {
  return rules.value.find((r) => r.id === id)
}

async function toggleQuickRule(id: string): Promise<void> {
  const rule = ruleById(id)
  if (!rule) {
    quickToggleError.value = `没找到规则 ${id}（可能被改名或删除）。去"规则"页改 enabled 字段`
    return
  }
  quickToggleError.value = null
  // 深拷贝把 Vue reactive Proxy 拍平成 plain object，避免 IPC structured clone 失败。
  // preload 层已统一兜底（cleanForIpc），这里再加一层 belt-and-suspenders
  const next: Rule = JSON.parse(JSON.stringify({ ...rule, enabled: !rule.enabled }))
  try {
    rules.value = await window.api.ruleUpsert(next)
  } catch (err) {
    quickToggleError.value = (err as Error)?.message ?? '切换失败'
  }
}

const roomInput = ref(room.value.id)
const errorMsg = ref<string | null>(null)
const copyToast = ref<string | null>(null)
const showObsHelp = ref(false)

watch(
  () => room.value.id,
  (id) => {
    if (!roomInput.value) roomInput.value = id
  }
)

const buttonLabel = computed(() => {
  if (isBusy.value) return '处理中…'
  return isConnected.value ? '停止' : '开始'
})

async function toggleConnection(): Promise<void> {
  errorMsg.value = null
  try {
    if (isConnected.value) {
      await window.api.stopConnection()
    } else {
      await window.api.startConnection(roomInput.value.trim())
    }
  } catch (err) {
    errorMsg.value = (err as Error)?.message ?? '操作失败'
  }
}

async function copyOverlayUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(overlayUrl.value)
    copyToast.value = '已复制 Overlay URL'
    setTimeout(() => (copyToast.value = null), 1500)
  } catch {
    copyToast.value = '复制失败，手动选中链接复制'
    setTimeout(() => (copyToast.value = null), 2500)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <p class="ll-eyebrow-accent mb-1.5">LIVE CONTROL</p>
      <h1 class="ll-title text-[26px]">首页</h1>
      <p class="mt-1 text-sm text-slate-400">填上你的 B 站直播间号，点开始就行。</p>
    </header>

    <!-- 房间号 + 开始/停止：全页主行动区，给一层蛛丝辉光当视觉重心 -->
    <section class="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div
        class="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
        style="background: radial-gradient(circle, rgba(155, 133, 255, 0.16), transparent 70%)"
      />
      <div class="relative">
        <p class="ll-eyebrow mb-2">Room · 直播间号或链接</p>
        <div class="flex items-stretch gap-3">
          <input
            v-model="roomInput"
            :disabled="isConnected || isBusy"
            placeholder="比如 21452505 或 https://live.bilibili.com/21452505"
            class="ll-input flex-1"
          />
          <button
            @click="toggleConnection"
            :disabled="isBusy"
            class="ll-btn min-w-[104px]"
            :class="isConnected
              ? 'bg-rose-500/90 text-white hover:bg-rose-400'
              : 'll-btn-primary'"
          >
            {{ buttonLabel }}
          </button>
        </div>

        <!-- 状态徽章 -->
        <div class="mt-4 flex items-center gap-3 text-sm">
          <span
            class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
            :class="{
              'border-slate-800 bg-slate-800/50 text-slate-400': status.state === 'idle',
              'border-amber-400/30 bg-amber-400/10 text-amber-200': ['validating', 'connecting', 'reconnecting'].includes(status.state),
              'border-emerald-400/30 bg-emerald-400/10 text-emerald-200': status.state === 'connected',
              'border-rose-400/30 bg-rose-400/10 text-rose-200': status.state === 'error'
            }"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="{
                'bg-slate-500': status.state === 'idle',
                'bg-amber-300 animate-pulse': ['validating', 'connecting', 'reconnecting'].includes(status.state),
                'bg-emerald-400': status.state === 'connected',
                'bg-rose-400': status.state === 'error'
              }"
            />
            <span v-if="status.state === 'idle'">未连接</span>
            <span v-else-if="status.state === 'validating'">校验房间号中…</span>
            <span v-else-if="status.state === 'connecting'">连接中…</span>
            <span v-else-if="status.state === 'connected'">已连接 · 房间 {{ status.roomId }}</span>
            <span v-else-if="status.state === 'reconnecting'">{{ status.message ?? '断线重连中…' }}</span>
            <span v-else-if="status.state === 'error'">出错了</span>
          </span>
        </div>

        <p
          v-if="errorMsg || status.state === 'error'"
          class="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          {{ errorMsg || (status.state === 'error' ? status.message : '') }}
        </p>
      </div>
    </section>

    <!-- Overlay URL 卡片：正常 / 启动失败两种状态 -->
    <section
      v-if="overlayFatalError"
      class="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5"
    >
      <div class="flex items-start gap-3">
        <span class="text-xl">⚠️</span>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-rose-200">Overlay 服务启动失败</div>
          <div class="mt-1 text-xs text-rose-300/80 break-all font-mono">{{ overlayFatalError }}</div>
          <p class="mt-3 text-sm text-slate-300">
            常见原因：默认端口 38501 起 50 个端口全被占用 / 防火墙拦截。
            建议：关掉占用端口的程序，或者重启电脑后再点重试；如还不行，重启应用。
          </p>
        </div>
        <button
          @click="retryOverlay"
          :disabled="overlayRetrying"
          class="shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:opacity-50"
        >
          {{ overlayRetrying ? '重试中…' : '重试启动' }}
        </button>
      </div>
    </section>

    <section v-else class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div class="mb-2 flex items-center justify-between">
        <label class="text-sm text-slate-300">OBS 浏览器源 URL</label>
        <span v-if="copyToast" class="text-xs text-emerald-400">{{ copyToast }}</span>
      </div>
      <div class="flex items-stretch gap-3">
        <input
          :value="overlayUrl"
          readonly
          class="flex-1 select-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
        />
        <button
          @click="copyOverlayUrl"
          class="rounded-lg bg-slate-700 px-4 text-sm text-slate-100 hover:bg-slate-600"
        >
          复制
        </button>
      </div>

      <button
        class="mt-4 text-xs text-sky-400 hover:underline"
        @click="showObsHelp = !showObsHelp"
      >
        {{ showObsHelp ? '收起' : '不会加 OBS 浏览器源？点这里看 3 步' }}
      </button>
      <ol v-if="showObsHelp" class="mt-3 space-y-2 rounded-lg bg-slate-950/50 p-4 text-sm text-slate-300">
        <li>1. 打开 OBS Studio，在"来源"面板点 + 号 → 选"浏览器"。</li>
        <li>2. 起个名字（比如"LiveLink Overlay"）→ 确定。</li>
        <li>3. 把上面这个 URL 粘贴到"URL"栏 → 宽度 1920、高度 1080 → 确定。直播间一有动静，特效就会出现。</li>
      </ol>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div>
        <h2 class="text-sm font-medium text-slate-300">观众端主题</h2>
        <p class="mt-1 text-xs text-slate-500">
          影响 OBS 画面里的欢迎、礼物、小游戏卡片和宠物栏。切换后 OBS 浏览器源实时同步。
        </p>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <button
          v-for="theme in OVERLAY_THEME_PRESETS"
          :key="theme.id"
          @click="selectOverlayTheme(theme.id)"
          class="rounded-xl border p-3 text-left transition"
          :class="
            overlayTheme.id === theme.id
              ? 'border-pink-300/80 bg-pink-500/10 shadow-[0_0_28px_rgba(244,114,182,0.18)]'
              : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
          "
        >
          <div class="flex items-center justify-between gap-3">
            <div class="font-medium text-slate-100">{{ theme.name }}</div>
            <div class="flex gap-1">
              <span
                v-for="c in theme.swatches"
                :key="c"
                class="h-4 w-4 rounded-full border border-white/20"
                :style="{ backgroundColor: c }"
              ></span>
            </div>
          </div>
          <div class="mt-1 text-xs leading-relaxed text-slate-500">{{ theme.desc }}</div>
        </button>
      </div>
    </section>

    <!-- OBS 弹幕信息板（给观众看的直播屏 overlay） -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-slate-300">直播屏弹幕信息板</h2>
          <p class="mt-1 text-xs text-slate-500">
            在 OBS 浏览器源上叠加一块半透明弹幕滚动列表给<strong class="text-slate-300">观众看</strong>。
            自动出现在直播画面里（不是主播自己看那个悬浮窗）。
          </p>
        </div>
        <button
          class="relative h-5 w-9 shrink-0 rounded-full transition"
          :class="danmuBoard.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
          @click="patchDanmuBoard({ enabled: !danmuBoard.enabled })"
          :title="danmuBoard.enabled ? '关闭信息板' : '打开信息板'"
        >
          <span
            class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
            :class="danmuBoard.enabled ? 'translate-x-4' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <!-- 详细配置：开启时才显示 -->
      <div v-if="danmuBoard.enabled" class="space-y-3 rounded-lg bg-slate-950/40 p-3">
        <!-- 装修预览模式：OBS 板子装满假弹幕，看满载效果 -->
        <div class="rounded-lg border p-3"
          :class="danmuBoardPreviewFull ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-700 bg-slate-900/40'">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-medium text-slate-200">装修预览模式</p>
              <p class="mt-1 text-[11px] text-slate-500">
                开启后 OBS 弹幕板会按
                <strong class="text-slate-300">当前宽度 / 字号 / 最大条数</strong>
                装满假弹幕显示，让你直观看到满载时的体积，方便对齐直播间画面装修。调好关掉即恢复真实状态（重启自动关）。
              </p>
            </div>
            <button
              class="relative h-5 w-9 shrink-0 rounded-full transition"
              :class="danmuBoardPreviewFull ? 'bg-amber-500' : 'bg-slate-600'"
              @click="toggleDanmuBoardPreviewFull"
              :title="danmuBoardPreviewFull ? '退出装修预览' : '开启装修预览'"
            >
              <span
                class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
                :class="danmuBoardPreviewFull ? 'translate-x-4' : 'translate-x-0'"
              ></span>
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs text-slate-400">
            位置 + 尺寸（推荐用这个预览框调，OBS 画面实时同步——拖蓝框移动、拖右下角缩放、或点下方一键贴边）
          </label>
          <!-- 16:9 拖动预览框（按真实 1920×1080 比例） -->
          <div
            ref="previewRef"
            class="mt-2 relative aspect-video w-full rounded-lg border border-slate-700 bg-gradient-to-br from-slate-800/60 to-slate-950 cursor-crosshair select-none overflow-hidden"
            :class="dragging || resizing ? 'border-sky-400' : ''"
            @mousedown="startDragBoard"
          >
            <!-- 屏幕中心十字辅助线 -->
            <div class="absolute inset-0 pointer-events-none">
              <div class="absolute left-1/2 top-0 bottom-0 border-l border-slate-700/40"></div>
              <div class="absolute top-1/2 left-0 right-0 border-t border-slate-700/40"></div>
            </div>
            <!-- DanmuBoard 缩略图：按 (width/1920, maxHeightPct) 真实占比绘制，
                 用 translate(-x%, -y%) 跟 overlay 端语义对齐：
                 x=0 板子左贴视口左、x=100 板子右贴视口右、x=50 水平居中。
                 任何 x/y 都能保证板子整体不溢出预览框 -->
            <div
              class="absolute rounded bg-sky-500/30 border border-sky-400/80 shadow-lg"
              :style="{
                left: danmuBoard.position.x + '%',
                top: danmuBoard.position.y + '%',
                transform: `translate(-${danmuBoard.position.x}%, -${danmuBoard.position.y}%)`,
                width: boardWidthPct + '%',
                height: boardHeightPct + '%'
              }"
            >
              <div class="text-[8px] text-sky-100 text-center mt-0.5 font-medium pointer-events-none">弹幕板</div>
              <!-- 右下角缩放角标 -->
              <div
                class="absolute -right-1 -bottom-1 w-3 h-3 rounded-sm bg-sky-400 border border-sky-100 cursor-nwse-resize hover:scale-125 transition"
                @mousedown.stop="startResizeBoard"
                title="拖动缩放板子真实大小"
              ></div>
            </div>
            <!-- 当前位置 + 尺寸坐标 -->
            <div class="absolute right-1.5 bottom-1.5 text-[9px] text-slate-400 font-mono bg-slate-950/60 px-1.5 rounded">
              x:{{ Math.round(danmuBoard.position.x) }}% · y:{{ Math.round(danmuBoard.position.y) }}% ·
              {{ danmuBoard.width }}×{{ danmuBoard.maxHeightPct }}%
            </div>
          </div>

          <!-- 5 个一键贴边（板宽板高自动算精确位置） -->
          <div class="mt-2 grid grid-cols-5 gap-1">
            <button
              @click="snapBoardTo(0, 0)"
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >⌜ 左上</button>
            <button
              @click="snapBoardTo(1, 0)"
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >⌝ 右上</button>
            <button
              @click="snapBoardTo(0.5, 0.5)"
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >● 居中</button>
            <button
              @click="snapBoardTo(0, 1)"
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >⌞ 左下</button>
            <button
              @click="snapBoardTo(1, 1)"
              class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-600 transition"
            >⌟ 右下</button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="text-xs text-slate-400">
            最多显示条数（5-30）
            <input
              :value="danmuBoard.maxLines"
              @change="patchDanmuBoard({ maxLines: Number(($event.target as HTMLInputElement).value) })"
              type="number" min="5" max="30"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            宽度 px（240-960）
            <input
              :value="danmuBoard.width"
              @change="patchDanmuBoard({ width: Number(($event.target as HTMLInputElement).value) })"
              type="number" min="240" max="960" step="10"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            最大高度 %（20-95）
            <input
              :value="danmuBoard.maxHeightPct"
              @change="patchDanmuBoard({ maxHeightPct: Number(($event.target as HTMLInputElement).value) })"
              type="number" min="20" max="95" step="5"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
        </div>

        <details class="group overflow-hidden rounded-xl border border-slate-700 bg-slate-950/30">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span>
              <span class="block text-xs font-medium text-slate-200">字体、透明度与动画</span>
              <span class="mt-0.5 block text-[11px] text-slate-500">
                {{ danmuBoard.fontSize }}px · 背景 {{ Math.round(danmuBoard.backgroundOpacity * 100) }}% ·
                {{ danmuBoard.messageLifetimeSec === 0 ? '消息常驻' : `${danmuBoard.messageLifetimeSec}s 后淡出` }}
              </span>
            </span>
            <span class="text-xs text-sky-400 group-open:hidden">展开设置</span>
            <span class="hidden text-xs text-sky-400 group-open:inline">收起</span>
          </summary>
          <div class="border-t border-slate-800 p-3">
            <DanmuStyleControls
              :model-value="danmuBoard"
              :defaults="DEFAULT_DANMU_BOARD_CONFIG"
              :username-weight-offset="100"
              :gift-weight-offset="200"
              @patch="patchDanmuBoard"
            />
          </div>
        </details>

        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            :checked="danmuBoard.showGift"
            @change="patchDanmuBoard({ showGift: ($event.target as HTMLInputElement).checked })"
          />
          <span>礼物事件也进信息板（金色显示）</span>
        </label>

        <p class="text-[11px] text-slate-500 leading-relaxed">
          配置改后 OBS 浏览器源自动刷新，不用手动重载源。
        </p>
      </div>
    </section>

    <!-- 弹幕悬浮窗：单屏主播全屏游戏时瞟弹幕用 -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-slate-300">弹幕悬浮窗</h2>
          <p class="mt-1 text-xs text-slate-500">
            单屏主播必备：游戏全屏时也能瞟一眼实时弹幕 + 礼物。窗口永远置顶、可拖动 / 缩放。
          </p>
        </div>
        <button
          class="relative h-5 w-9 shrink-0 rounded-full transition"
          :class="danmuOverlayEnabled ? 'bg-emerald-500' : 'bg-slate-600'"
          @click="toggleDanmuOverlay"
          :title="danmuOverlayEnabled ? '关闭悬浮窗' : '打开悬浮窗'"
        >
          <span
            class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
            :class="danmuOverlayEnabled ? 'translate-x-4' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <!-- 钉住开关：开启悬浮窗后才显示 -->
      <div
        v-if="danmuOverlayEnabled"
        class="flex items-center justify-between gap-3 rounded-lg bg-slate-950/40 px-3 py-2"
      >
        <div class="min-w-0">
          <div class="text-sm text-slate-200 flex items-center gap-2">
            <span>钉住悬浮窗</span>
            <span
              v-if="danmuOverlayPinned"
              class="rounded bg-amber-500/20 text-amber-300 px-1.5 py-0.5 text-[10px]"
            >已钉住</span>
          </div>
          <div class="text-xs text-slate-500">
            钉住后：<strong class="text-amber-300">鼠标完全穿透弹幕窗</strong>（游戏正常操作不被劫持）+
            禁止拖动 / 缩放、不抢游戏焦点。子窗按钮也被穿透，解开只能用<strong class="text-slate-300">这里</strong>的开关。
          </div>
        </div>
        <button
          class="relative h-5 w-9 shrink-0 rounded-full transition"
          :class="danmuOverlayPinned ? 'bg-amber-500' : 'bg-slate-600'"
          @click="toggleDanmuOverlayPin"
          :title="danmuOverlayPinned ? '解开钉住' : '钉住悬浮窗'"
        >
          <span
            class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
            :class="danmuOverlayPinned ? 'translate-x-4' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <div class="space-y-3 rounded-lg bg-slate-950/40 p-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="text-xs text-slate-400">
            最多保留条数（5-100）
            <input
              :value="danmuOverlaySettings.maxLines"
              @change="patchDanmuOverlaySettings({ maxLines: Number(($event.target as HTMLInputElement).value) })"
              type="number" min="5" max="100"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <label class="flex items-end gap-2 pb-1 text-xs text-slate-300">
            <input
              type="checkbox"
              :checked="danmuOverlaySettings.showGift"
              @change="patchDanmuOverlaySettings({ showGift: ($event.target as HTMLInputElement).checked })"
            />
            <span>在主播悬浮窗中显示礼物</span>
          </label>
        </div>

        <details class="group overflow-hidden rounded-xl border border-slate-700 bg-slate-950/30">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span>
              <span class="block text-xs font-medium text-slate-200">字体、透明度与动画</span>
              <span class="mt-0.5 block text-[11px] text-slate-500">
                {{ danmuOverlaySettings.fontSize }}px · 背景 {{ Math.round(danmuOverlaySettings.backgroundOpacity * 100) }}% ·
                {{ danmuOverlaySettings.messageLifetimeSec === 0 ? '消息常驻' : `${danmuOverlaySettings.messageLifetimeSec}s 后淡出` }}
              </span>
            </span>
            <span class="text-xs text-sky-400 group-open:hidden">展开设置</span>
            <span class="hidden text-xs text-sky-400 group-open:inline">收起</span>
          </summary>
          <div class="border-t border-slate-800 p-3">
            <DanmuStyleControls
              :model-value="danmuOverlaySettings"
              :defaults="DEFAULT_DANMU_OVERLAY_SETTINGS"
              :username-weight-offset="200"
              :gift-weight-offset="200"
              @patch="patchDanmuOverlaySettings"
            />
          </div>
        </details>

        <p class="text-[11px] leading-relaxed text-slate-500">
          样式会立即同步到已打开的悬浮窗；窗口关闭时也会保存，下次打开继续使用。
        </p>
      </div>

      <p class="text-[11px] text-slate-500 leading-relaxed">
        提示：如果开了游戏后悬浮窗仍被遮住——大概率是游戏开了"独占全屏"（exclusive fullscreen）模式。
        把游戏画面设置切到<strong class="text-slate-300">"无边框窗口"</strong>或<strong class="text-slate-300">"窗口化"</strong>就能盖在上面。
      </p>
    </section>

    <!-- 快捷开关：直接控制三条默认规则的 enabled -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 class="text-sm font-medium text-slate-300">快捷开关</h2>
      <p class="mt-1 text-xs text-slate-500">不想欢迎 / 不想回复关键词时，在这里一键关。细节去"规则"页改。</p>

      <p
        v-if="quickToggleError"
        class="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
      >
        {{ quickToggleError }}
      </p>

      <div class="mt-4 space-y-3">
        <div
          v-for="t in QUICK_TOGGLES"
          :key="t.id"
          class="flex items-center justify-between gap-3 rounded-lg bg-slate-950/40 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="text-sm text-slate-200">{{ t.label }}</div>
            <div class="text-xs text-slate-500">{{ t.hint }}</div>
          </div>
          <button
            class="relative h-5 w-9 shrink-0 rounded-full transition"
            :class="ruleById(t.id)?.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
            :disabled="!ruleById(t.id)"
            @click="toggleQuickRule(t.id)"
            :title="ruleById(t.id) ? '' : '规则不存在'"
          >
            <span
              class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
              :class="ruleById(t.id)?.enabled ? 'translate-x-4' : 'translate-x-0'"
            ></span>
          </button>
        </div>
      </div>
    </section>

    <!-- 高级 · B 站登录态（解决游客模式收不到弹幕的问题） -->
    <BilibiliAuthAdvanced />
  </div>
</template>
