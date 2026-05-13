<script setup lang="ts">
import { computed } from 'vue'

interface RecordEntry {
  ts: number
  blindBoxName: string
  cost: number
  reward: number
  gain: number
  rewardName: string
  rewardNum: number
}

interface BlindboxRecord {
  uname: string
  firstOpenAt: number
  lastOpenAt: number
  totalCost: number
  totalReward: number
  totalOpenCount: number
  records: RecordEntry[]
}

const props = defineProps<{
  uname: string
  record: BlindboxRecord
}>()

const netGain = computed(() => props.record.totalReward - props.record.totalCost)
const isProfit = computed(() => netGain.value >= 0)

const gainText = computed(() => {
  const abs = Math.abs(netGain.value).toFixed(2)
  return isProfit.value ? `+¥${abs}` : `-¥${abs}`
})

// 最近 5 条详细记录倒序展示
const recentRecords = computed(() => [...props.record.records].slice(-5).reverse())

function gainStr(n: number): string {
  const abs = Math.abs(n).toFixed(2)
  return n >= 0 ? `+¥${abs}` : `-¥${abs}`
}
</script>

<template>
  <div class="blindbox-card">
    <div class="blindbox-card-inner">
      <header class="bb-header">
        <span class="bb-icon">🎰</span>
        <div>
          <div class="bb-title">{{ uname }} 的盲盒账本</div>
          <div class="bb-sub">累计开盒 {{ record.totalOpenCount }} 次</div>
        </div>
      </header>

      <div class="bb-stats">
        <div class="bb-stat">
          <div class="bb-stat-label">花费</div>
          <div class="bb-stat-value">¥{{ record.totalCost.toFixed(2) }}</div>
        </div>
        <div class="bb-stat">
          <div class="bb-stat-label">中奖</div>
          <div class="bb-stat-value">¥{{ record.totalReward.toFixed(2) }}</div>
        </div>
        <div class="bb-stat" :class="isProfit ? 'profit' : 'loss'">
          <div class="bb-stat-label">净盈亏</div>
          <div class="bb-stat-value">{{ gainText }}</div>
        </div>
      </div>

      <div v-if="recentRecords.length > 0" class="bb-recent">
        <div class="bb-recent-title">最近开盒</div>
        <ul>
          <li v-for="(r, i) in recentRecords" :key="i">
            <span class="bb-recent-name">{{ r.blindBoxName }} → {{ r.rewardName }}×{{ r.rewardNum }}</span>
            <span class="bb-recent-gain" :class="r.gain >= 0 ? 'profit' : 'loss'">{{ gainStr(r.gain) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.blindbox-card {
  pointer-events: none;
  animation: bbIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    bbOut 0.6s ease-in 6.4s both;
}
.blindbox-card-inner {
  width: 380px;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  padding: 1.25rem 1.5rem;
  color: #f1f5f9;
  box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.6),
    0 0 24px 2px rgba(56, 189, 248, 0.25);
  border: 1px solid rgba(148, 163, 184, 0.25);
  backdrop-filter: blur(12px);
}
.bb-header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
.bb-icon { font-size: 2.2rem; }
.bb-title { font-size: 1.1rem; font-weight: 600; }
.bb-sub { font-size: 0.8rem; color: #94a3b8; margin-top: 2px; }

.bb-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.bb-stat {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 0.625rem;
  padding: 0.5rem 0.75rem;
  text-align: center;
}
.bb-stat-label { font-size: 0.7rem; color: #94a3b8; }
.bb-stat-value { font-size: 1rem; font-weight: 600; margin-top: 2px; }
.bb-stat.profit .bb-stat-value { color: #34d399; }
.bb-stat.loss .bb-stat-value { color: #fb7185; }

.bb-recent-title {
  font-size: 0.75rem;
  color: #94a3b8;
  margin-bottom: 0.4rem;
}
.bb-recent ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.bb-recent li {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  gap: 0.5rem;
}
.bb-recent-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #cbd5e1;
}
.bb-recent-gain.profit { color: #34d399; }
.bb-recent-gain.loss { color: #fb7185; }

@keyframes bbIn {
  from { transform: translate(-50%, calc(-50% + 24px)) scale(0.92); opacity: 0; }
  to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
@keyframes bbOut {
  from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  to   { transform: translate(-50%, calc(-50% - 24px)) scale(0.95); opacity: 0; }
}
</style>
