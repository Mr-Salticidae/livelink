<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isConnected } from '../store'
import type { SongBoardCorner, SongQueueState, SongRequestConfig, SongScope } from '../types'

const config = ref<SongRequestConfig | null>(null)
const state = ref<SongQueueState>({ open: true, current: null, queue: [], history: [] })
const error = ref<string | null>(null)
const toast = ref<string | null>(null)
const hostTitle = ref('')
const showHistory = ref(false)
// 货币名是主播可改的（默认「哈松币」，实测有人改成「蛛币」），
// 页面上一律用他自己设的名字，别写死
const currencyName = ref('哈松币')

let unsub: (() => void) | null = null

const SCOPES: { value: SongScope; label: string }[] = [
  { value: 'all', label: '所有人' },
  { value: 'guard', label: '仅舰长' },
  { value: 'medal', label: '仅粉丝牌' }
]

const CORNERS: { value: SongBoardCorner; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' }
]

const hint = computed(() => {
  if (!config.value) return ''
  const c = config.value
  const price = c.cost > 0 ? `，每首 ${c.cost} ${currencyName.value}` : ''
  return `观众发「${c.keyword} 歌名」即可点歌${price}；发「${c.cancelKeyword}」撤销自己最后点的那首`
})

onMounted(async () => {
  await load()
  unsub = window.api.onSongState((s) => {
    state.value = s
  })
})

onUnmounted(() => {
  unsub?.()
})

async function load(): Promise<void> {
  try {
    config.value = await window.api.songConfigGet()
    state.value = await window.api.songState()
  } catch (err) {
    error.value = (err as Error)?.message ?? '读取点歌台配置失败'
  }
  try {
    const g = await window.api.guessingGetConfig()
    if (g?.currencyName) currencyName.value = g.currencyName
  } catch {
    // 拿不到就用默认名，不值得为这个报错打断整页
  }
}

async function persist(): Promise<void> {
  if (!config.value) return
  error.value = null
  try {
    const payload = JSON.parse(JSON.stringify(config.value))
    config.value = await window.api.songConfigPatch(payload)
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  }
}

function flash(msg: string): void {
  toast.value = msg
  setTimeout(() => (toast.value = null), 2500)
}

// 模板里访问不到 window，所有 IPC 调用都在这里包一层
async function run(fn: () => Promise<SongQueueState>, msg?: string): Promise<void> {
  try {
    state.value = await fn()
    if (msg) flash(msg)
  } catch (err) {
    error.value = (err as Error)?.message ?? '操作失败'
  }
}

async function toggleOpen(): Promise<void> {
  const next = !state.value.open
  await run(() => window.api.songSetOpen(next), next ? '已恢复接单' : '已暂停接单')
}
async function nextSong(msg: string): Promise<void> {
  await run(() => window.api.songNext(), msg)
}
async function topSong(id: string): Promise<void> {
  await run(() => window.api.songTop(id))
}
async function removeSong(id: string, cost: number): Promise<void> {
  await run(() => window.api.songRemove(id), cost > 0 ? '已删除并退币' : '已删除')
}
async function clearQueue(): Promise<void> {
  await run(() => window.api.songClearQueue(), '已清空，花掉的币已退回')
}
async function clearHistory(): Promise<void> {
  await run(() => window.api.songClearHistory())
}

async function addByHost(): Promise<void> {
  const title = hostTitle.value.trim()
  if (!title) return
  try {
    state.value = await window.api.songAddByHost(title)
    hostTitle.value = ''
  } catch (err) {
    error.value = (err as Error)?.message ?? '加歌失败'
  }
}

