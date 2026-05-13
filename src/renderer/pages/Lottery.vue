<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { lotteryState, isConnected } from '../store'
import type { LotteryConfig } from '../types'

const form = ref<LotteryConfig>({
  prize: '神秘奖品',
  keyword: '抽奖',
  winnerCount: 1,
  durationSec: 60,
  requireAnchorFansMedal: false,
  minFansMedalLevel: 0
})
const submitting = ref(false)
const error = ref<string | null>(null)

// 倒计时秒数（每秒更新一次显示）
const tick = ref(Date.now())
let tickTimer: number | null = null
onMounted(async () => {
  // 加载上次的 preset 回填表单
  try {
    const preset = await window.api.lotteryGetPreset()
    if (preset) form.value = preset
  } catch (err) {
    console.error('lotteryGetPreset failed', err)
  }
  tickTimer = window.setInterval(() => (tick.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer)
})

const remainingSec = computed(() => {
  if (lotteryState.value.phase !== 'running') return 0
  const ms = lotteryState.value.endsAt - tick.value
  return Math.max(0, Math.ceil(ms / 1000))
})

const isIdle = computed(() => lotteryState.value.phase === 'idle')
const isRunning = computed(() => lotteryState.value.phase === 'running')
const isDone = computed(() => lotteryState.value.phase === 'done')

async function startLottery(): Promise<void> {
  error.value = null
  if (!isConnected.value) {
    error.value = '直播间未连接。回首页连上再来'
    return
  }
  submitting.value = true
  try {
    await window.api.lotteryStart(JSON.parse(JSON.stringify(form.value)))
  } catch (err) {
    error.value = (err as Error)?.message ?? '启动抽奖失败'
  } finally {
    submitting.value = false
  }
}

async function cancelLottery(): Promise<void> {
  try {
    await window.api.lotteryCancel()
  } catch (err) {
    error.value = (err as Error)?.message ?? '取消失败'
  }
}

async function drawNow(): Promise<void> {
  try {
    await window.api.lotteryDrawNow()
  } catch (err) {
    error.value = (err as Error)?.message ?? '立即开奖失败'
  }
}

async function resetLottery(): Promise<void> {
  await window.api.lotteryReset()
}

// 复制中奖名单到剪贴板
const copyToast = ref<string | null>(null)
async function copyWinners(): Promise<void> {
  if (lotteryState.value.phase !== 'done') return
  const text = lotteryState.value.winners.map((w) => `${w.uname} (uid:${w.uid})`).join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copyToast.value = '已复制中奖名单'
    setTimeout(() => (copyToast.value = null), 2000)
  } catch {
    copyToast.value = '复制失败'
    setTimeout(() => (copyToast.value = null), 2000)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">弹幕抽奖</h1>
      <p class="mt-1 text-sm text-slate-400">
        发起一轮抽奖：观众发关键词参与 → 倒计时结束 → 随机抽 N 名 → Overlay 弹出公布
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- idle: 配置表单 -->
    <section v-if="isIdle" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
      <h2 class="text-sm font-medium text-slate-300">配置本轮抽奖</h2>

      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-slate-400">
          奖品名（仅用于 Overlay 显示）
          <input
            v-model="form.prize"
            type="text"
            maxlength="40"
            placeholder="例：B 站大会员月卡"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          参与关键词（弹幕包含即算参与）
          <input
            v-model="form.keyword"
            type="text"
            maxlength="20"
            placeholder="例：抽奖 / 抽抽抽"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          中奖人数（1-50）
          <input
            v-model.number="form.winnerCount"
            type="number" min="1" max="50"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          倒计时（10-600 秒）
          <input
            v-model.number="form.durationSec"
            type="number" min="10" max="600"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>

      <div class="space-y-2 rounded-lg bg-slate-950/40 p-3">
        <label class="flex items-center gap-2 text-xs text-slate-300">
          <input v-model="form.requireAnchorFansMedal" type="checkbox" />
          <span>仅本主播粉丝牌可参与</span>
        </label>
        <label class="block text-xs text-slate-400">
          最低粉丝牌等级（0 = 不限。设了上面"仅本主播"才有意义）
          <input
            v-model.number="form.minFansMedalLevel"
            type="number" min="0" max="40"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <p class="text-[11px] text-slate-500">
          注意：B 站弹幕事件携带的 badge 信息只对发过弹幕/送过礼物的用户有，纯潜水进房的不会被识别。
        </p>
      </div>

      <div class="flex justify-end">
        <button
          @click="startLottery"
          :disabled="submitting"
          class="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
        >{{ submitting ? '启动中…' : '🎰 开始抽奖' }}</button>
      </div>
    </section>

    <!-- running: 进行中 -->
    <section v-if="isRunning && lotteryState.phase === 'running'" class="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-medium text-amber-200">🎰 抽奖进行中</h2>
          <div class="mt-2 text-base text-slate-200">奖品：<strong class="text-amber-300">{{ lotteryState.config.prize || '未填' }}</strong></div>
          <div class="mt-1 text-xs text-slate-400">
            关键词：<code class="bg-slate-950 px-1.5 py-0.5 rounded">{{ lotteryState.config.keyword }}</code>
            · 抽 {{ lotteryState.config.winnerCount }} 名
          </div>
        </div>
        <div class="text-right">
          <div class="text-4xl font-bold text-amber-300 tabular-nums">{{ remainingSec }}s</div>
          <div class="text-xs text-slate-500 mt-1">参与 <strong class="text-slate-200">{{ lotteryState.participantCount }}</strong> 人</div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button
          @click="cancelLottery"
          class="rounded bg-slate-700 px-4 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
        >取消</button>
        <button
          @click="drawNow"
          class="rounded bg-amber-500 px-4 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-400"
        >🎲 立即开奖</button>
      </div>
    </section>

    <!-- done: 结果 -->
    <section v-if="isDone && lotteryState.phase === 'done'" class="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium text-emerald-200">🎉 抽奖结果</h2>
          <div class="mt-1 text-xs text-slate-400">
            奖品：{{ lotteryState.config.prize || '未填' }} ·
            参与 {{ lotteryState.participantCount }} 人 ·
            抽 {{ lotteryState.config.winnerCount }} 名
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="copyToast" class="text-xs text-emerald-400">{{ copyToast }}</span>
          <button
            @click="copyWinners"
            class="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
          >复制名单</button>
          <button
            @click="resetLottery"
            class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >关闭，开新一轮</button>
        </div>
      </div>

      <div v-if="lotteryState.winners.length === 0" class="rounded-lg bg-slate-950/40 p-4 text-center text-sm text-slate-500">
        没有人参与
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="(w, i) in lotteryState.winners"
          :key="w.uid"
          class="flex items-center gap-3 rounded-lg bg-slate-950/40 px-4 py-2"
        >
          <span class="text-xl">{{ ['🥇', '🥈', '🥉'][i] ?? '🎁' }}</span>
          <span class="flex-1 text-base font-medium text-slate-100">{{ w.uname }}</span>
          <span class="text-xs text-slate-500">uid: {{ w.uid }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
