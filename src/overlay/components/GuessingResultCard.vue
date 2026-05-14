<script setup lang="ts">
interface Option { key: string; label: string }
interface Winner { uname: string; bet: number; payout: number }

defineProps<{
  title: string
  options: Option[]
  winnerKey: string
  winnerLabel: string
  winners: Winner[]
  pool: number
  bets: Record<string, number>
}>()

const MEDALS = ['🥇', '🥈', '🥉']
</script>

<template>
  <div class="grc-wrap">
    <div class="grc-card">
      <header class="grc-header">
        <span class="grc-title-tag">🎉 竞猜揭晓</span>
      </header>
      <div class="grc-title">{{ title }}</div>
      <div class="grc-winner-row">
        <span class="grc-winner-label">赢家</span>
        <span class="grc-winner-name">{{ winnerLabel }}</span>
        <span class="grc-pool">总池 {{ pool }}</span>
      </div>

      <div v-if="winners.length === 0" class="grc-empty">
        没有人押中赢家，{{ pool }} 哈松币流失
      </div>
      <ul v-else class="grc-winners">
        <li
          v-for="(w, i) in winners"
          :key="i"
          class="grc-winner"
          :style="{ animationDelay: i * 0.12 + 's' }"
        >
          <span class="grc-medal">{{ MEDALS[i] ?? '🎁' }}</span>
          <span class="grc-uname">{{ w.uname }}</span>
          <span class="grc-payout">
            押 {{ w.bet }} → <strong>+{{ w.payout }}</strong>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.grc-wrap {
  pointer-events: none;
  animation: grcIn 0.6s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    grcOut 0.6s ease-in 9.4s both;
}
.grc-card {
  width: 540px;
  max-width: 88vw;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(6, 95, 70, 0.94), rgba(15, 23, 42, 0.92));
  padding: 1.4rem 1.6rem;
  color: #d1fae5;
  border: 1px solid rgba(52, 211, 153, 0.6);
  box-shadow: 0 22px 60px -10px rgba(0, 0, 0, 0.7), 0 0 36px rgba(52, 211, 153, 0.35);
}
.grc-header {
  border-bottom: 1px dashed rgba(52, 211, 153, 0.3);
  padding-bottom: 0.5rem;
  margin-bottom: 0.8rem;
}
.grc-title-tag {
  font-size: 1rem;
  font-weight: 700;
  color: #34d399;
}
.grc-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #f1f5f9;
  margin-bottom: 0.5rem;
}
.grc-winner-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: rgba(52, 211, 153, 0.15);
  padding: 0.7rem 1rem;
  border-radius: 10px;
  margin-bottom: 0.9rem;
}
.grc-winner-label { color: #34d399; font-size: 0.85rem; font-weight: 600; }
.grc-winner-name {
  flex: 1;
  font-size: 1.15rem;
  font-weight: 700;
  color: #fcd34d;
}
.grc-pool {
  font-size: 0.85rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.grc-empty {
  text-align: center;
  padding: 1.5rem;
  color: #94a3b8;
  font-size: 0.95rem;
}

.grc-winners { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.grc-winner {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  animation: winnerReveal 0.5s ease-out both;
}
.grc-medal { font-size: 1.3rem; }
.grc-uname { flex: 1; font-size: 1rem; color: #f1f5f9; font-weight: 500; }
.grc-payout {
  font-size: 0.85rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.grc-payout strong { color: #34d399; font-size: 1.1em; }

@keyframes grcIn {
  from { transform: translateY(-30px) scale(0.85); opacity: 0; filter: blur(6px); }
  to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
}
@keyframes grcOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.04); opacity: 0; }
}
@keyframes winnerReveal {
  from { transform: translateX(-12px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
</style>
