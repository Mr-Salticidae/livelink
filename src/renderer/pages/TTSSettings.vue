<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ttsConfig, voices } from '../store'
import type { EventKind } from '../types'

// 可分事件配音色的事件列表。和默认规则里的 TTS 触发器对齐
const TTS_EVENTS: { kind: EventKind; label: string; hint: string }[] = [
  { kind: 'viewer.enter', label: '欢迎进房', hint: '观众进入直播间' },
  { kind: 'danmu.received', label: '弹幕回复', hint: '关键词回复 / 你好等' },
  { kind: 'gift.received', label: '礼物感谢', hint: '收到礼物' },
  { kind: 'guard.bought', label: '上舰感谢', hint: '舰长 / 提督 / 总督' },
  { kind: 'super.chat', label: 'SuperChat 感谢', hint: '醒目留言' }
]

const localConfig = ref({
  enabled: true,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%',
  perEventVoice: {} as Partial<Record<EventKind, string>>
})
const saving = ref(false)
const error = ref<string | null>(null)
const testToast = ref<string | null>(null)

watch(
  ttsConfig,
  (c) => {
    if (c) {
      localConfig.value = {
        ...c,
        perEventVoice: { ...(c.perEventVoice ?? {}) }
      }
    }
  },
  { immediate: true }
)

function getEventVoice(kind: EventKind): string {
  return localConfig.value.perEventVoice?.[kind] ?? ''
}

async function setEventVoice(kind: EventKind, voice: string): Promise<void> {
  const next = { ...(localConfig.value.perEventVoice ?? {}) }
  if (!voice) {
    delete next[kind]
  } else {
    next[kind] = voice
  }
  localConfig.value.perEventVoice = next
  await persist()
}

async function testEventVoice(kind: EventKind): Promise<void> {
  // 试听该事件实际会用的 voice：perEvent 覆盖优先，否则全局
  const voice = getEventVoice(kind) || localConfig.value.voice
  testToast.value = '正在合成…'
  try {
    await window.api.ttsTest(undefined, voice)
    testToast.value = '播放完成'
  } catch (err) {
    testToast.value = (err as Error)?.message ?? '播放失败'
  } finally {
    setTimeout(() => (testToast.value = null), 2500)
  }
}

const ratePct = computed({
  get: () => parsePct(localConfig.value.rate),
  set: (v: number) => (localConfig.value.rate = formatPct(v))
})
const volumePct = computed({
  get: () => parsePct(localConfig.value.volume),
  set: (v: number) => (localConfig.value.volume = formatPct(v))
})

function parsePct(s: string): number {
  const m = /([-+]?\d+)/.exec(s ?? '')
  return m ? Number(m[1]) : 0
}
function formatPct(n: number): string {
  const clamped = Math.max(-50, Math.min(50, Math.round(n)))
  return clamped >= 0 ? `+${clamped}%` : `${clamped}%`
}

async function persist(): Promise<void> {
  saving.value = true
  error.value = null
  // localConfig 是 ref()，.value 是 Vue reactive Proxy。preload 已经 cleanForIpc 兜底，
  // 这里再深拷贝一层避免任何边缘情况 (Vue 版本差异 / preload 装载顺序问题等)
  const payload = JSON.parse(JSON.stringify(localConfig.value))
  try {
    const next = await window.api.patchTts(payload)
    ttsConfig.value = next
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  // 先 persist 再测试，避免设了新音色却测旧的
  await persist()
  testToast.value = '正在合成…'
  try {
    await window.api.ttsTest()
    testToast.value = '播放完成'
  } catch (err) {
    testToast.value = (err as Error)?.message ?? '播放失败'
  } finally {
    setTimeout(() => (testToast.value = null), 2500)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">TTS 设置</h1>
      <p class="mt-1 text-sm text-slate-400">调音色、调语速。改了立即保存。</p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <section class="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <header class="text-xs uppercase tracking-wide text-slate-500">全局设置</header>

      <!-- 启用 -->
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">TTS 语音播报</div>
          <div class="text-xs text-slate-500">关掉后所有规则的"念出"动作都不生效</div>
        </div>
        <button
          class="relative h-6 w-11 rounded-full transition"
          :class="localConfig.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
          @click="(localConfig.enabled = !localConfig.enabled), persist()"
        >
          <span
            class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition"
            :class="localConfig.enabled ? 'translate-x-5' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <!-- 音色 -->
      <label class="block">
        <span class="mb-1 block text-sm text-slate-300">音色</span>
        <select
          v-model="localConfig.voice"
          @change="persist"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        >
          <option v-for="v in voices" :key="v.value" :value="v.value">{{ v.label }}</option>
        </select>
      </label>

      <!-- 语速 -->
      <label class="block">
        <span class="mb-1 flex items-center justify-between text-sm text-slate-300">
          语速 <span class="text-xs text-slate-500">{{ localConfig.rate }}</span>
        </span>
        <input
          type="range" :min="-50" :max="50" :step="5"
          :value="ratePct"
          @input="(ratePct = Number(($event.target as HTMLInputElement).value))"
          @change="persist"
          class="w-full accent-sky-500"
        />
      </label>

      <!-- 音量 -->
      <label class="block">
        <span class="mb-1 flex items-center justify-between text-sm text-slate-300">
          音量 <span class="text-xs text-slate-500">{{ localConfig.volume }}</span>
        </span>
        <input
          type="range" :min="-50" :max="50" :step="5"
          :value="volumePct"
          @input="(volumePct = Number(($event.target as HTMLInputElement).value))"
          @change="persist"
          class="w-full accent-sky-500"
        />
      </label>

      <!-- 测试 -->
      <div class="flex items-center gap-3">
        <button
          @click="test"
          :disabled="saving || !localConfig.enabled"
          class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >测试声音</button>
        <span v-if="testToast" class="text-xs text-slate-400">{{ testToast }}</span>
      </div>
      <p class="text-xs text-slate-500">
        提示：edge-tts 走微软在线服务，需要联网。第一次测试可能稍慢。
      </p>
    </section>

    <!-- 多角色：分事件音色 -->
    <section class="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <header>
        <div class="text-xs uppercase tracking-wide text-slate-500">分事件音色</div>
        <p class="mt-1 text-xs text-slate-500">
          不同事件用不同音色（欢迎用萌妹、礼物用甜美、SC 用沉稳）。
          选"使用全局"即沿用上面的全局音色。语速 / 音量仍走全局。
        </p>
      </header>

      <div class="space-y-2">
        <div
          v-for="ev in TTS_EVENTS"
          :key="ev.kind"
          class="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg bg-slate-950/40 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="text-sm text-slate-200">{{ ev.label }}</div>
            <div class="text-xs text-slate-500">{{ ev.hint }}</div>
          </div>
          <select
            :value="getEventVoice(ev.kind)"
            @change="setEventVoice(ev.kind, ($event.target as HTMLSelectElement).value)"
            class="w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
          >
            <option value="">使用全局</option>
            <option v-for="v in voices" :key="v.value" :value="v.value">{{ v.label }}</option>
          </select>
          <button
            @click="testEventVoice(ev.kind)"
            :disabled="saving || !localConfig.enabled"
            class="rounded bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-50"
          >试听</button>
        </div>
      </div>
    </section>
  </div>
</template>
