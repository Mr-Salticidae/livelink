<script setup lang="ts">
// 游戏启动招牌：屏幕中央大字飞入 → 短暂停留 → 滑出。
// 通用组件，三个游戏（lottery/voting/horserace）共用一套动画 + 进场节奏，
// 通过 theme prop 切换主题色，保持品牌感一致

defineProps<{
  icon: string // 🎰 / 📊 / 🏇
  title: string // "抽奖开始啦"
  subtitle?: string // 可选副标题（"发关键词 抽奖 参与"）
  theme: 'gold' | 'sky' | 'amber' // 对齐三个游戏的主题
}>()
</script>

<template>
  <div class="intro-wrap" :class="`theme-${theme}`">
    <div class="intro-card">
      <span class="intro-icon">{{ icon }}</span>
      <div class="intro-text">
        <div class="intro-title">{{ title }}</div>
        <div v-if="subtitle" class="intro-subtitle">{{ subtitle }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.intro-wrap {
  pointer-events: none;
  /* 总时长 2.4s：fly-in 0.55s → hold 1.2s → fly-out 0.65s */
  animation: introFlyIn 0.55s cubic-bezier(0.2, 0.7, 0.2, 1.3) both,
    introFlyOut 0.65s cubic-bezier(0.6, 0, 0.85, 0.4) 1.75s both;
}
.intro-card {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.8rem 3rem;
  border-radius: 1.5rem;
  color: white;
  font-weight: 700;
  box-shadow: 0 24px 80px -10px rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  /* 持续光晕脉冲 */
  animation: introPulse 1.2s ease-in-out 0.55s both;
}

/* theme: gold (lottery) */
.theme-gold .intro-card {
  background: linear-gradient(135deg, #f59e0b 0%, #ea580c 50%, #f59e0b 100%);
  border: 3px solid rgba(252, 211, 77, 0.7);
  box-shadow: 0 0 80px rgba(252, 211, 77, 0.6), 0 24px 80px -10px rgba(0, 0, 0, 0.75);
}
/* theme: sky (voting) */
.theme-sky .intro-card {
  background: linear-gradient(135deg, #0284c7 0%, #6366f1 50%, #0284c7 100%);
  border: 3px solid rgba(125, 211, 252, 0.7);
  box-shadow: 0 0 80px rgba(56, 189, 248, 0.55), 0 24px 80px -10px rgba(0, 0, 0, 0.75);
}
/* theme: amber (horserace) */
.theme-amber .intro-card {
  background: linear-gradient(135deg, #dc2626 0%, #f59e0b 50%, #dc2626 100%);
  border: 3px solid rgba(252, 211, 77, 0.7);
  box-shadow: 0 0 90px rgba(251, 113, 133, 0.55), 0 24px 80px -10px rgba(0, 0, 0, 0.75);
}

.intro-icon {
  font-size: 4.5rem;
  line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6));
  animation: introIconBounce 0.6s ease-out 0.3s both;
}
.intro-title {
  font-size: 2.6rem;
  line-height: 1.1;
  letter-spacing: 0.05em;
  text-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
}
.intro-subtitle {
  font-size: 1rem;
  font-weight: 500;
  margin-top: 0.4rem;
  opacity: 0.92;
  letter-spacing: 0.03em;
}

@keyframes introFlyIn {
  0%   { transform: translateX(-120vw) skewX(-12deg) scale(0.85); opacity: 0; }
  70%  { transform: translateX(20px) skewX(2deg) scale(1.05); opacity: 1; }
  100% { transform: translateX(0) skewX(0) scale(1); opacity: 1; }
}
@keyframes introFlyOut {
  0%   { transform: translateX(0) scale(1); opacity: 1; }
  100% { transform: translateX(120vw) skewX(12deg) scale(0.85); opacity: 0; }
}
@keyframes introPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
@keyframes introIconBounce {
  0%   { transform: scale(0.5) rotate(-20deg); }
  60%  { transform: scale(1.25) rotate(8deg); }
  100% { transform: scale(1) rotate(0); }
}
</style>
