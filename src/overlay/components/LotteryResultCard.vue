<script setup lang="ts">
interface Winner {
  uid: string
  uname: string
}

defineProps<{
  prize: string
  winners: Winner[]
  participantCount: number
}>()

const MEDALS = ['🥇', '🥈', '🥉']
</script>

<template>
  <div class="result-card-wrap">
    <div class="result-card">
      <div class="header">
        <span class="title">🎉 抽奖揭晓</span>
        <span class="prize" v-if="prize">{{ prize }}</span>
      </div>

      <div v-if="winners.length === 0" class="empty">
        本轮没有人参与
      </div>
      <ul v-else class="winner-list">
        <li
          v-for="(w, i) in winners"
          :key="w.uid"
          class="winner"
          :style="{ animationDelay: i * 0.15 + 's' }"
        >
          <span class="medal">{{ MEDALS[i] ?? '🎁' }}</span>
          <span class="uname">{{ w.uname }}</span>
        </li>
      </ul>

      <div class="footer">参与 {{ participantCount }} 人</div>
    </div>
  </div>
</template>

<style scoped>
.result-card-wrap {
  pointer-events: none;
  animation: resultIn 0.6s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    resultOut 0.5s ease-in 9.4s both;
}
.result-card {
  width: 520px;
  max-width: 88vw;
  border-radius: 1.2rem;
  background: linear-gradient(135deg, rgba(6, 95, 70, 0.92), rgba(15, 23, 42, 0.92));
  padding: 1.6rem 2rem;
  color: #d1fae5;
  border: 1px solid rgba(52, 211, 153, 0.6);
  box-shadow:
    0 20px 60px -10px rgba(0, 0, 0, 0.7),
    0 0 40px 6px rgba(52, 211, 153, 0.4);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.9rem;
  border-bottom: 1px dashed rgba(52, 211, 153, 0.3);
  padding-bottom: 0.6rem;
}
.title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #34d399;
}
.prize {
  font-size: 0.95rem;
  color: #d1fae5;
}
.empty {
  text-align: center;
  padding: 1.5rem;
  font-size: 0.95rem;
  color: #94a3b8;
}
.winner-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.winner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: rgba(0, 0, 0, 0.25);
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  animation: winnerReveal 0.5s ease-out both;
}
.medal { font-size: 1.5rem; }
.uname {
  font-size: 1.15rem;
  font-weight: 600;
  color: #fef3c7;
}
.footer {
  margin-top: 0.9rem;
  text-align: right;
  font-size: 0.78rem;
  color: #94a3b8;
}

@keyframes resultIn {
  from { transform: translateY(-30px) scale(0.85); opacity: 0; filter: blur(6px); }
  to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
}
@keyframes resultOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.05); opacity: 0; }
}
@keyframes winnerReveal {
  from { transform: translateX(-12px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
</style>
