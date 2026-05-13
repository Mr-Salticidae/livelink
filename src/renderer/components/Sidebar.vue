<script setup lang="ts">
import { currentPage, type PageKey } from '../store'

const items: { key: PageKey; label: string; icon: string }[] = [
  { key: 'home', label: '首页', icon: '🏠' },
  { key: 'rules', label: '规则', icon: '📜' },
  { key: 'tts', label: 'TTS', icon: '🔊' },
  { key: 'lottery', label: '抽奖', icon: '🎰' },
  { key: 'voting', label: '投票', icon: '📊' },
  { key: 'logs', label: '日志', icon: '📝' }
]

const APP_VERSION = '0.1.0'

function goto(key: PageKey): void {
  currentPage.value = key
}
</script>

<template>
  <aside class="flex h-full w-48 flex-col border-r border-slate-800 bg-slate-950/60">
    <div class="px-5 py-5">
      <div class="text-lg font-semibold tracking-wide text-slate-100">LiveLink</div>
      <div class="text-xs text-slate-500">B 站直播助手 · v{{ APP_VERSION }}</div>
    </div>
    <nav class="flex-1 px-2">
      <button
        v-for="item in items"
        :key="item.key"
        @click="goto(item.key)"
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition"
        :class="
          currentPage === item.key
            ? 'bg-slate-800 text-slate-100 shadow-inner'
            : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
        "
      >
        <span class="text-base">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <div class="px-4 py-3 text-[11px] leading-relaxed text-slate-600">
      MVP · 仅本地运行<br />无任何上传行为
    </div>
  </aside>
</template>
