<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <!-- 底色跟随观众端主题（--ov-accent）。此前这里硬编码成一个固定蓝，
       无论主播选「樱花甜心」还是「霓虹夜场」，进房横幅都突兀地是蓝的 -->
  <div class="enter-banner inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white shadow">
    <span class="text-base">👋</span>
    <span>{{ text }}</span>
  </div>
</template>

<style scoped>
.enter-banner {
  pointer-events: none;
  background: color-mix(in srgb, var(--ov-accent, #9b85ff) 90%, transparent);
  box-shadow: 0 6px 20px -8px var(--ov-glow, rgba(155, 133, 255, 0.5));
  animation: enterIn 0.4s ease-out both,
    enterOut 0.6s ease-in 3.6s both;
}
@keyframes enterIn {
  from { transform: translateY(-12px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
@keyframes enterOut {
  from { transform: translateY(0); opacity: 1; }
  to   { transform: translateY(-12px); opacity: 0; }
}
</style>
