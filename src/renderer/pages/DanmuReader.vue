<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { voices } from '../store'
import type { DanmuReaderConfig, DanmuReaderStats, ReaderScope } from '../types'

const config = ref<DanmuReaderConfig | null>(null)
const stats = ref<DanmuReaderStats | null>(null)
const ttsQueued = ref(0)
const saving = ref(false)
const error = ref<string | null>(null)
const toast = ref<string | null>(null)
const sample = ref('主播今天播到几点呀[妙][妙]6666666')

let timer: ReturnType<typeof setInterval> | null = null

const SCOPES: { value: ReaderScope; label: string; hint: string }[] = [
  { value: 'all', label: '所有人', hint: '直播间里每个人的弹幕都念' },
  { value: 'guard', label: '仅舰长', hint: '只念舰长 / 提督 / 总督发的' },
  { value: 'medal', label: '仅粉丝牌', hint: '只念佩戴粉丝牌且达到等级的' },
  { value: 'keyword', label: '仅关键词', hint: '只念包含指定词的，触发词本身不会念出来' }
]

// 把跳过原因翻成人话——主播最常问的就是"我开了怎么不念"
const SKIP_LABELS: Record<string, string> = {
  scope: '不在朗读范围',
  blocked: '命中黑名单',
  handled: '已被规则 / AI 回复念过',
  'user-cooldown': '同一个人太频繁',
  duplicate: '重复内容',
  url: '含网址',
  'too-short': '太短',
  'no-readable': '没有可念的内容',
  empty: '空弹幕'
}

const topSkips = computed(() => {
  const reasons = stats.value?.skipReasons ?? {}
  return Object.entries(reasons)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, n]) => ({ label: SKIP_LABELS[k] ?? k, count: n }))
})

