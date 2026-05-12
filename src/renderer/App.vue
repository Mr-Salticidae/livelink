<script setup lang="ts">
import { ref } from 'vue'
const versionTag = ref('v0.1.0 · MVP 骨架')
</script>

<template>
  <main class="flex h-full items-center justify-center">
    <div class="text-center">
      <h1 class="text-3xl font-semibold tracking-wide">LiveLink</h1>
      <p class="mt-3 text-slate-400">B 站直播弹幕+礼物插件</p>
      <p class="mt-8 text-xs text-slate-500">{{ versionTag }}</p>
    </div>
  </main>
</template>
