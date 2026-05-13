<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  prize: string
  keyword: string
  winnerCount: number
  endsAt: number
  participantCount: number
}>()

// 每秒重算剩余时间
const tick = ref(Date.now())
const timer = window.setInterval(() => (tick.value = Date.now()), 500)
onBeforeUnmount(() => window.clearInterval(timer))

const remainingSec = computed(() => {
  const ms = props.endsAt - tick.value
  return Math.max(0, Math.ceil(ms / 1000))
})

// 倒计时最后 5 秒颜色变红 + 脉冲
const isUrgent = computed(() => remainingSec.value <= 5 && remainingSec.value > 0)

// 参与人数变化的小动画 trigger
const pulseKey = ref(0)
watch(
  () => props.participantCount,
  () => (pulseKey.value++)
)
</script>

<template>
  <div class="lottery-card-wrap">
    <div class="lottery-card">
      <div class="header">
        <span class="badge">🎰 抽奖进行中</span>
        <span class="keyword">发"<code>{{ keyword }}</code>"参与</span>
      </div>

      <div v-if="prize" class="prize">奖品：{{ prize }}</div>

      <div class="countdown-row">
        <div class="countdown" :class="{ urgent: isUrgent }">{{ remainingSec }}<span class="sec">s</span></div>
        <div class="stats">
          <div class="winner-count">抽 <strong>{{ winnerCount }}</strong> 名</div>
          <div class="participant" :key="pulseKey">
            已 <strong>{{ participantCount }}</strong> 人参与
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lottery-card-wrap {
  pointer-events: none;
  animation: cardIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}
.lottery-card {
  width: 460px;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(120, 53, 15, 0.92), rgba(15, 23, 42, 0.88));
  padding: 1.4rem 1.6rem;
  color: #fef3c7;
  box-shadow:
    0 20px 60px -10px rgba(0, 0, 0, 0.7),
    0 0 32px 4px rgba(251, 191, 36, 0.35);
  border: 1px solid rgba(251, 191, 36, 0.5);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
}
.badge {
  font-size: 0.85rem;
  font-weight: 600;
  color: #fcd34d;
}
.keyword {
  font-size: 0.78rem;
  color: #fde68a;
}
.keyword code {
  background: rgba(0, 0, 0, 0.35);
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
  font-family: 'Consolas', monospace;
}
.prize {
  font-size: 1.05rem;
  font-weight: 500;
  color: #fef3c7;
  margin-bottom: 0.6rem;
}
.countdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.countdown {
  font-size: 3.6rem;
  font-weight: 700;
  color: #fcd34d;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-shadow: 0 0 20px rgba(252, 211, 77, 0.6);
}
.countdown .sec { font-size: 1.4rem; opacity: 0.7; margin-left: 4px; }
.countdown.urgent {
  color: #fb7185;
  text-shadow: 0 0 24px rgba(251, 113, 133, 0.9);
  animation: urgentPulse 0.6s ease-in-out infinite alternate;
}
.stats {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.winner-count, .participant {
  font-size: 0.95rem;
  color: #fde68a;
}
.participant strong, .winner-count strong { color: #fcd34d; font-size: 1.3em; }
.participant {
  animation: countPulse 0.4s ease-out;
}

@keyframes cardIn {
  from { transform: translateY(-30px) scale(0.85); opacity: 0; }
  to   { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes urgentPulse {
  from { transform: scale(1); }
  to   { transform: scale(1.08); }
}
@keyframes countPulse {
  0%   { transform: scale(1); color: #fcd34d; }
  50%  { transform: scale(1.15); color: #fef3c7; }
  100% { transform: scale(1); color: #fde68a; }
}
</style>
