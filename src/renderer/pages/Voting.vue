<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { votingState, isConnected } from '../store'
import type { VotingConfig, VotingOption } from '../types'

const form = ref<VotingConfig>({
  title: '晚饭吃什么？',
  options: [
    { key: '1', label: '米饭' },
    { key: '2', label: '面条' }
  ],
  durationSec: 60,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0,
  allowChangeVote: true
})
const submitting = ref(false)
const error = ref<string | null>(null)

const tick = ref(Date.now())
let tickTimer: number | null = null
onMounted(async () => {
  try {
    const preset = await window.api.votingGetPreset()
    if (preset) form.value = preset
  } catch (err) {
    console.error('votingGetPreset failed', err)
  }
  tickTimer = window.setInterval(() => (tick.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer)
})

const remainingSec = computed(() => {
  if (votingState.value.phase !== 'running') return 0
  const ms = votingState.value.endsAt - tick.value
  return Math.max(0, Math.ceil(ms / 1000))
})

const isIdle = computed(() => votingState.value.phase === 'idle')
const isRunning = computed(() => votingState.value.phase === 'running')
const isDone = computed(() => votingState.value.phase === 'done')

function addOption(): void {
  if (form.value.options.length >= 6) {
    error.value = '最多 6 个选项'
    return
  }
  const used = new Set(form.value.options.map((o) => o.key))
  const candidates = ['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D']
  const key = candidates.find((c) => !used.has(c)) ?? String(form.value.options.length + 1)
  form.value.options.push({ key, label: '' })
  error.value = null
}

function removeOption(idx: number): void {
  if (form.value.options.length <= 2) {
    error.value = '至少 2 个选项'
    return
  }
  form.value.options.splice(idx, 1)
  error.value = null
}

async function startVoting(): Promise<void> {
  error.value = null
  if (!isConnected.value) {
    error.value = '直播间未连接。回首页连上再来'
    return
  }
  submitting.value = true
  try {
    await window.api.votingStart(JSON.parse(JSON.stringify(form.value)))
  } catch (err) {
    error.value = (err as Error)?.message ?? '启动投票失败'
  } finally {
    submitting.value = false
  }
}

async function cancelVoting(): Promise<void> {
  try {
    await window.api.votingCancel()
  } catch (err) {
    error.value = (err as Error)?.message ?? '取消失败'
  }
}

async function endNow(): Promise<void> {
  try {
    await window.api.votingEndNow()
  } catch (err) {
    error.value = (err as Error)?.message ?? '立即结束失败'
  }
}

async function resetVoting(): Promise<void> {
  await window.api.votingReset()
}

// running 状态下，按 totalVotes 算每个选项的百分比
function percent(opt: VotingOption): number {
  const s = votingState.value
  if (s.phase === 'idle') return 0
  const c = s.counts[opt.key] ?? 0
  if (s.totalVotes === 0) return 0
  return Math.round((c / s.totalVotes) * 100)
}
function countOf(opt: VotingOption): number {
  const s = votingState.value
  if (s.phase === 'idle') return 0
  return s.counts[opt.key] ?? 0
}

const winnerLabel = computed(() => {
  const s = votingState.value
  if (s.phase !== 'done' || !s.winnerKey) return null
  return s.config.options.find((o) => o.key === s.winnerKey)?.label ?? s.winnerKey
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">互动投票</h1>
      <p class="mt-1 text-sm text-slate-400">
        发起一轮投票：观众弹幕发选项 key（完全等于 "1" / "A" 才算）→ 实时柱状图 → 倒计时结束公布赢家
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- idle: 配置 -->
    <section v-if="isIdle" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
      <h2 class="text-sm font-medium text-slate-300">配置投票</h2>

      <label class="block text-xs text-slate-400">
        投票标题
        <input
          v-model="form.title"
          type="text"
          maxlength="60"
          placeholder="例：今晚玩哪个游戏"
          class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        />
      </label>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs text-slate-400">选项（2-6 个）</label>
          <button
            v-if="form.options.length < 6"
            @click="addOption"
            class="text-xs text-sky-400 hover:underline"
          >+ 添加</button>
        </div>
        <div
          v-for="(opt, idx) in form.options"
          :key="idx"
          class="flex items-center gap-2"
        >
          <input
            v-model="opt.key"
            type="text"
            maxlength="4"
            placeholder="key"
            class="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 text-center font-mono"
          />
          <input
            v-model="opt.label"
            type="text"
            maxlength="30"
            placeholder="选项名"
            class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            @click="removeOption(idx)"
            :disabled="form.options.length <= 2"
            class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-rose-600/60 disabled:opacity-30"
          >×</button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-slate-400">
          倒计时（10-600 秒）
          <input
            v-model.number="form.durationSec"
            type="number" min="10" max="600"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="flex items-center gap-2 mt-5 text-xs text-slate-300">
          <input v-model="form.allowChangeVote" type="checkbox" />
          <span>允许改投（覆盖之前的选票）</span>
        </label>
      </div>

      <div class="space-y-2 rounded-lg bg-slate-950/40 p-3">
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input v-model="form.requireAnchorFansMedal" type="checkbox" />
          <span>仅本主播粉丝牌可投票</span>
        </label>
        <label class="block text-xs text-slate-400">
          最低粉丝牌等级（0 = 不限）
          <input
            v-model.number="form.minFansMedalLevel"
            type="number" min="0" max="40"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>

      <div class="flex justify-end">
        <button
          @click="startVoting"
          :disabled="submitting"
          class="rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >{{ submitting ? '启动中…' : '📊 开始投票' }}</button>
      </div>
    </section>

    <!-- running: 进行中（实时柱状图） -->
    <section
      v-if="isRunning && votingState.phase === 'running'"
      class="rounded-2xl border border-sky-500/40 bg-sky-500/5 p-5 space-y-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-sky-200">📊 投票进行中</h2>
          <div class="mt-1 text-base text-slate-200 truncate">{{ votingState.config.title }}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-3xl font-bold text-sky-300 tabular-nums">{{ remainingSec }}s</div>
          <div class="text-xs text-slate-500 mt-0.5">共 <strong class="text-slate-200">{{ votingState.totalVotes }}</strong> 票</div>
        </div>
      </div>

      <div class="space-y-2">
        <div v-for="opt in votingState.config.options" :key="opt.key" class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300">
              <code class="bg-slate-950 px-1.5 py-0.5 rounded mr-1.5">{{ opt.key }}</code>
              {{ opt.label }}
            </span>
            <span class="text-slate-400 tabular-nums">{{ countOf(opt) }} 票 · {{ percent(opt) }}%</span>
          </div>
          <div class="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-sky-500 to-sky-400 transition-all duration-300"
              :style="{ width: percent(opt) + '%' }"
            ></div>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          @click="cancelVoting"
          class="rounded bg-slate-700 px-4 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
        >取消</button>
        <button
          @click="endNow"
          class="rounded bg-sky-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-400"
        >立即结束</button>
      </div>
    </section>

    <!-- done: 结果 -->
    <section
      v-if="isDone && votingState.phase === 'done'"
      class="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-emerald-200">🎉 投票结果</h2>
          <div class="mt-1 text-base text-slate-200 truncate">{{ votingState.config.title }}</div>
          <div class="mt-1 text-xs text-slate-400">
            共 {{ votingState.totalVotes }} 票
            <span v-if="winnerLabel"> · 赢家：<strong class="text-emerald-300">{{ winnerLabel }}</strong></span>
            <span v-else> · 没有人投票</span>
          </div>
        </div>
        <button
          @click="resetVoting"
          class="shrink-0 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >关闭，开新一轮</button>
      </div>

      <div class="space-y-2">
        <div v-for="opt in votingState.config.options" :key="opt.key" class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300">
              <code class="bg-slate-950 px-1.5 py-0.5 rounded mr-1.5">{{ opt.key }}</code>
              {{ opt.label }}
              <span v-if="opt.key === votingState.winnerKey" class="ml-1 text-emerald-300">★ 赢</span>
            </span>
            <span class="text-slate-400 tabular-nums">{{ countOf(opt) }} 票 · {{ percent(opt) }}%</span>
          </div>
          <div class="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              class="h-full"
              :class="opt.key === votingState.winnerKey
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : 'bg-gradient-to-r from-slate-600 to-slate-500'"
              :style="{ width: percent(opt) + '%' }"
            ></div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
