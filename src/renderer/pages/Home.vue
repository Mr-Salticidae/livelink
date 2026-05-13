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
  toggleDanmuOverlay,
  toggleDanmuOverlayPin
} from '../store'
import type { Rule } from '../types'
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
      <h1 class="text-2xl font-semibold">首页</h1>
      <p class="mt-1 text-sm text-slate-400">填上你的 B 站直播间号，点开始就行。</p>
    </header>

    <!-- 房间号 + 开始/停止 -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <label class="mb-2 block text-sm text-slate-300">直播间号或链接</label>
      <div class="flex items-stretch gap-3">
        <input
          v-model="roomInput"
          :disabled="isConnected || isBusy"
          placeholder="比如 21452505 或 https://live.bilibili.com/21452505"
          class="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none disabled:opacity-60"
        />
        <button
          @click="toggleConnection"
          :disabled="isBusy"
          class="rounded-lg px-5 text-sm font-medium transition disabled:opacity-50"
          :class="isConnected
            ? 'bg-rose-500 text-white hover:bg-rose-400'
            : 'bg-sky-500 text-white hover:bg-sky-400'"
        >
          {{ buttonLabel }}
        </button>
      </div>

      <!-- 状态徽章 -->
      <div class="mt-4 flex items-center gap-3 text-sm">
        <span
          class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
          :class="{
            'bg-slate-800 text-slate-400': status.state === 'idle',
            'bg-amber-500/20 text-amber-300': ['validating', 'connecting', 'reconnecting'].includes(status.state),
            'bg-emerald-500/20 text-emerald-300': status.state === 'connected',
            'bg-rose-500/20 text-rose-300': status.state === 'error'
          }"
        >
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
        class="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
      >
        {{ errorMsg || (status.state === 'error' ? status.message : '') }}
      </p>
    </section>

    <!-- Overlay URL 卡片：正常 / 启动失败两种状态 -->
    <section
      v-if="overlayFatalError"
      class="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5"
    >
      <div class="flex items-start gap-3">
        <span class="text-xl">⚠️</span>
        <div class="flex-1">
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
