<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

interface Option {
  key: string
  label: string
}

const props = defineProps<{
  title: string
  options: Option[]
  endsAt: number
  counts: Record<string, number>
  totalVotes: number
}>()

const tick = ref(Date.now())
const timer = window.setInterval(() => (tick.value = Date.now()), 500)
onBeforeUnmount(() => window.clearInterval(timer))

const remainingSec = computed(() => Math.max(0, Math.ceil((props.endsAt - tick.value) / 1000)))
const isUrgent = computed(() => remainingSec.value <= 5 && remainingSec.value > 0)

function percent(opt: Option): number {
  if (props.totalVotes === 0) return 0
  const c = props.counts[opt.key] ?? 0
  return Math.round((c / props.totalVotes) * 100)
}
function countOf(opt: Option): number {
  return props.counts[opt.key] ?? 0
}
</script>

<template>
  <div class="voting-wrap">
    <div class="voting-card">
      <header class="vc-header">
        <span class="vc-badge">📊 投票进行中</span>
        <span class="vc-countdown" :class="{ urgent: isUrgent }">{{ remainingSec }}s</span>
      </header>

      <div class="vc-title">{{ title }}</div>

      <div class="vc-bars">
        <div v-for="opt in options" :key="opt.key" class="vc-bar">
          <div class="vc-bar-header">
            <span class="vc-key">{{ opt.key }}</span>
            <span class="vc-label">{{ opt.label }}</span>
            <span class="vc-count">{{ countOf(opt) }} · {{ percent(opt) }}%</span>
          </div>
          <div class="vc-bar-track">
            <div class="vc-bar-fill" :style="{ width: percent(opt) + '%' }"></div>
          </div>
        </div>
      </div>

      <div class="vc-footer">
        共 <strong>{{ totalVotes }}</strong> 票 · 发"<code>1</code>"/"<code>A</code>"等参与
      </div>
    </div>
  </div>
</template>

<style scoped>
.voting-wrap {
  pointer-events: none;
  animation: vcIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}
.voting-card {
  width: 500px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(7, 89, 133, 0.78));
  padding: 1.2rem 1.4rem;
  color: #e0f2fe;
  border: 1px solid rgba(56, 189, 248, 0.5);
  box-shadow: 0 16px 50px -10px rgba(0, 0, 0, 0.65), 0 0 30px rgba(56, 189, 248, 0.25);
}
.vc-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.6rem;
}
.vc-badge {
  font-size: 0.85rem;
  font-weight: 600;
  color: #7dd3fc;
}
.vc-countdown {
  font-size: 1.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #7dd3fc;
  line-height: 1;
}
.vc-countdown.urgent {
  color: #fb7185;
  animation: urgentPulse 0.6s ease-in-out infinite alternate;
}
.vc-title {
  font-size: 1.15rem;
  font-weight: 500;
  color: #f1f5f9;
  margin-bottom: 1rem;
  word-break: break-word;
}

.vc-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vc-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vc-bar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}
.vc-key {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  background: rgba(56, 189, 248, 0.25);
  color: #bae6fd;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: 'Consolas', monospace;
}
.vc-label { flex: 1; color: #f1f5f9; }
.vc-count { color: #cbd5e1; font-variant-numeric: tabular-nums; }

.vc-bar-track {
  height: 12px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  overflow: hidden;
}
.vc-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #0ea5e9, #38bdf8);
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.6);
}

.vc-footer {
  margin-top: 0.9rem;
  text-align: center;
  font-size: 0.78rem;
  color: #94a3b8;
}
.vc-footer code {
  background: rgba(0, 0, 0, 0.4);
  padding: 1px 5px;
  border-radius: 3px;
  color: #bae6fd;
}
.vc-footer strong { color: #f1f5f9; }

@keyframes vcIn {
  from { transform: translateY(-24px) scale(0.92); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes urgentPulse {
  from { transform: scale(1); }
  to   { transform: scale(1.12); }
}
</style>
