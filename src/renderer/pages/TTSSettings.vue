<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ttsConfig, voices } from '../store'

const localConfig = ref({
  enabled: true,
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  volume: '+0%'
})
const saving = ref(false)
const error = ref<string | null>(null)
const testToast = ref<string | null>(null)

watch(
  ttsConfig,
  (c) => {
    if (c) localConfig.value = { ...c }
  },
  { immediate: true }
)

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
  try {
    const next = await window.api.patchTts(localConfig.value)
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
  </div>
</template>
