<script setup lang="ts">
// 竞猜 overlay 卡，两阶段：enrolling 押注期 + settling 买定离手等结算
// enrolling: 含倒计时
// settling: 显示"买定离手"标志，等主播侧选赢家

import { computed, onBeforeUnmount, ref } from 'vue'

interface Option {
  key: string
  label: string
}

const props = defineProps<{
  phase: 'enrolling' | 'settling'
  title: string
  options: Option[]
  bets: Record<string, number>
  pool: number
  bettorCount: number
  currencyName: string
  defaultBet: number
  endsAt?: number // 仅 enrolling
}>()

const tick = ref(Date.now())
const timer = window.setInterval(() => (tick.value = Date.now()), 500)
onBeforeUnmount(() => window.clearInterval(timer))

const remainingSec = computed(() => {
  if (props.phase !== 'enrolling' || !props.endsAt) return 0
  return Math.max(0, Math.ceil((props.endsAt - tick.value) / 1000))
})
const isUrgent = computed(() => remainingSec.value <= 5 && remainingSec.value > 0)

function betOf(opt: Option): number {
  return props.bets[opt.key] ?? 0
}
function percent(opt: Option): number {
  if (props.pool === 0) return 0
  return Math.round((betOf(opt) / props.pool) * 100)
}
</script>

<template>
  <div class="gc-wrap">
    <div class="gc-card">
      <header class="gc-header">
        <div>
          <span v-if="phase === 'enrolling'" class="gc-badge">🎲 押注进行中</span>
          <span v-else class="gc-badge gc-badge-locked">🔒 买定离手</span>
          <div class="gc-title">{{ title }}</div>
        </div>
        <div class="gc-right">
          <div v-if="phase === 'enrolling'" class="gc-countdown" :class="{ urgent: isUrgent }">{{ remainingSec }}<span class="sec">s</span></div>
          <div v-else class="gc-locked-tag">等待开奖</div>
          <div class="gc-pool">
            池 <strong>{{ pool }}</strong> {{ currencyName }} · {{ bettorCount }} 人
          </div>
        </div>
      </header>

      <div class="gc-bars">
        <div v-for="opt in options" :key="opt.key" class="gc-bar">
          <div class="gc-bar-header">
            <span class="gc-key">{{ opt.key }}</span>
            <span class="gc-label">{{ opt.label }}</span>
            <span class="gc-count">{{ betOf(opt) }} · {{ percent(opt) }}%</span>
          </div>
          <div class="gc-bar-track">
            <div class="gc-bar-fill" :style="{ width: percent(opt) + '%' }"></div>
          </div>
        </div>
      </div>

      <div v-if="phase === 'enrolling'" class="gc-hint">
        发"<code>{{ options[0]?.key ?? '1' }}</code>"押 {{ defaultBet }} {{ currencyName }} ·
        "<code>{{ options[0]?.key ?? '1' }} 500</code>"押 500 ·
        改选项 = 退还前面再押新的
      </div>
      <div v-else class="gc-hint gc-hint-locked">
        押注已截止，等待主播宣布结果
      </div>
    </div>
  </div>
</template>

<style scoped>
.gc-wrap {
  pointer-events: none;
  animation: gcIn 0.55s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}
.gc-card {
  width: 540px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(120, 53, 15, 0.82));
  padding: 1.2rem 1.5rem;
  color: #fef3c7;
  border: 1px solid rgba(251, 191, 36, 0.5);
  box-shadow: 0 18px 50px -10px rgba(0, 0, 0, 0.7), 0 0 28px rgba(251, 191, 36, 0.3);
}
.gc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.9rem;
  gap: 1rem;
}
.gc-badge {
  font-size: 0.85rem;
  font-weight: 700;
  color: #fcd34d;
}
.gc-badge-locked { color: #93c5fd; }
.gc-title {
  font-size: 1.15rem;
  color: #f1f5f9;
  margin-top: 4px;
  font-weight: 500;
}
.gc-right { text-align: right; flex-shrink: 0; }
.gc-countdown {
  font-size: 2.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fcd34d;
  line-height: 1;
}
.gc-countdown .sec { font-size: 1.1rem; opacity: 0.7; margin-left: 2px; }
.gc-countdown.urgent {
  color: #fb7185;
  animation: urgentPulse 0.6s ease-in-out infinite alternate;
}
.gc-locked-tag {
  font-size: 1.1rem;
  color: #93c5fd;
  font-weight: 600;
}
.gc-pool {
  font-size: 0.78rem;
  color: #fde68a;
  margin-top: 4px;
}
.gc-pool strong { color: #fef3c7; }

.gc-bars { display: flex; flex-direction: column; gap: 8px; }
.gc-bar { display: flex; flex-direction: column; gap: 3px; }
.gc-bar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}
.gc-key {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  background: rgba(251, 191, 36, 0.2);
  color: #fcd34d;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: 'Consolas', monospace;
}
.gc-label { flex: 1; color: #fef3c7; }
.gc-count { color: #fde68a; font-variant-numeric: tabular-nums; }

.gc-bar-track {
  height: 11px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.gc-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #d97706, #fbbf24);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
}

.gc-hint {
  margin-top: 0.9rem;
  font-size: 0.74rem;
  color: #94a3b8;
  text-align: center;
}
.gc-hint code {
  background: rgba(0, 0, 0, 0.4);
  padding: 1px 5px;
  border-radius: 3px;
  color: #fde68a;
  font-family: 'Consolas', monospace;
}
.gc-hint-locked { color: #93c5fd; font-size: 0.85rem; font-weight: 500; }

@keyframes gcIn {
  from { transform: translateY(-24px) scale(0.92); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes urgentPulse {
  from { transform: scale(1); }
  to   { transform: scale(1.1); }
}
</style>
