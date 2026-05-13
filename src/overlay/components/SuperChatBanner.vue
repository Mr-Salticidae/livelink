<script setup lang="ts">
// B 站 SuperChat（醒目留言）横幅。按价位分 4 档视觉：
//   basic  < 100   蓝紫渐变 + 简洁卡片，顶部居中
//   premium 100-499 紫色 + 金色边 + 光晕脉冲
//   epic   500-999  金色 + 强光晕 + 持续脉冲
//   legendary ≥ 1000 红金渐变 + 屏幕中央 + 粒子放射
//
// 默认显示时长按档位递增：高价位的留更久让观众也能看到

import { computed } from 'vue'

const props = defineProps<{
  uname: string
  message: string
  price: number // RMB
  avatar?: string
  durationSec?: number // B 站协议持续时间，仅作信息展示（实际 overlay 显示长度由档位决定）
}>()

type Tier = 'basic' | 'premium' | 'epic' | 'legendary'
const tier = computed<Tier>(() => {
  if (props.price >= 1000) return 'legendary'
  if (props.price >= 500) return 'epic'
  if (props.price >= 100) return 'premium'
  return 'basic'
})
</script>

<template>
  <div class="sc-wrap" :class="`sc-${tier}`">
    <div class="sc-card">
      <header class="sc-header">
        <img v-if="avatar" :src="avatar" class="sc-avatar" alt="" referrerpolicy="no-referrer" />
        <div class="sc-uname-block">
          <div class="sc-uname">{{ uname }}</div>
          <div class="sc-tag">醒目留言 SuperChat</div>
        </div>
        <div class="sc-price">¥{{ price }}</div>
      </header>
      <div class="sc-message">{{ message }}</div>
    </div>
    <!-- legendary 档专属粒子 -->
    <div v-if="tier === 'legendary'" class="sc-particles" aria-hidden="true">
      <span v-for="i in 10" :key="i" :style="{ '--i': i }"></span>
    </div>
  </div>
</template>

<style scoped>
.sc-wrap {
  pointer-events: none;
  position: relative;
  animation: scIn 0.55s cubic-bezier(0.2, 0.7, 0.2, 1.2) both;
}

.sc-card {
  width: 480px;
  border-radius: 12px;
  padding: 0;
  overflow: hidden;
  color: #fff;
  box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.6);
}

/* ── 公共结构 ── */
.sc-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.sc-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  object-fit: cover;
  flex-shrink: 0;
}
.sc-uname-block { flex: 1; min-width: 0; }
.sc-uname {
  font-size: 1rem;
  font-weight: 600;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.sc-tag {
  font-size: 0.7rem;
  opacity: 0.8;
  margin-top: 2px;
}
.sc-price {
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.sc-message {
  padding: 12px 16px 14px 16px;
  font-size: 1.05rem;
  line-height: 1.45;
  background: rgba(0, 0, 0, 0.32);
  word-break: break-word;
}

/* ── basic：蓝紫渐变 ── */
.sc-basic .sc-card {
  background: linear-gradient(135deg, #4f46e5, #2563eb);
}

/* ── premium：紫 + 金边 + 光晕脉冲 ── */
.sc-premium .sc-card {
  background: linear-gradient(135deg, #7c3aed, #db2777);
  border: 1px solid rgba(252, 211, 77, 0.5);
  box-shadow: 0 0 28px rgba(168, 85, 247, 0.45), 0 16px 40px -10px rgba(0, 0, 0, 0.6);
  animation: premiumPulse 2s ease-in-out infinite;
}
@keyframes premiumPulse {
  0%, 100% { box-shadow: 0 0 28px rgba(168, 85, 247, 0.45), 0 16px 40px -10px rgba(0, 0, 0, 0.6); }
  50% { box-shadow: 0 0 40px rgba(252, 211, 77, 0.6), 0 16px 40px -10px rgba(0, 0, 0, 0.6); }
}

/* ── epic：金色 + 持续脉冲 ── */
.sc-epic .sc-card {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #422006;
  border: 1.5px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 0 36px rgba(251, 191, 36, 0.65), 0 16px 40px -10px rgba(0, 0, 0, 0.6);
  animation: epicPulse 1.6s ease-in-out infinite;
}
.sc-epic .sc-message {
  background: rgba(120, 53, 15, 0.4);
  color: #fef3c7;
}
.sc-epic .sc-tag { color: #78350f; }
@keyframes epicPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 36px rgba(251, 191, 36, 0.65), 0 16px 40px -10px rgba(0, 0, 0, 0.6); }
  50% { transform: scale(1.015); box-shadow: 0 0 54px rgba(252, 211, 77, 0.85), 0 16px 40px -10px rgba(0, 0, 0, 0.6); }
}

/* ── legendary：红金渐变 + 粒子 + 屏幕中央定位由 App.vue 控制 ── */
.sc-legendary {
  /* legendary 卡片更大 */
}
.sc-legendary .sc-card {
  width: 560px;
  background: linear-gradient(135deg, #dc2626, #f59e0b 60%, #fbbf24);
  border: 2px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 64px rgba(251, 113, 133, 0.7), 0 0 120px rgba(251, 191, 36, 0.55), 0 20px 60px -10px rgba(0, 0, 0, 0.7);
  animation: legendaryPulse 1.2s ease-in-out infinite;
}
.sc-legendary .sc-uname { font-size: 1.2rem; }
.sc-legendary .sc-price { font-size: 1.8rem; }
.sc-legendary .sc-message {
  font-size: 1.2rem;
  background: rgba(0, 0, 0, 0.4);
}
@keyframes legendaryPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.025); }
}

.sc-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.sc-particles span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle, #fde68a 0%, rgba(253, 230, 138, 0) 70%);
  --angle: calc(var(--i) * 36deg);
  animation: scParticle 2.4s ease-out infinite;
  animation-delay: calc(var(--i) * 0.1s);
}
@keyframes scParticle {
  0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(0.5); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(360px) scale(0.2); opacity: 0; }
}

@keyframes scIn {
  from { transform: translateY(-24px) scale(0.9); opacity: 0; filter: blur(4px); }
  to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
}
</style>
