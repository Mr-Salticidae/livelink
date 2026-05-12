<script setup lang="ts">
defineProps<{
  uname: string
  giftName: string
  num: number
}>()
</script>

<template>
  <div class="gift-effect flex items-center gap-3 rounded-2xl bg-black/50 px-5 py-3 text-white shadow-2xl backdrop-blur">
    <span class="gift-icon text-3xl">🎁</span>
    <div class="flex flex-col leading-tight">
      <span class="text-sm text-amber-300">{{ uname }}</span>
      <span class="text-base font-medium">送出 {{ giftName }} <span class="text-amber-300">x{{ num }}</span></span>
    </div>
  </div>
</template>

<style scoped>
.gift-effect {
  pointer-events: none;
  animation: giftIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    giftOut 0.6s ease-in 3.4s both;
  transform-origin: right center;
}
.gift-icon {
  animation: bounce 0.8s ease-out 0.3s 2;
}
@keyframes giftIn {
  from { transform: translateX(120%) scale(0.85); opacity: 0; }
  to   { transform: translateX(0) scale(1); opacity: 1; }
}
@keyframes giftOut {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(120%); opacity: 0; }
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}
</style>
