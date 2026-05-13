<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { horseRaceState, isConnected } from '../store'
import type { HorseRaceConfig, Horse } from '../types'

const form = ref<HorseRaceConfig>({
  horses: [
    { key: '1', name: '红马', emoji: '🐎' },
    { key: '2', name: '黑马', emoji: '🐴' },
    { key: '3', name: '白马', emoji: '🦄' },
    { key: '4', name: '黄马', emoji: '🐎' }
  ],
  enrollSec: 30,
  raceSec: 25,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0
})
const submitting = ref(false)
const error = ref<string | null>(null)

const tick = ref(Date.now())
let tickTimer: number | null = null
onMounted(async () => {
  try {
    const preset = await window.api.horseRaceGetPreset()
    if (preset) form.value = preset
  } catch (err) {
    console.error('horseRaceGetPreset failed', err)
  }
  tickTimer = window.setInterval(() => (tick.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer)
})

const remainingEnrollSec = computed(() => {
  if (horseRaceState.value.phase !== 'enrolling') return 0
  return Math.max(0, Math.ceil((horseRaceState.value.endsAt - tick.value) / 1000))
})

const isIdle = computed(() => horseRaceState.value.phase === 'idle')
const isEnrolling = computed(() => horseRaceState.value.phase === 'enrolling')
const isRacing = computed(() => horseRaceState.value.phase === 'racing')
const isDone = computed(() => horseRaceState.value.phase === 'done')

function addHorse(): void {
  if (form.value.horses.length >= 8) {
    error.value = '最多 8 匹马'
    return
  }
  const used = new Set(form.value.horses.map((h) => h.key))
  const candidates = ['1', '2', '3', '4', '5', '6', '7', '8']
  const key = candidates.find((c) => !used.has(c)) ?? String(form.value.horses.length + 1)
  form.value.horses.push({ key, name: '', emoji: '🐎' })
  error.value = null
}
function removeHorse(idx: number): void {
  if (form.value.horses.length <= 2) {
    error.value = '至少 2 匹马'
    return
  }
  form.value.horses.splice(idx, 1)
  error.value = null
}

async function startRace(): Promise<void> {
  error.value = null
  if (!isConnected.value) {
    error.value = '直播间未连接。回首页连上再来'
    return
  }
  submitting.value = true
  try {
    await window.api.horseRaceStart(JSON.parse(JSON.stringify(form.value)))
  } catch (err) {
    error.value = (err as Error)?.message ?? '启动赛马失败'
  } finally {
    submitting.value = false
  }
}

async function cancelRace(): Promise<void> {
  try {
    await window.api.horseRaceCancel()
  } catch (err) {
    error.value = (err as Error)?.message ?? '取消失败'
  }
}
async function startRaceNow(): Promise<void> {
  try {
    await window.api.horseRaceStartNow()
  } catch (err) {
    error.value = (err as Error)?.message ?? '立即开赛失败'
  }
}
async function resetRace(): Promise<void> {
  await window.api.horseRaceReset()
}

function enrollOf(h: Horse): number {
  const s = horseRaceState.value
  if (s.phase !== 'enrolling' && s.phase !== 'racing' && s.phase !== 'done') return 0
  return s.enrollments[h.key] ?? 0
}
function positionOf(h: Horse): number {
  const s = horseRaceState.value
  if (s.phase !== 'racing') return 0
  return Math.round(s.positions[h.key] ?? 0)
}
function rankOf(h: Horse): number {
  const s = horseRaceState.value
  if (s.phase !== 'done') return 0
  return s.rankings.find((r) => r.horseKey === h.key)?.rank ?? 0
}

const winnerHorse = computed(() => {
  const s = horseRaceState.value
  if (s.phase !== 'done' || s.rankings.length === 0) return null
  const winKey = s.rankings[0].horseKey
  return s.config.horses.find((h) => h.key === winKey) ?? null
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">赛马</h1>
      <p class="mt-1 text-sm text-slate-400">
        2-8 匹马 → 观众弹幕选号报名 → 随机赛跑动画 → 公布排名 + 押中第一名的观众名单
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- idle: 配置 -->
    <section v-if="isIdle" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
      <h2 class="text-sm font-medium text-slate-300">配置本轮赛马</h2>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs text-slate-400">马匹（2-8 匹）</label>
          <button
            v-if="form.horses.length < 8"
            @click="addHorse"
            class="text-xs text-sky-400 hover:underline"
          >+ 加马</button>
        </div>
        <div
          v-for="(h, idx) in form.horses"
          :key="idx"
          class="flex items-center gap-2"
        >
          <input
            v-model="h.key"
            type="text"
            maxlength="4"
            placeholder="号"
            class="w-14 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 text-center font-mono"
          />
          <input
            v-model="h.emoji"
            type="text"
            maxlength="2"
            placeholder="🐎"
            class="w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 text-center"
          />
          <input
            v-model="h.name"
            type="text"
            maxlength="20"
            placeholder="马名"
            class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
          <button
            @click="removeHorse(idx)"
            :disabled="form.horses.length <= 2"
            class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-rose-600/60 disabled:opacity-30"
          >×</button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-slate-400">
          报名时长（10-60 秒）
          <input
            v-model.number="form.enrollSec"
            type="number" min="10" max="60"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          赛跑时长上限（10-30 秒）
          <input
            v-model.number="form.raceSec"
            type="number" min="10" max="30"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>

      <div class="space-y-2 rounded-lg bg-slate-950/40 p-3">
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input v-model="form.requireAnchorFansMedal" type="checkbox" />
          <span>仅本主播粉丝牌可报名</span>
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
          @click="startRace"
          :disabled="submitting"
          class="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-400 disabled:opacity-50"
        >{{ submitting ? '启动中…' : '🏁 开始赛马' }}</button>
      </div>
    </section>

    <!-- enrolling: 报名中 -->
    <section
      v-if="isEnrolling && horseRaceState.phase === 'enrolling'"
      class="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-medium text-amber-200">🏁 报名进行中</h2>
          <div class="mt-1 text-xs text-slate-400">观众发马号（如"1"/"2"）选号报名，同 uid 改投覆盖</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-3xl font-bold text-amber-300 tabular-nums">{{ remainingEnrollSec }}s</div>
        </div>
      </div>

      <div class="space-y-2">
        <div
          v-for="h in horseRaceState.config.horses"
          :key="h.key"
          class="flex items-center justify-between gap-2 rounded-lg bg-slate-950/40 px-3 py-2"
        >
          <div class="flex items-center gap-2">
            <span class="text-xl">{{ h.emoji }}</span>
            <code class="bg-slate-950 px-1.5 py-0.5 rounded text-xs">{{ h.key }}</code>
            <span class="text-sm text-slate-200">{{ h.name }}</span>
          </div>
          <span class="text-xs text-slate-400">押 <strong class="text-amber-300">{{ enrollOf(h) }}</strong> 人</span>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          @click="cancelRace"
          class="rounded bg-slate-700 px-4 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
        >取消</button>
        <button
          @click="startRaceNow"
          class="rounded bg-amber-500 px-4 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-400"
        >🏁 立即开赛</button>
      </div>
    </section>

    <!-- racing: 比赛中（mini 赛道） -->
    <section
      v-if="isRacing && horseRaceState.phase === 'racing'"
      class="rounded-2xl border border-sky-500/40 bg-sky-500/5 p-5 space-y-3"
    >
      <h2 class="text-sm font-medium text-sky-200">🏇 比赛进行中</h2>

      <div class="space-y-2">
        <div
          v-for="h in horseRaceState.config.horses"
          :key="h.key"
          class="space-y-1"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300">
              <span class="mr-1">{{ h.emoji }}</span>{{ h.name }}
            </span>
            <span class="text-slate-400 tabular-nums">{{ positionOf(h) }} m</span>
          </div>
          <div class="h-1.5 rounded bg-slate-800 overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-sky-500 to-sky-400 transition-all duration-200"
              :style="{ width: positionOf(h) + '%' }"
            ></div>
          </div>
        </div>
      </div>
    </section>

    <!-- done: 排名结果 -->
    <section
      v-if="isDone && horseRaceState.phase === 'done'"
      class="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-emerald-200">🎉 比赛结果</h2>
          <div v-if="winnerHorse" class="mt-1 text-base text-slate-200">
            冠军：<span class="text-2xl">{{ winnerHorse.emoji }}</span>
            <strong class="text-emerald-300 ml-1">{{ winnerHorse.name }}</strong>
          </div>
        </div>
        <button
          @click="resetRace"
          class="shrink-0 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
        >关闭，开新一轮</button>
      </div>

      <div class="space-y-1.5">
        <div
          v-for="h in horseRaceState.config.horses"
          :key="h.key"
          class="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
          :class="rankOf(h) === 1 ? 'bg-emerald-500/15' : 'bg-slate-950/40'"
        >
          <div class="flex items-center gap-3">
            <span class="text-base font-bold text-slate-400 w-6 tabular-nums">#{{ rankOf(h) }}</span>
            <span class="text-xl">{{ h.emoji }}</span>
            <span class="text-sm text-slate-200">{{ h.name }}</span>
            <span v-if="rankOf(h) === 1" class="text-emerald-300 text-xs">★ 冠军</span>
          </div>
          <span class="text-xs text-slate-400">押 {{ enrollOf(h) }} 人</span>
        </div>
      </div>

      <!-- 中奖（押中第一名）观众 -->
      <div v-if="horseRaceState.winnerBettors.length > 0" class="rounded-lg bg-slate-950/40 p-3">
        <div class="text-xs text-slate-400 mb-2">押中冠军的观众（最多 10 人）</div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="(b, i) in horseRaceState.winnerBettors"
            :key="i"
            class="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-200"
          >{{ b }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
