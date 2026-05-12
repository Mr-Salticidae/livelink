<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <div class="enter-banner inline-flex items-center gap-2 rounded-full bg-sky-500/90 px-4 py-1.5 text-sm font-medium text-white shadow">
    <span class="text-base">👋</span>
    <span>{{ text }}</span>
  </div>
</template>

<style scoped>
.enter-banner {
  pointer-events: none;
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
