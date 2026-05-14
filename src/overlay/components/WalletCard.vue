<script setup lang="ts">
import { computed } from 'vue'

interface WalletRecord {
  balance: number
  totalBet: number
  totalWon: number
  totalDeposited: number
}

const props = defineProps<{
  uname: string
  currencyName: string
  initialBalance: number
  // null 表示该观众还没开户（没参与过竞猜也没送过礼）
  record: WalletRecord | null
}>()

const hasRecord = computed(() => props.record != null)

// 净盈亏 = 赢 + 入金 - 押注。"入金"=礼物兑换，独立累计避免和"赢"混淆。
// 这里给玩家看的"游戏净盈亏"用 totalWon - totalBet（不算入金，因为入金本来就是观众真金白银换来的）
const gameNet = computed(() => {
  if (!props.record) return 0
  return props.record.totalWon - props.record.totalBet
})
const isProfit = computed(() => gameNet.value >= 0)
const gameNetText = computed(() => {
  const abs = Math.abs(gameNet.value)
  return isProfit.value ? `+${abs}` : `-${abs}`
})
</script>

<template>
  <div class="wallet-card">
    <div class="wallet-card-inner">
      <header class="wc-header">
        <span class="wc-icon">👛</span>
        <div>
          <div class="wc-title">{{ uname }} 的{{ currencyName }}账本</div>
          <div v-if="hasRecord" class="wc-sub">余额随竞猜结算 / 送礼自动更新</div>
          <div v-else class="wc-sub">还没开户哦</div>
        </div>
      </header>

      <!-- 有记录：余额大字 + 3 项细分 -->
      <template v-if="hasRecord && record">
        <div class="wc-balance">
          <div class="wc-balance-num">{{ record.balance }}</div>
          <div class="wc-balance-unit">{{ currencyName }}</div>
        </div>

        <div class="wc-stats">
          <div class="wc-stat">
            <div class="wc-stat-label">送礼入金</div>
            <div class="wc-stat-value deposit">{{ record.totalDeposited }}</div>
          </div>
          <div class="wc-stat">
            <div class="wc-stat-label">累计押注</div>
            <div class="wc-stat-value">{{ record.totalBet }}</div>
          </div>
          <div class="wc-stat" :class="isProfit ? 'profit' : 'loss'">
            <div class="wc-stat-label">游戏盈亏</div>
            <div class="wc-stat-value">{{ gameNetText }}</div>
          </div>
        </div>
      </template>

      <!-- 无记录：开户引导 -->
      <div v-else class="wc-empty">
        <div class="wc-empty-text">
          参与一次竞猜押注 / 送一份礼物 →<br>
          自动获得
          <strong class="wc-empty-amount">{{ initialBalance }}</strong>
          {{ currencyName }} 开户金
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wallet-card {
  pointer-events: none;
  animation: wcIn 0.5s cubic-bezier(0.2, 0.7, 0.2, 1.2) both,
    wcOut 0.6s ease-in 5.4s both;
}
.wallet-card-inner {
  width: 380px;
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  padding: 1.25rem 1.5rem;
  color: #f1f5f9;
  box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.6),
    0 0 24px 2px rgba(251, 191, 36, 0.3);
  border: 1px solid rgba(251, 191, 36, 0.35);
  backdrop-filter: blur(12px);
}
.wc-header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
.wc-icon { font-size: 2.2rem; }
.wc-title { font-size: 1.1rem; font-weight: 600; }
.wc-sub { font-size: 0.78rem; color: #94a3b8; margin-top: 2px; }

.wc-balance {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.5rem;
  margin: 0.75rem 0 1rem;
}
.wc-balance-num {
  font-size: 2.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fbbf24;
  text-shadow: 0 0 18px rgba(251, 191, 36, 0.45);
}
.wc-balance-unit {
  font-size: 0.9rem;
  color: #cbd5e1;
}

.wc-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}
.wc-stat {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 0.625rem;
  padding: 0.5rem 0.5rem;
  text-align: center;
}
.wc-stat-label { font-size: 0.68rem; color: #94a3b8; }
.wc-stat-value {
  font-size: 0.95rem;
  font-weight: 600;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.wc-stat-value.deposit { color: #38bdf8; }
.wc-stat.profit .wc-stat-value { color: #34d399; }
.wc-stat.loss .wc-stat-value { color: #fb7185; }

.wc-empty {
  background: rgba(15, 23, 42, 0.5);
  border-radius: 0.625rem;
  padding: 1rem 1.25rem;
  text-align: center;
}
.wc-empty-text {
  font-size: 0.88rem;
  color: #cbd5e1;
  line-height: 1.6;
}
.wc-empty-amount {
  color: #fbbf24;
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0 2px;
}

@keyframes wcIn {
  from { transform: translate(-50%, calc(-50% + 24px)) scale(0.92); opacity: 0; }
  to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
@keyframes wcOut {
  from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  to   { transform: translate(-50%, calc(-50% - 24px)) scale(0.95); opacity: 0; }
}
</style>
