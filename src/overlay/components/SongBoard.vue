<script setup lang="ts">
// OBS 上常驻的点歌板。和其他卡片不同，它不是"弹一下就消失"，
// 而是只要队列非空就一直挂在角上，所以配色一律走 --ov-* 主题变量，
// 不写死颜色——否则主播换观众端主题时它会突兀地留在旧配色上。
interface Song {
  id: string
  title: string
  uname: string
  cost: number
  source: 'danmu' | 'host'
}

defineProps<{
  open: boolean
  keyword: string
  cost: number
  currencyName: string
  current: Song | null
  queue: Song[]
  queueTotal: number
}>()
</script>

<template>
  <div class="song-board">
    <header class="sb-head">
      <span class="sb-note">♪</span>
      <span class="sb-title">点歌台</span>
      <span v-if="!open" class="sb-closed">已暂停</span>
    </header>

    <div v-if="current" class="sb-current">
      <div class="sb-current-label">正在唱</div>
      <div class="sb-current-title">{{ current.title }}</div>
      <div class="sb-current-by">{{ current.uname }} 点的</div>
    </div>

    <ol v-if="queue.length" class="sb-list">
      <li v-for="(s, i) in queue" :key="s.id" class="sb-item">
        <span class="sb-idx">{{ i + 1 }}</span>
        <span class="sb-song">{{ s.title }}</span>
        <span class="sb-by">{{ s.uname }}</span>
      </li>
    </ol>

    <div v-if="queueTotal > queue.length" class="sb-more">
      还有 {{ queueTotal - queue.length }} 首
    </div>

    <div v-if="!current && !queue.length" class="sb-empty">
      发「{{ keyword }} 歌名」点歌<span v-if="cost > 0">（{{ cost }} {{ currencyName }}）</span>
    </div>
  </div>
</template>

<style scoped>
.song-board {
  pointer-events: none;
  width: 250px;
  border-radius: var(--ov-radius, 18px);
  background: var(--ov-card-bg, rgba(15, 23, 42, 0.78));
  border: 1px solid var(--ov-card-border, rgba(148, 163, 184, 0.28));
  box-shadow: 0 18px 50px -16px rgba(0, 0, 0, 0.55), 0 0 20px -6px var(--ov-glow, transparent);
  backdrop-filter: blur(var(--ov-blur, 8px));
  color: var(--ov-text, #f8fafc);
  font-family: var(--ov-font, system-ui, sans-serif);
  padding: 0.75rem 0.9rem;
  animation: sbIn 0.45s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}

.sb-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--ov-card-border, rgba(148, 163, 184, 0.28));
}
.sb-note {
  color: var(--ov-accent, #38bdf8);
  font-size: 1rem;
  line-height: 1;
}
.sb-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.sb-closed {
  margin-left: auto;
  font-size: 0.65rem;
  color: var(--ov-muted, #cbd5e1);
  border: 1px solid var(--ov-card-border, rgba(148, 163, 184, 0.28));
  border-radius: 999px;
  padding: 1px 6px;
}

.sb-current {
  margin-top: 0.6rem;
  padding: 0.5rem 0.6rem;
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--ov-accent, #38bdf8) 14%, transparent);
}
.sb-current-label {
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  color: var(--ov-muted, #cbd5e1);
}
.sb-current-title {
  font-size: 1rem;
  font-weight: 700;
  margin-top: 2px;
  /* 歌名可能很长，单行截断，别把板子撑变形 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-current-by {
  font-size: 0.66rem;
  color: var(--ov-muted, #cbd5e1);
  margin-top: 1px;
}

.sb-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}
.sb-item {
  display: grid;
  grid-template-columns: 1rem 1fr auto;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.76rem;
}
.sb-idx {
  color: var(--ov-accent, #38bdf8);
  font-variant-numeric: tabular-nums;
  font-size: 0.66rem;
}
.sb-song {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-by {
  color: var(--ov-muted, #cbd5e1);
  font-size: 0.62rem;
  max-width: 5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-more,
.sb-empty {
  margin-top: 0.45rem;
  font-size: 0.66rem;
  color: var(--ov-muted, #cbd5e1);
}

@keyframes sbIn {
  from { transform: translateY(-8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
</style>