onMounted(async () => {
  await load()
  await refreshStats()
  // 3 秒轮询：这个页面的价值就是"看得见它在工作"，不刷新等于没做
  timer = setInterval(() => void refreshStats(), 3000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function load(): Promise<void> {
  try {
    config.value = await window.api.danmuReaderGet()
  } catch (err) {
    error.value = (err as Error)?.message ?? '读取弹幕朗读配置失败'
  }
}

async function refreshStats(): Promise<void> {
  try {
    stats.value = await window.api.danmuReaderStats()
    const s = await window.api.ttsStats()
    ttsQueued.value = s.queued
  } catch {
    // 轮询失败不打扰主播，下一轮自然会恢复
  }
}

async function persist(): Promise<void> {
  if (!config.value) return
  saving.value = true
  error.value = null
  try {
    const payload = JSON.parse(JSON.stringify(config.value))
    config.value = await window.api.danmuReaderPatch(payload)
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

async function preview(): Promise<void> {
  await persist()
  toast.value = '正在合成…'
  try {
    const r = await window.api.danmuReaderPreview(sample.value)
    toast.value = r.ok
      ? `念出来是：${r.spoken}`
      : `这条会被跳过（${SKIP_LABELS[r.reason ?? ''] ?? r.reason ?? '未知'}）`
  } catch (err) {
    toast.value = (err as Error)?.message ?? '试听失败'
  } finally {
    setTimeout(() => (toast.value = null), 6000)
  }
}

async function stopAll(): Promise<void> {
  await window.api.ttsStop()
  toast.value = '已清空播报队列'
  await refreshStats()
  setTimeout(() => (toast.value = null), 2500)
}

async function skipOne(): Promise<void> {
  await window.api.ttsSkip()
  toast.value = '已跳过当前这句'
  setTimeout(() => (toast.value = null), 2000)
}

function listText(list: string[]): string {
  return list.join('、')
}

function setList(key: 'keywords' | 'blockKeywords', text: string): void {
  if (!config.value) return
  config.value[key] = text
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function timeText(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div v-if="config" class="mx-auto max-w-3xl space-y-6">
    <header>
      <p class="ll-eyebrow-accent mb-1.5">READER</p>
      <h1 class="ll-title text-[26px]">弹幕朗读</h1>
      <p class="mt-1 text-sm text-slate-400">
        把观众发的弹幕原文念出来。和「规则」不同：规则念的是你写好的固定话术，
        这里念的是观众自己打的字。改了立即保存。
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- 开关 + 实时状态 -->
    <section class="ll-card space-y-4 p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-medium">启用弹幕朗读</div>
          <div class="mt-1 text-xs text-slate-500">
            需要 TTS 语音播报同时是开着的（在「语音」页）
          </div>
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

      <div class="ll-rule"></div>

      <div class="grid grid-cols-3 gap-3 text-center">
        <div>
          <div class="font-mono text-xl text-slate-100">{{ stats?.spoken ?? 0 }}</div>
          <div class="ll-eyebrow mt-1">已念</div>
        </div>
        <div>
          <div class="font-mono text-xl text-slate-100">{{ stats?.skipped ?? 0 }}</div>
          <div class="ll-eyebrow mt-1">已跳过</div>
        </div>
        <div>
          <div class="font-mono text-xl text-slate-100">{{ ttsQueued }}</div>
          <div class="ll-eyebrow mt-1">排队中</div>
        </div>
      </div>

      <p v-if="topSkips.length" class="text-xs text-slate-500">
        跳过原因：
        <span v-for="(s, i) in topSkips" :key="s.label">
          <span v-if="i > 0"> · </span>{{ s.label }} {{ s.count }}
        </span>
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <button class="ll-btn ll-btn-ghost" @click="skipOne">跳过这句</button>
        <button class="ll-btn ll-btn-ghost" @click="stopAll">全部停下</button>
        <span v-if="toast" class="text-xs text-slate-400">{{ toast }}</span>
      </div>
    </section>

    <!-- 念谁的 -->
    <section class="ll-card space-y-4 p-5">
      <header class="ll-eyebrow">念谁的弹幕</header>

      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="s in SCOPES"
          :key="s.value"
          @click="(config.scope = s.value), persist()"
          class="rounded-lg border px-3 py-2 text-left transition"
          :class="
            config.scope === s.value
              ? 'border-sky-500/60 bg-sky-500/10'
              : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
          "
        >
          <div class="text-sm text-slate-200">{{ s.label }}</div>
          <div class="mt-0.5 text-xs text-slate-500">{{ s.hint }}</div>
        </button>
      </div>

      <div v-if="config.scope === 'medal'" class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          粉丝牌最低等级
          <input
            v-model.number="config.minMedalLevel"
            type="number" min="0" max="40"
            @change="persist"
            class="ll-input mt-1 w-full"
          />
        </label>
        <label class="flex items-center gap-2 self-end text-xs text-slate-400">
          <input
            v-model="config.requireAnchorMedal"
            type="checkbox"
            @change="persist"
            class="accent-sky-500"
          />
          必须是本直播间的牌子
        </label>
      </div>

      <label v-if="config.scope === 'keyword'" class="block text-xs text-slate-400">
        触发关键词（顿号或空格分隔）
        <input
          :value="listText(config.keywords)"
          @input="setList('keywords', ($event.target as HTMLInputElement).value)"
          @change="persist"
          class="ll-input mt-1 w-full"
          placeholder="念一下、读弹幕"
        />
        <span class="mt-1 block text-[11px] text-slate-500">
          触发词本身不会念出来，只念后面的内容
        </span>
      </label>

      <label class="block text-xs text-slate-400">
        黑名单（命中就整条不念，对所有范围生效）
        <input
          :value="listText(config.blockKeywords)"
          @input="setList('blockKeywords', ($event.target as HTMLInputElement).value)"
          @change="persist"
          class="ll-input mt-1 w-full"
          placeholder="留空表示不过滤"
        />
      </label>
    </section>

    <!-- 怎么念 -->
    <section class="ll-card space-y-4 p-5">
      <header class="ll-eyebrow">怎么念</header>

      <label class="block text-xs text-slate-400">
        朗读模板
        <input
          v-model="config.template"
          @change="persist"
          class="ll-input mt-1 w-full"
          placeholder="{uname}说：{content}"
        />
        <span class="mt-1 block text-[11px] text-slate-500">
          可用 {uname}（观众昵称）和 {content}（弹幕内容）。必须包含 {content}，
          只想念内容不想念名字就填 {content}
        </span>
      </label>

      <label class="block text-xs text-slate-400">
        朗读音色
        <select v-model="config.voice" @change="persist" class="ll-input mt-1 w-full">
          <option value="">跟随「语音」页的设置</option>
          <option v-for="v in voices" :key="v.value" :value="v.value">{{ v.label }}</option>
        </select>
        <span class="mt-1 block text-[11px] text-slate-500">
          给弹幕单独挑一个音色，能和你自己的感谢播报区分开
        </span>
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-xs text-slate-400">
          单条最多念几个字
          <input
            v-model.number="config.maxLength"
            type="number" min="5" max="80"
            @change="persist"
            class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          少于几个字就不念
          <input
            v-model.number="config.minLength"
            type="number" min="1" max="20"
            @change="persist"
            class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          同一个人间隔（秒）
          <input
            v-model.number="config.perUserCooldownSec"
            type="number" min="0" max="600"
            @change="persist"
            class="ll-input mt-1 w-full"
          />
        </label>
        <label class="text-xs text-slate-400">
          相同内容多久不重复（秒）
          <input
            v-model.number="config.dedupeWindowSec"
            type="number" min="0" max="600"
            @change="persist"
            class="ll-input mt-1 w-full"
          />
        </label>
      </div>
    </section>

    <!-- 净化 -->
    <section class="ll-card space-y-3 p-5">
      <header>
        <div class="ll-eyebrow">垃圾过滤</div>
        <p class="mt-1 text-xs text-slate-500">
          弹幕是观众打的，什么都有。这几项建议全开，否则会听到一串没人听得懂的音。
        </p>
      </header>

      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.stripEmotes" type="checkbox" @change="persist" class="accent-sky-500" />
        去掉表情码<span class="text-xs text-slate-500">（[妙] [打call] 这种）</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.skipUrls" type="checkbox" @change="persist" class="accent-sky-500" />
        含网址的整条跳过<span class="text-xs text-slate-500">（关掉则把链接念成"网址"）</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.collapseRepeats" type="checkbox" @change="persist" class="accent-sky-500" />
        压缩复读<span class="text-xs text-slate-500">（6666666 → 666）</span>
      </label>
      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="config.skipHandled" type="checkbox" @change="persist" class="accent-sky-500" />
        不重复念已被接管的弹幕<span class="text-xs text-slate-500">（规则或 AI 回复已经念过的）</span>
      </label>
    </section>

    <!-- 试听 -->
    <section class="ll-card space-y-3 p-5">
      <header class="ll-eyebrow">试听</header>
      <p class="text-xs text-slate-500">
        填一条假弹幕，走完整套过滤和模板再念出来，不用真等观众发言。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="sample" class="ll-input min-w-0 flex-1" placeholder="输入一条示例弹幕" />
        <button class="ll-btn ll-btn-primary" :disabled="saving" @click="preview">试听</button>
      </div>
    </section>

    <!-- 最近念过 -->
    <section v-if="stats?.recent?.length" class="ll-card space-y-2 p-5">
      <header class="ll-eyebrow">最近念过</header>
      <div
        v-for="(r, i) in stats.recent"
        :key="`${r.at}-${i}`"
        class="flex items-baseline gap-2 text-sm"
      >
        <span class="font-mono text-[11px] text-slate-600">{{ timeText(r.at) }}</span>
        <span class="flex-none text-slate-400">{{ r.uname }}</span>
        <span class="min-w-0 truncate text-slate-200">{{ r.text }}</span>
      </div>
    </section>
  </div>
</template>
