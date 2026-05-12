<script setup lang="ts">
import { computed } from 'vue'
import { status, overlayPort, enabledRuleCount } from '../store'

const stateText = computed(() => {
  const s = status.value
  switch (s.state) {
    case 'idle':
      return '未连接'
    case 'validating':
      return `校验中：${s.roomInput}`
    case 'connecting':
      return `连接中：${s.roomId}`
    case 'connected':
      return `已连接：${s.roomId}`
    case 'reconnecting':
      return `断线重连：${s.roomId}`
    case 'error':
      return `错误：${s.message}`
  }
  return '未知'
})

const stateColor = computed(() => {
  switch (status.value.state) {
    case 'connected':
      return 'text-emerald-400'
    case 'error':
      return 'text-rose-400'
    case 'idle':
      return 'text-slate-400'
    default:
      return 'text-amber-300'
  }
})
</script>

<template>
  <footer class="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-4 py-2 text-xs">
    <div class="flex items-center gap-2">
      <span class="inline-block h-2 w-2 rounded-full" :class="{
        'bg-emerald-500': status.state === 'connected',
        'bg-rose-500': status.state === 'error',
        'bg-slate-600': status.state === 'idle',
        'bg-amber-400 animate-pulse': ['validating', 'connecting', 'reconnecting'].includes(status.state)
      }"></span>
      <span :class="stateColor">{{ stateText }}</span>
    </div>
    <div class="flex items-center gap-6 text-slate-500">
      <span>Overlay 端口：<span class="text-slate-300">{{ overlayPort || '—' }}</span></span>
      <span>启用规则：<span class="text-slate-300">{{ enabledRuleCount }}</span></span>
    </div>
  </footer>
</template>
