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
      return `已连接 · 房间 ${s.roomId}`
    case 'reconnecting':
      return s.message ?? `断线重连：${s.roomId}`
    case 'error':
      return `错误：${s.message}`
  }
  return '未知'
})

const stateColor = computed(() => {
  switch (status.value.state) {
    case 'connected':
      return 'text-emerald-300'
    case 'error':
      return 'text-rose-300'
    case 'idle':
      return 'text-slate-500'
    default:
      return 'text-amber-200'
  }
})

const dotClass = computed(() => {
  switch (status.value.state) {
    case 'connected':
      return 'bg-emerald-400'
    case 'error':
      return 'bg-rose-400'
    case 'idle':
      return 'bg-slate-600'
    default:
      return 'bg-amber-300 animate-pulse'
  }
})
</script>

<template>
  <footer
    class="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-5 py-2 text-xs backdrop-blur"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="h-1.5 w-1.5 flex-none rounded-full transition" :class="dotClass" />
      <span class="truncate" :class="stateColor">{{ stateText }}</span>
    </div>
    <div class="flex flex-none items-center gap-5">
      <span class="flex items-center gap-1.5">
        <span class="ll-eyebrow">Overlay</span>
        <span class="font-mono text-[11px] text-slate-300">{{ overlayPort || '—' }}</span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="ll-eyebrow">Rules</span>
        <span class="font-mono text-[11px] text-slate-300">{{ enabledRuleCount }}</span>
      </span>
    </div>
  </footer>
</template>
