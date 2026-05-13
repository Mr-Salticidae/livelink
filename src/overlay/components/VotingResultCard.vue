<script setup lang="ts">
interface Option { key: string; label: string }

const props = defineProps<{
  title: string
  options: Option[]
  counts: Record<string, number>
  totalVotes: number
  winnerKey: string | null
}>()

function percent(opt: Option): number {
  if (props.totalVotes === 0) return 0
  return Math.round(((props.counts[opt.key] ?? 0) / props.totalVotes) * 100)
}
function countOf(opt: Option): number {
  return props.counts[opt.key] ?? 0
}
</script>

<template>
  <div class="vrc-wrap">
    <div class="vrc-card">
      <header class="vrc-header">
        <span class="vrc-title-tag">🎉 投票揭晓</span>
      </header>
      <div class="vrc-title">{{ title }}</div>

      <div class="vrc-bars">
        <div
          v-for="(opt, i) in options"
          :key="opt.key"
          class="vrc-bar"
          :class="{ 'vrc-win': opt.key === winnerKey }"
          :style="{ animationDelay: i * 0.12 + 's' }"
        >
          <div class="vrc-bar-header">
            <span class="vrc-key">{{ opt.key }}</span>
            <span class="vrc-label">
              {{ opt.label }}
              <span v-if="opt.key === winnerKey" class="vrc-medal">★</span>
            </span>
            <span class="vrc-count">{{ countOf(opt) }} · {{ percent(opt) }}%</span>
          </div>
          <div class="vrc-bar-track">
            <div class="vrc-bar-fill" :style="{ width: percent(opt) + '%' }"></div>
          </div>
        </div>
      </div>

      <div class="vrc-footer">
        <span v-if="winnerKey">共 {{ totalVotes }} 票</span>
        <span v-else>没有人投票</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vrc-wrap {
  pointer-events: none;
  animation: vrcIn 0.6s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    vrcOut 0.6s ease-in 8.4s both;
}
.vrc-card {
  width: 540px;
  max-width: 88vw;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(6, 95, 70, 0.94), rgba(15, 23, 42, 0.92));
  padding: 1.4rem 1.6rem;
  color: #d1fae5;
  border: 1px solid rgba(52, 211, 153, 0.6);
  box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.7), 0 0 36px rgba(52, 211, 153, 0.35);
}
.vrc-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px dashed rgba(52, 211, 153, 0.3);
  padding-bottom: 0.5rem;
  margin-bottom: 0.7rem;
}
.vrc-title-tag {
  font-size: 1rem;
  font-weight: 700;
  color: #34d399;
}
.vrc-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: #f1f5f9;
  margin-bottom: 1rem;
  word-break: break-word;
}

.vrc-bars { display: flex; flex-direction: column; gap: 10px; }
.vrc-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  animation: barReveal 0.5s ease-out both;
}
.vrc-bar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}
.vrc-key {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  background: rgba(0, 0, 0, 0.3);
  color: #a7f3d0;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: 'Consolas', monospace;
}
.vrc-label { flex: 1; color: #f1f5f9; }
.vrc-medal { color: #fcd34d; margin-left: 4px; }
.vrc-count { color: #94a3b8; font-variant-numeric: tabular-nums; }

.vrc-bar-track {
  height: 12px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.vrc-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #64748b, #94a3b8);
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}
.vrc-win .vrc-bar-fill {
  background: linear-gradient(90deg, #10b981, #34d399);
  box-shadow: 0 0 14px rgba(52, 211, 153, 0.65);
}
.vrc-win { transform: scale(1.02); }

.vrc-footer {
  margin-top: 0.9rem;
  text-align: right;
  font-size: 0.78rem;
  color: #94a3b8;
}

@keyframes vrcIn {
  from { transform: translateY(-24px) scale(0.85); opacity: 0; filter: blur(6px); }
  to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
}
@keyframes vrcOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.04); opacity: 0; }
}
@keyframes barReveal {
  from { transform: translateX(-12px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
</style>
