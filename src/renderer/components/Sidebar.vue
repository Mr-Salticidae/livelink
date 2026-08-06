<script setup lang="ts">
import { currentPage, type PageKey } from '../store'

// 分组导航：功能一多（10 项）平铺就成了一堵墙，按用途切三段，
// 配 pb-arena 那种全大写等宽小标题当分隔
const groups: { label: string; items: { key: PageKey; label: string; icon: string }[] }[] = [
  {
    label: 'Live',
    items: [
      { key: 'home', label: '首页', icon: '◈' },
      { key: 'rules', label: '规则', icon: '☰' },
      { key: 'tts', label: '语音', icon: '◊' },
      { key: 'reader', label: '弹幕朗读', icon: '❞' },
      { key: 'song', label: '点歌台', icon: '♪' }
    ]
  },
  {
    label: 'Play',
    items: [
      { key: 'lottery', label: '抽奖', icon: '✦' },
      { key: 'voting', label: '投票', icon: '⊞' },
      { key: 'horserace', label: '赛马', icon: '⋙' },
      { key: 'guessing', label: '竞猜', icon: '◇' },
      { key: 'pets', label: '宠物', icon: '❋' }
    ]
  },
  {
    label: 'More',
    items: [
      { key: 'ai', label: 'AI 回复', icon: '✳' },
      { key: 'logs', label: '日志', icon: '≡' }
    ]
  }
]

const APP_VERSION = __APP_VERSION__

function goto(key: PageKey): void {
  currentPage.value = key
}
</script>

<template>
  <aside class="relative flex h-full w-52 flex-col border-r border-slate-800 bg-slate-950/70">
    <!-- 蛛网标记：同心捕丝 + 辐射蛛丝，取自「蛛网之上」的圆网母题。
         纯静态 SVG，极淡，只作为品牌底纹，不抢内容 -->
    <svg
      class="pointer-events-none absolute -left-16 -top-16 h-56 w-56 opacity-[.16]"
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="url(#silk)" stroke-width="1">
        <circle cx="100" cy="100" r="28" />
        <circle cx="100" cy="100" r="52" />
        <circle cx="100" cy="100" r="78" />
        <circle cx="100" cy="100" r="106" />
        <path d="M100 100 L100 -10 M100 100 L196 45 M100 100 L196 155 M100 100 L100 210
                 M100 100 L4 155 M100 100 L4 45" />
      </g>
      <defs>
        <linearGradient id="silk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#9b85ff" />
          <stop offset="100%" stop-color="#d98bff" stop-opacity=".2" />
        </linearGradient>
      </defs>
    </svg>

    <!-- 品牌区：圆形字母标 + 衬线字标（pb-arena 的 brand-mark 语汇） -->
    <div class="relative flex items-center gap-3 px-5 pb-5 pt-6">
      <span
        class="grid h-9 w-9 flex-none place-items-center rounded-full border border-sky-500/50
               font-mono text-[13px] text-sky-400"
        style="box-shadow: inset 0 0 18px -6px rgba(155, 133, 255, 0.7)"
        >LL</span
      >
      <span class="min-w-0">
        <span class="block font-serif text-[17px] font-bold leading-none tracking-wide text-slate-100"
          >LiveLink</span
        >
        <span class="ll-eyebrow mt-1 block">v{{ APP_VERSION }}</span>
      </span>
    </div>

    <nav class="relative flex-1 overflow-y-auto px-2 pb-2">
      <div v-for="g in groups" :key="g.label" class="mb-1">
        <div class="ll-eyebrow px-3 pb-1.5 pt-3">{{ g.label }}</div>
        <button
          v-for="item in g.items"
          :key="item.key"
          @click="goto(item.key)"
          class="group relative flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13px] transition"
          :class="
            currentPage === item.key
              ? 'bg-sky-500/10 text-slate-100'
              : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
          "
        >
          <!-- 选中项左侧一道蛛丝渐变，替代原来的整块高亮 -->
          <span
            v-if="currentPage === item.key"
            class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r"
            style="background: linear-gradient(#9b85ff, #d98bff)"
          />
          <span
            class="w-4 text-center text-[13px] transition"
            :class="currentPage === item.key ? 'text-sky-400' : 'text-slate-600 group-hover:text-slate-400'"
            >{{ item.icon }}</span
          >
          <span>{{ item.label }}</span>
        </button>
      </div>
    </nav>

    <!-- 连接状态由底部全局状态栏统一呈现，这里不再重复一份（两条"未连接"上下挨着很蠢） -->
    <div class="relative border-t border-slate-800 px-4 py-3">
      <p class="text-[10px] leading-relaxed text-slate-600">仅本地运行 · 无上传</p>
    </div>
  </aside>
</template>
