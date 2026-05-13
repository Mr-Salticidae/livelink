<script setup lang="ts">
// 赛马 overlay 卡，含两个阶段：enrolling 报名 + racing 赛跑
// 报名阶段：显示马匹列表 + 押注人数 + 倒计时
// 赛跑阶段：水平赛道动画，每匹马按位置滑动

import { computed, onBeforeUnmount, ref } from 'vue'

interface Horse {
  key: string
  name: string
  emoji: string
}

const props = defineProps<{
  phase: 'enrolling' | 'racing'
  horses: Horse[]
  enrollments: Record<string, number>
  positions: Record<string, number> // 赛跑阶段才有数据
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

function enrollOf(h: Horse): number {
  return props.enrollments[h.key] ?? 0
}
function positionOf(h: Horse): number {
  return Math.min(100, Math.max(0, props.positions[h.key] ?? 0))
}
</script>

<template>
  <div class="hr-wrap">
    <div class="hr-card">
      <!-- 报名阶段 -->
      <template v-if="phase === 'enrolling'">
        <header class="hr-header">
          <span class="hr-badge">🏁 赛马报名中</span>
          <span class="hr-countdown" :class="{ urgent: isUrgent }">{{ remainingSec }}s</span>
        </header>
        <p class="hr-hint">弹幕发"<code>1</code>" "<code>2</code>" 等马号 → 押注</p>
        <div class="hr-list">
          <div v-for="h in horses" :key="h.key" class="hr-list-row">
            <span class="hr-emoji">{{ h.emoji }}</span>
            <span class="hr-key">{{ h.key }}</span>
            <span class="hr-name">{{ h.name }}</span>
            <span class="hr-count">押 {{ enrollOf(h) }}</span>
          </div>
        </div>
      </template>

      <!-- 赛跑阶段 -->
      <template v-else>
        <header class="hr-header">
          <span class="hr-badge hr-badge-racing">🏇 比赛进行中</span>
          <span class="hr-finish">🏁 终点</span>
        </header>
        <div class="hr-tracks">
          <div v-for="h in horses" :key="h.key" class="hr-track">
            <div class="hr-track-line">
              <div
                class="hr-runner"
                :style="{ left: positionOf(h) + '%' }"
              >{{ h.emoji }}</div>
            </div>
            <div class="hr-track-meta">
              <span class="hr-key-small">{{ h.key }}</span>
              <span class="hr-name-small">{{ h.name }}</span>
              <span class="hr-count-small">押 {{ enrollOf(h) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hr-wrap {
  pointer-events: none;
  animation: hrIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}
.hr-card {
  width: 580px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(120, 53, 15, 0.85));
  padding: 1.3rem 1.5rem;
  color: #fef3c7;
  border: 1px solid rgba(251, 191, 36, 0.45);
  box-shadow: 0 18px 50px -10px rgba(0, 0, 0, 0.7), 0 0 28px rgba(251, 191, 36, 0.3);
}
.hr-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.5rem;
}
.hr-badge {
  font-size: 0.95rem;
  font-weight: 700;
  color: #fcd34d;
}
.hr-badge-racing {
  color: #7dd3fc;
}
.hr-countdown {
  font-size: 1.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fcd34d;
  line-height: 1;
}
.hr-countdown.urgent {
  color: #fb7185;
  animation: urgentPulse 0.6s ease-in-out infinite alternate;
}
.hr-finish {
  color: #94a3b8;
  font-size: 0.85rem;
}
.hr-hint {
  font-size: 0.78rem;
  color: #fde68a;
  margin-bottom: 0.7rem;
}
.hr-hint code {
  background: rgba(0, 0, 0, 0.4);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
}

/* enrolling 列表 */
.hr-list { display: flex; flex-direction: column; gap: 6px; }
.hr-list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 5px 10px;
}
.hr-emoji { font-size: 1.4rem; }
.hr-key {
  background: rgba(251, 191, 36, 0.2);
  color: #fcd34d;
  font-family: 'Consolas', monospace;
  font-weight: 600;
  padding: 0 6px;
  border-radius: 4px;
  min-width: 24px;
  text-align: center;
}
.hr-name { flex: 1; color: #fef3c7; font-size: 0.95rem; }
.hr-count {
  color: #fde68a;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

/* racing 赛道 */
.hr-tracks { display: flex; flex-direction: column; gap: 8px; }
.hr-track {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hr-track-line {
  position: relative;
  height: 30px;
  background: linear-gradient(to right, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.4) 95%, rgba(252, 211, 77, 0.5) 100%);
  border-radius: 6px;
  border: 1px dashed rgba(148, 163, 184, 0.2);
  overflow: hidden;
}
.hr-runner {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.6rem;
  transition: left 0.18s linear;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}
.hr-track-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 0.7rem;
  color: #94a3b8;
}
.hr-key-small {
  font-family: 'Consolas', monospace;
  background: rgba(56, 189, 248, 0.18);
  color: #7dd3fc;
  padding: 0 5px;
  border-radius: 3px;
  font-weight: 600;
}
.hr-name-small { flex: 1; color: #cbd5e1; }
.hr-count-small { color: #94a3b8; }

@keyframes hrIn {
  from { transform: translateY(-24px) scale(0.92); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes urgentPulse {
  from { transform: scale(1); }
  to   { transform: scale(1.12); }
}
</style>
