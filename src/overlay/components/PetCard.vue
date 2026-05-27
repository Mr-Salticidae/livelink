<script setup lang="ts">
import { computed } from 'vue'
import { PET_LEVEL_EXP, type PetDisplayItem } from '../../shared/pets'

const props = defineProps<{
  title: string
  item: PetDisplayItem
  mode?: 'normal' | 'level' | 'evolve'
}>()

const pct = computed(() => Math.round((props.item.pet.exp / PET_LEVEL_EXP) * 100))
</script>

<template>
  <div class="pet-card" :class="mode" :style="{ '--accent': item.species.accent }">
    <div class="pet-glow"></div>
    <img class="pet-art" :src="item.species.assets[item.pet.stage]" :alt="item.pet.nickname" />
    <div class="pet-info">
      <div class="pet-title">{{ title }}</div>
      <div class="pet-name">{{ item.pet.nickname }}</div>
      <div class="pet-meta">
        {{ item.ownerName }} · {{ item.species.name }} · {{ item.species.stageNames[item.pet.stage] }}
      </div>
      <div class="pet-progress">
        <div class="pet-progress-fill" :style="{ width: pct + '%' }"></div>
      </div>
      <div class="pet-level">Lv.{{ item.pet.level }} · {{ item.pet.exp }}/{{ PET_LEVEL_EXP }}</div>
    </div>
  </div>
</template>

<style scoped>
.pet-card {
  pointer-events: none;
  position: relative;
  display: grid;
  width: 440px;
  grid-template-columns: 134px 1fr;
  gap: 16px;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--accent), white 18%);
  background:
    radial-gradient(circle at 18% 20%, color-mix(in srgb, var(--accent), transparent 62%), transparent 36%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.9));
  padding: 18px;
  color: #f8fafc;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.56), 0 0 30px color-mix(in srgb, var(--accent), transparent 62%);
  animation: cardIn 0.42s cubic-bezier(0.2, 0.75, 0.2, 1.15) both;
}
.pet-card.level,
.pet-card.evolve {
  animation: cardIn 0.42s cubic-bezier(0.2, 0.75, 0.2, 1.15) both, pulse 0.8s ease-in-out 0.35s 2;
}
.pet-glow {
  position: absolute;
  inset: auto -20% -50% -20%;
  height: 100px;
  background: color-mix(in srgb, var(--accent), transparent 70%);
  filter: blur(24px);
}
.pet-art {
  position: relative;
  z-index: 1;
  height: 126px;
  width: 126px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 10px 10px rgba(0, 0, 0, 0.42));
}
.pet-info {
  position: relative;
  z-index: 1;
  min-width: 0;
  align-self: center;
}
.pet-title {
  color: color-mix(in srgb, var(--accent), white 30%);
  font-size: 13px;
  font-weight: 800;
}
.pet-name {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 26px;
  font-weight: 900;
  line-height: 1.1;
}
.pet-meta {
  margin-top: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #cbd5e1;
  font-size: 12px;
}
.pet-progress {
  margin-top: 12px;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.8);
}
.pet-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), #f8fafc);
}
.pet-level {
  margin-top: 5px;
  color: #94a3b8;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
@keyframes cardIn {
  from { transform: translateY(22px) scale(0.94); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes pulse {
  50% { transform: scale(1.035); box-shadow: 0 20px 70px color-mix(in srgb, var(--accent), transparent 34%); }
}
</style>
