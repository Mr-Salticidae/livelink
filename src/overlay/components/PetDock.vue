<script setup lang="ts">
import type { PetDisplayItem } from '../../shared/pets'

defineProps<{
  items: PetDisplayItem[]
}>()
</script>

<template>
  <div class="pet-dock">
    <div
      v-for="(item, index) in items"
      :key="item.ownerUid + item.pet.id"
      class="pet-slot"
      :style="{ '--accent': item.species.accent, '--delay': `${index * 0.13}s` }"
    >
      <div class="pet-level">Lv.{{ item.pet.level }}</div>
      <img class="pet-img" :src="item.species.assets[item.pet.stage]" :alt="item.pet.nickname" />
      <div class="pet-name">{{ item.pet.nickname }}</div>
      <div class="pet-owner">{{ item.ownerName }}</div>
    </div>
  </div>
</template>

<style scoped>
.pet-dock {
  pointer-events: none;
  display: flex;
  max-width: min(1180px, calc(100vw - 36px));
  align-items: end;
  justify-content: center;
  gap: 10px;
  border-radius: 18px 18px 0 0;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-bottom: 0;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.72));
  padding: 8px 14px 7px;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(6px);
}
.pet-slot {
  position: relative;
  width: clamp(72px, 8.4vw, 104px);
  min-width: 0;
  text-align: center;
  animation: petIdle 2.8s ease-in-out var(--delay) infinite;
}
.pet-img {
  display: block;
  width: 100%;
  height: clamp(62px, 7vw, 92px);
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 8px 8px rgba(0, 0, 0, 0.36));
}
.pet-level {
  position: absolute;
  right: 5px;
  top: 1px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent), rgba(15, 23, 42, 0.82) 46%);
  padding: 1px 6px;
  color: white;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
.pet-name,
.pet-owner {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}
.pet-name {
  color: #f8fafc;
  font-size: 12px;
  font-weight: 800;
}
.pet-owner {
  color: #cbd5e1;
  font-size: 10px;
}
@keyframes petIdle {
  0%, 100% { transform: translateY(0) scale(1); }
  45% { transform: translateY(-5px) scale(1.02); }
}
</style>
