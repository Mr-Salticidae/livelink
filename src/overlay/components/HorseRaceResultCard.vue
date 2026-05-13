<script setup lang="ts">
interface Horse { key: string; name: string; emoji: string }
interface Ranking { horseKey: string; position: number; rank: number }

const props = defineProps<{
  horses: Horse[]
  rankings: Ranking[]
  enrollments: Record<string, number>
  winnerBettors: string[]
  winnerHorseKey: string | null
}>()

const MEDALS = ['🥇', '🥈', '🥉']

function findHorse(key: string): Horse | undefined {
  return props.horses.find((h) => h.key === key)
}
</script>

<template>
  <div class="hrr-wrap">
    <div class="hrr-card">
      <header class="hrr-header">
        <span class="hrr-title">🏆 赛马结果</span>
      </header>

      <div class="hrr-rankings">
        <div
          v-for="(r, i) in rankings"
          :key="r.horseKey"
          class="hrr-row"
          :class="{ 'hrr-win': r.rank === 1 }"
          :style="{ animationDelay: i * 0.18 + 's' }"
        >
          <span class="hrr-medal">{{ MEDALS[i] ?? `#${r.rank}` }}</span>
          <span class="hrr-emoji">{{ findHorse(r.horseKey)?.emoji ?? '🐎' }}</span>
          <span class="hrr-name">{{ findHorse(r.horseKey)?.name ?? r.horseKey }}</span>
          <span class="hrr-pos">{{ Math.round(r.position) }}m</span>
        </div>
      </div>

      <div v-if="winnerBettors.length > 0" class="hrr-bettors">
        <div class="hrr-bettors-title">押中冠军：</div>
        <div class="hrr-bettors-list">
          <span v-for="(b, i) in winnerBettors" :key="i" class="hrr-bettor">{{ b }}</span>
        </div>
      </div>
      <div v-else class="hrr-bettors-empty">没有人押中冠军</div>
    </div>
  </div>
</template>

<style scoped>
.hrr-wrap {
  pointer-events: none;
  animation: hrrIn 0.6s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    hrrOut 0.6s ease-in 9.4s both;
}
.hrr-card {
  width: 560px;
  max-width: 88vw;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(120, 53, 15, 0.95), rgba(15, 23, 42, 0.95));
  padding: 1.4rem 1.6rem;
  color: #fef3c7;
  border: 1px solid rgba(252, 211, 77, 0.55);
  box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.7), 0 0 50px rgba(252, 211, 77, 0.4);
}
.hrr-header {
  border-bottom: 1px dashed rgba(252, 211, 77, 0.3);
  padding-bottom: 0.5rem;
  margin-bottom: 0.8rem;
}
.hrr-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #fcd34d;
}

.hrr-rankings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 0.9rem;
}
.hrr-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.3);
  padding: 7px 14px;
  border-radius: 10px;
  animation: rowReveal 0.5s ease-out both;
}
.hrr-medal {
  font-size: 1.4rem;
  font-weight: 700;
  min-width: 32px;
  text-align: center;
  color: #fde68a;
}
.hrr-emoji { font-size: 1.5rem; }
.hrr-name { flex: 1; font-size: 1.05rem; color: #fef3c7; }
.hrr-pos { color: #94a3b8; font-size: 0.85rem; font-variant-numeric: tabular-nums; }

.hrr-win {
  background: linear-gradient(135deg, rgba(252, 211, 77, 0.3), rgba(245, 158, 11, 0.2));
  border: 1px solid rgba(252, 211, 77, 0.4);
  transform: scale(1.02);
}
.hrr-win .hrr-name { color: #fff; font-weight: 600; }

.hrr-bettors {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  padding: 8px 12px;
}
.hrr-bettors-title { font-size: 0.78rem; color: #94a3b8; margin-bottom: 5px; }
.hrr-bettors-list { display: flex; flex-wrap: wrap; gap: 5px; }
.hrr-bettor {
  background: rgba(252, 211, 77, 0.2);
  color: #fde68a;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.78rem;
}
.hrr-bettors-empty {
  text-align: center;
  font-size: 0.85rem;
  color: #94a3b8;
  padding: 6px;
}

@keyframes hrrIn {
  from { transform: translateY(-30px) scale(0.85); opacity: 0; filter: blur(6px); }
  to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
}
@keyframes hrrOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.04); opacity: 0; }
}
@keyframes rowReveal {
  from { transform: translateX(-16px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
</style>
