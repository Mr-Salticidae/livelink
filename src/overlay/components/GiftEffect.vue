<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  uname: string
  giftName: string
  num: number
  giftId?: number
  price?: number // 单价 RMB（已除 1000）
  coinType?: 'gold' | 'silver'
}>()

// 价格档位：silver/免费 → normal；1-30 元 → premium；> 30 元 → epic
// price 是单价不含数量。判断"大额"用 price * num（连击 30 电池也算大额）。
// price 已经是 RMB 单位（main 层 / 1000 过）。1 电池 = 1 元。
const tier = computed<'normal' | 'premium' | 'epic'>(() => {
  const p = props.price ?? 0
  const total = p * (props.num || 1)
  if (props.coinType === 'silver' || total <= 0) return 'normal'
  if (total > 30) return 'epic'
  if (total >= 1) return 'premium'
  return 'normal'
})

// 礼物图加载失败兜底为 emoji。giftId 不存在或加载失败时直接 emoji
const imgFailed = ref(false)
const showImg = computed(() => props.giftId != null && !imgFailed.value)
</script>

<template>
  <div
    class="gift-effect"
    :class="['gift-tier-' + tier]"
  >
    <div class="gift-card">
      <img
        v-if="showImg"
        :src="`/api/gift/${giftId}`"
        @error="imgFailed = true"
        alt=""
        class="gift-image"
      />
      <span v-else class="gift-icon">🎁</span>
      <div class="gift-text">
        <span class="uname">{{ uname }}</span>
        <span class="line">送出 {{ giftName }} <span class="num">x{{ num }}</span></span>
      </div>
    </div>
    <!-- epic 档专属粒子背景层 -->
    <div v-if="tier === 'epic'" class="epic-particles" aria-hidden="true">
      <span v-for="i in 8" :key="i" :style="{ '--i': i }"></span>
    </div>
  </div>
</template>

<style scoped>
.gift-effect {
  pointer-events: none;
  position: relative;
}

.gift-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border-radius: 1rem;
  background: rgba(0, 0, 0, 0.55);
  padding: 0.6rem 1.1rem;
  color: white;
  box-shadow: 0 12px 40px -10px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  transform-origin: right center;
}

.gift-image {
  width: 56px;
  height: 56px;
  object-fit: contain;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
}
.gift-icon {
  font-size: 2rem;
  line-height: 1;
}
.gift-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.uname {
  font-size: 0.85rem;
  color: #fcd34d;
}
.line {
  font-size: 1rem;
  font-weight: 500;
}
.num { color: #fcd34d; }

/* normal: 飞入 + 抖动 + 飞出（原版动效） */
.gift-tier-normal .gift-card {
  animation: giftIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    giftOut 0.6s ease-in 3.4s both;
}
.gift-tier-normal .gift-icon,
.gift-tier-normal .gift-image {
  animation: bounce 0.8s ease-out 0.3s 2;
}

/* premium: 加放大缩放 + 金色光晕 */
.gift-tier-premium .gift-card {
  animation: giftIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    premiumPulse 1.4s ease-in-out 0.6s 2 both,
    giftOut 0.6s ease-in 3.6s both;
  box-shadow: 0 0 24px 4px rgba(252, 211, 77, 0.35),
    0 12px 40px -10px rgba(0, 0, 0, 0.5);
}
.gift-tier-premium .gift-image {
  filter: drop-shadow(0 0 12px rgba(252, 211, 77, 0.8));
}

@keyframes premiumPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}

/* epic: 占整个 overlay 中央，慢动画 + 粒子 */
.gift-tier-epic {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
}
.gift-tier-epic .gift-card {
  padding: 1.5rem 2.5rem;
  background: linear-gradient(135deg, rgba(120, 53, 15, 0.85), rgba(0, 0, 0, 0.75));
  box-shadow: 0 0 80px 20px rgba(252, 211, 77, 0.55),
    0 0 200px 50px rgba(252, 211, 77, 0.25);
  animation: epicIn 0.9s cubic-bezier(0.2, 0.9, 0.3, 1.1) both,
    epicOut 0.7s ease-in 2.6s both;
}
.gift-tier-epic .gift-image {
  width: 120px;
  height: 120px;
  filter: drop-shadow(0 0 24px rgba(252, 211, 77, 1));
}
.gift-tier-epic .gift-icon { font-size: 4rem; }
.gift-tier-epic .uname { font-size: 1.4rem; }
.gift-tier-epic .line { font-size: 1.6rem; }

@keyframes epicIn {
  from { transform: scale(0.5); opacity: 0; filter: blur(8px); }
  to   { transform: scale(1); opacity: 1; filter: blur(0); }
}
@keyframes epicOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(1.4); opacity: 0; }
}

.epic-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.epic-particles span {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: radial-gradient(circle, #fde68a 0%, rgba(253, 230, 138, 0) 70%);
  animation: particleBurst 2.6s ease-out forwards;
  /* 八个粒子放射，各方向 */
  --angle: calc(var(--i) * 45deg);
}
@keyframes particleBurst {
  0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(0.5); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(280px) scale(0.2); opacity: 0; }
}

@keyframes giftIn {
  from { transform: translateX(120%) scale(0.85); opacity: 0; }
  to   { transform: translateX(0) scale(1); opacity: 1; }
}
@keyframes giftOut {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(120%); opacity: 0; }
}
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}
</style>
