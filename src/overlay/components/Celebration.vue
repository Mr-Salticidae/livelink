<script setup lang="ts">
// 结果揭晓的飘彩纸庆祝层。全屏覆盖，纯 CSS 30 个 span 从屏幕顶部
// 落到底部 + 旋转 + fade-out，2.5 秒后自动消失（由父组件 unmount）
//
// 不阻挡 result 卡片：z-index 比 result 卡低，作为庆祝氛围背景

const COUNT = 36
// 6 色彩带循环
const COLORS = [
  '#fcd34d', // 金
  '#f87171', // 红
  '#60a5fa', // 蓝
  '#34d399', // 绿
  '#a78bfa', // 紫
  '#f9a8d4'  // 粉
]
const confetti = Array.from({ length: COUNT }, (_, i) => ({
  idx: i,
  color: COLORS[i % COLORS.length],
  // 横向起点 0-100%（CSS var --x 用）
  x: Math.random() * 100,
  // 进场延迟 0-0.5s，让粒子非完全同步
  delay: Math.random() * 0.5,
  // 旋转量 360-1080 deg
  rot: 360 + Math.random() * 720,
  // 飘落 duration 2.0-2.6s
  dur: 2 + Math.random() * 0.6,
  // 形状：方形 / 长条
  isLong: i % 3 === 0,
  // 横向漂移幅度 -50 ~ +50 px（实际通过 keyframes 的 sway）
  sway: (Math.random() - 0.5) * 100
}))
</script>

<template>
  <div class="confetti-wrap">
    <span
      v-for="c in confetti"
      :key="c.idx"
      class="confetti"
      :class="{ long: c.isLong }"
      :style="{
        '--x': c.x + 'vw',
        '--color': c.color,
        '--delay': c.delay + 's',
        '--rot': c.rot + 'deg',
        '--dur': c.dur + 's',
        '--sway': c.sway + 'px'
      }"
    ></span>
  </div>
</template>

<style scoped>
.confetti-wrap {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 5;
}
.confetti {
  position: absolute;
  top: -20px;
  left: var(--x);
  width: 10px;
  height: 14px;
  background: var(--color);
  border-radius: 1px;
  opacity: 0;
  animation: confettiFall var(--dur) cubic-bezier(0.45, 0.05, 0.55, 0.95) var(--delay) both;
  box-shadow: 0 0 6px var(--color);
}
.confetti.long {
  width: 6px;
  height: 22px;
}
@keyframes confettiFall {
  0%   { transform: translate(0, 0) rotate(0); opacity: 0; }
  8%   { opacity: 1; }
  50%  { transform: translate(calc(var(--sway) * 0.6), 55vh) rotate(calc(var(--rot) * 0.5)); }
  90%  { opacity: 1; }
  100% { transform: translate(var(--sway), 110vh) rotate(var(--rot)); opacity: 0; }
}
</style>
