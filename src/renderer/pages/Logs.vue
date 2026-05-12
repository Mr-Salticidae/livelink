<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { logs } from '../store'
import type { EventKind, LogEntry } from '../types'

type Filter = 'all' | EventKind | 'system'

const filter = ref<Filter>('all')
const listEl = ref<HTMLDivElement | null>(null)
const autoScroll = ref(true)

const FILTER_TABS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'danmu.received', label: '弹幕' },
  { value: 'gift.received', label: '礼物' },
  { value: 'viewer.enter', label: '进房' },
  { value: 'guard.bought', label: '上舰' },
  { value: 'super.chat', label: 'SC' }
]

const filteredLogs = computed(() => {
  if (filter.value === 'all') return logs.value
  return logs.value.filter((l) => l.eventKind === filter.value)
})

watch(
  filteredLogs,
  () => {
    if (!autoScroll.value) return
    void nextTick(() => {
      const el = listEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
  { flush: 'post' }
)

function onScroll(): void {
  const el = listEl.value
  if (!el) return
  // 距底 < 40px 视为"在底部"，恢复 autoScroll
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function clear(): Promise<void> {
  await window.api.logClear()
  logs.value = []
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function badgeColor(kind: LogEntry['eventKind']): string {
  switch (kind) {
    case 'danmu.received': return 'bg-sky-500/20 text-sky-300'
    case 'gift.received': return 'bg-amber-500/20 text-amber-300'
    case 'viewer.enter': return 'bg-emerald-500/20 text-emerald-300'
    case 'guard.bought': return 'bg-purple-500/20 text-purple-300'
    case 'super.chat': return 'bg-rose-500/20 text-rose-300'
    default: return 'bg-slate-700/40 text-slate-300'
  }
}

function badgeLabel(kind: LogEntry['eventKind']): string {
  switch (kind) {
    case 'danmu.received': return '弹幕'
    case 'gift.received': return '礼物'
    case 'viewer.enter': return '进房'
    case 'guard.bought': return '上舰'
    case 'super.chat': return 'SC'
    case 'follow.received': return '关注'
    default: return kind
  }
}
</script>

<template>
  <div class="mx-auto flex h-full max-w-4xl flex-col space-y-4">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">日志</h1>
        <p class="mt-1 text-sm text-slate-400">最近 500 条事件，按规则命中 / 平台事件分类。</p>
      </div>
      <button
        @click="clear"
        class="rounded bg-slate-700 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-600"
      >清空</button>
    </header>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="t in FILTER_TABS"
        :key="t.value"
        @click="filter = t.value"
        class="rounded-full px-3 py-1 text-xs transition"
        :class="filter === t.value ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'"
      >{{ t.label }}</button>
    </div>

    <div
      ref="listEl"
      @scroll="onScroll"
      class="flex-1 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm"
    >
      <div v-if="filteredLogs.length === 0" class="py-10 text-center text-sm text-slate-600">
        还没有事件。开播一下，或者先点首页的"开始"。
      </div>
      <div
        v-for="(entry, i) in filteredLogs"
        :key="i"
        class="flex items-start gap-3 border-b border-slate-800/50 py-1.5 last:border-0"
      >
        <span class="shrink-0 font-mono text-xs text-slate-500">{{ fmtTime(entry.timestamp) }}</span>
        <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px]" :class="badgeColor(entry.eventKind)">
          {{ badgeLabel(entry.eventKind) }}
        </span>
        <span class="flex-1 break-all text-slate-200">{{ entry.text }}</span>
      </div>
    </div>
  </div>
</template>