function setList(text: string): void {
  if (!config.value) return
  config.value.blockKeywords = text
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function waitText(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  return `${Math.floor(mins / 60)} 小时前`
}
</script>

<template>
  <div v-if="config" class="mx-auto max-w-3xl space-y-6">
    <header>
      <p class="ll-eyebrow-accent mb-1.5">JUKEBOX</p>
      <h1 class="ll-title text-[26px]">点歌台</h1>
      <p class="mt-1 text-sm text-slate-400">
        观众发弹幕点歌，排成队列，你按顺序唱。LiveLink 只管排队和在 OBS 上展示，不放音乐。
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- 总开关 + 接单状态 -->
    <section class="ll-card space-y-4 p-5">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="font-medium">启用点歌台</div>
          <div class="mt-1 truncate text-xs text-slate-500">{{ hint }}</div>
        </div>
        <button
          class="relative h-6 w-11 flex-none rounded-full transition"
          :class="config.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
          @click="(config.enabled = !config.enabled), persist()"
        >
          <span
            class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition"
            :class="config.enabled ? 'translate-x-5' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <p v-if="config.enabled && !isConnected" class="text-xs text-amber-300">
        还没连上直播间，观众的点歌收不到。到首页点「开始」。
      </p>

      <div class="ll-rule"></div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="ll-btn"
          :class="state.open ? 'll-btn-ghost' : 'll-btn-primary'"
          @click="toggleOpen"
        >
          {{ state.open ? '暂停接单' : '恢复接单' }}
        </button>
        <span class="text-xs" :class="state.open ? 'text-emerald-300' : 'text-amber-300'">
          {{ state.open ? '接单中' : '已暂停，已排的照唱' }}
        </span>
        <span v-if="toast" class="text-xs text-slate-400">· {{ toast }}</span>
      </div>
    </section>

    <!-- 正在唱 -->
    <section class="ll-card space-y-3 p-5">
      <header class="ll-eyebrow">正在唱</header>
      <div v-if="state.current" class="flex items-center gap-3">
        <span class="font-serif text-lg text-slate-100">{{ state.current.title }}</span>
        <span class="text-xs text-slate-500">{{ state.current.uname }} 点的</span>
        <span class="flex-1"></span>
        <button class="ll-btn ll-btn-primary" @click="nextSong('唱完了，下一首')">
          唱完了
        </button>
      </div>
      <div v-else class="flex items-center gap-3">
        <span class="text-sm text-slate-500">还没开始唱</span>
        <span class="flex-1"></span>
        <button
          v-if="state.queue.length"
          class="ll-btn ll-btn-primary"
          @click="nextSong('开始第一首')"
        >
          开始下一首
        </button>
      </div>
    </section>

    <!-- 待唱队列 -->
    <section class="ll-card space-y-3 p-5">
      <header class="flex items-center justify-between">
        <div class="ll-eyebrow">待唱队列（{{ state.queue.length }}/{{ config.maxQueueSize }}）</div>
        <button
          v-if="state.queue.length"
          class="text-xs text-slate-500 hover:text-rose-300"
          @click="clearQueue"
        >
          清空并退还{{ currencyName }}
        </button>
      </header>

      <p v-if="!state.queue.length" class="text-sm text-slate-500">
        队列是空的。观众发「{{ config.keyword }} 歌名」就能排进来。
      </p>

      <div
        v-for="(s, i) in state.queue"
        :key="s.id"
        class="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-lg bg-slate-950/40 px-3 py-2"
      >
        <span class="font-mono text-xs text-slate-600">{{ i + 1 }}</span>
        <div class="min-w-0">
          <div class="truncate text-sm text-slate-200">{{ s.title }}</div>
          <div class="text-xs text-slate-500">
            {{ s.uname }} · {{ waitText(s.requestedAt) }}
            <span v-if="s.cost > 0"> · 花了 {{ s.cost }} {{ currencyName }}</span>
            <span v-if="s.source === 'host'"> · 你自己加的</span>
          </div>
        </div>
        <div class="flex flex-none gap-1">
          <button
            v-if="i > 0"
            class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600"
            @click="topSong(s.id)"
          >置顶</button>
          <button
            class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-400 hover:bg-rose-900/60 hover:text-rose-200"
            @click="removeSong(s.id, s.cost)"
          >删除</button>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <input
          v-model="hostTitle"
          class="ll-input min-w-0 flex-1"
          :placeholder="isConnected ? '自己加一首（不扣费）' : '连上直播间后才能加歌'"
          :disabled="!isConnected"
          @keyup.enter="addByHost"
        />
        <button class="ll-btn ll-btn-ghost" :disabled="!isConnected" @click="addByHost">加入</button>
      </div>
    </section>

    <!-- 已唱 -->
    <section v-if="state.history.length" class="ll-card space-y-2 p-5">
      <header class="flex items-center justify-between">
        <button class="ll-eyebrow hover:text-slate-300" @click="showHistory = !showHistory">
          已唱 {{ state.history.length }} 首 {{ showHistory ? '▾' : '▸' }}
        </button>
        <button
          v-if="showHistory"
          class="text-xs text-slate-500 hover:text-rose-300"
          @click="clearHistory"
        >清空记录</button>
      </header>
      <div v-if="showHistory" class="space-y-1">
        <div
          v-for="s in state.history"
          :key="s.id"
          class="flex items-baseline gap-2 text-sm"
        >
          <span class="min-w-0 truncate text-slate-300">{{ s.title }}</span>
          <span class="flex-none text-xs text-slate-600">{{ s.uname }}</span>
        </div>
      </div>
    </section>

    <!-- 规则设置 -->
    <section class="ll-card space-y-4 p-5">
      <header class="ll-eyebrow">谁能点、怎么点</header>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          点歌触发词
          <input v-model="config.keyword" @change="persist" class="ll-input mt-1 w-full" />
        </label>
        <label class="text-xs text-slate-400">
          撤销触发词
          <input v-model="config.cancelKeyword" @change="persist" class="ll-input mt-1 w-full" />
        </label>
      </div>

      <label class="block text-xs text-slate-400">
        谁能点歌
        <select v-model="config.scope" @change="persist" class="ll-input mt-1 w-full">
          <option v-for="s in SCOPES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>

      <div v-if="config.scope === 'medal'" class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          粉丝牌最低等级
          <input
            v-model.number="config.minMedalLevel" type="number" min="0" max="40"
            @change="persist" class="ll-input mt-1 w-full"
          />
        </label>
        <label class="flex items-center gap-2 self-end text-xs text-slate-400">
          <input v-model="config.requireAnchorMedal" type="checkbox" @change="persist" class="accent-sky-500" />
          必须是本直播间的牌子
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          队列上限（首）
          <input
            v-model.number="config.maxQueueSize" type="number" min="1" max="100"
            @change="persist" class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          每人最多同时排几首
          <input
            v-model.number="config.maxPerUser" type="number" min="1" max="20"
            @change="persist" class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          同一个人间隔（秒）
          <input
            v-model.number="config.perUserCooldownSec" type="number" min="0" max="3600"
            @change="persist" class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          每首消耗{{ currencyName }}（0 = 免费）
          <input
            v-model.number="config.cost" type="number" min="0"
            @change="persist" class="ll-input mt-1 w-full"
          />
          <span class="mt-1 block text-[11px] text-slate-500">
            删歌和观众撤销都会原路退回
          </span>
        </label>
      </div>

      <label class="block text-xs text-slate-400">
        歌名黑名单（顿号或空格分隔，命中就拒绝）
        <input
          :value="config.blockKeywords.join('、')"
          @input="setList(($event.target as HTMLInputElement).value)"
          @change="persist"
          class="ll-input mt-1 w-full"
          placeholder="留空表示不过滤"
        />
      </label>

      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.speakOnRequest" type="checkbox" @change="persist" class="accent-sky-500" />
        有人点歌时语音报一句<span class="text-xs text-slate-500">（需要「语音」页的 TTS 是开的）</span>
      </label>
    </section>

    <!-- OBS 展示 -->
    <section class="ll-card space-y-4 p-5">
      <header class="ll-eyebrow">OBS 点歌板</header>

      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.showBoard" type="checkbox" @change="persist" class="accent-sky-500" />
        在直播画面上显示点歌板
      </label>

      <div v-if="config.showBoard" class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          贴哪个角
          <select v-model="config.boardCorner" @change="persist" class="ll-input mt-1 w-full">
            <option v-for="c in CORNERS" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>
        <label class="text-xs text-slate-400">
          最多列几首待唱
          <input
            v-model.number="config.boardLimit" type="number" min="1" max="12"
            @change="persist" class="ll-input mt-1 w-full"
          />
        </label>
      </div>
      <p class="text-xs text-slate-500">
        点歌板跟随你在首页选的观众端主题配色，不需要单独调。
      </p>
    </section>
  </div>
</template>
