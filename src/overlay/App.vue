<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { on } from './socket'
import type { OverlayPayload } from './types'
import GiftEffect from './components/GiftEffect.vue'
import ViewerEnterBanner from './components/ViewerEnterBanner.vue'
import BlindboxCard from './components/BlindboxCard.vue'
import LotteryCard from './components/LotteryCard.vue'
import LotteryResultCard from './components/LotteryResultCard.vue'
import DanmuBoard from './components/DanmuBoard.vue'
import SuperChatBanner from './components/SuperChatBanner.vue'

type BoardPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
interface BoardConfig {
  enabled: boolean
  position: BoardPosition
  maxLines: number
  fontSize: number
  showGift: boolean
}

interface GiftItem {
  id: string
  uname: string
  giftName: string
  num: number
  giftId?: number
  price?: number
  coinType?: 'gold' | 'silver'
}

interface EnterItem {
  id: string
  text: string
}

interface BlindboxRecord {
  uname: string
  firstOpenAt: number
  lastOpenAt: number
  totalCost: number
  totalReward: number
  totalOpenCount: number
  records: Array<{
    ts: number
    blindBoxName: string
    cost: number
    reward: number
    gain: number
    rewardName: string
    rewardNum: number
  }>
}

interface BlindboxCardItem {
  id: string
  uname: string
  record: BlindboxRecord
}

interface LotteryRunningState {
  prize: string
  keyword: string
  winnerCount: number
  endsAt: number
  participantCount: number
}

interface LotteryResultState {
  id: string
  prize: string
  winners: Array<{ uid: string; uname: string }>
  participantCount: number
}

interface SuperChatItem {
  id: string
  uname: string
  message: string
  price: number
  avatar?: string
  durationSec: number
  // 按价位决定 overlay 显示秒数：basic 15 / premium 25 / epic 40 / legendary 60
  visibleMs: number
  isLegendary: boolean
}

const MAX_ACTIVE_GIFTS = 3
const GIFT_VISIBLE_MS = 4000
const ENTER_VISIBLE_MS = 4500
const BLINDBOX_VISIBLE_MS = 7000
const LOTTERY_RESULT_MS = 10_000

const activeGifts = ref<GiftItem[]>([])
const giftQueue = ref<GiftItem[]>([])
const activeEnters = ref<EnterItem[]>([])
const activeBlindboxCard = ref<BlindboxCardItem | null>(null)
const activeLottery = ref<LotteryRunningState | null>(null)
const activeLotteryResult = ref<LotteryResultState | null>(null)
// SC：顶部排队（basic/premium/epic 最多 2 个同时显示），legendary 独占屏幕中央
const topSuperChats = ref<SuperChatItem[]>([])
const legendarySuperChat = ref<SuperChatItem | null>(null)
const MAX_TOP_SC = 2

// OBS 弹幕信息板：默认关闭，主进程通过 danmu.board.config 推送配置
const danmuBoardConfig = ref<BoardConfig>({
  enabled: false,
  position: 'bottom-left',
  maxLines: 10,
  fontSize: 16,
  showGift: true
})
const danmuBoardRef = ref<InstanceType<typeof DanmuBoard> | null>(null)
const boardPosStyle = computed(() => {
  const PAD = '24px'
  switch (danmuBoardConfig.value.position) {
    case 'top-left': return { top: PAD, left: PAD }
    case 'top-right': return { top: PAD, right: PAD }
    case 'bottom-right': return { bottom: PAD, right: PAD }
    case 'bottom-left':
    default: return { bottom: PAD, left: PAD }
  }
})

const uid = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function enqueueGift(item: GiftItem): void {
  if (activeGifts.value.length < MAX_ACTIVE_GIFTS) {
    activeGifts.value.push(item)
    window.setTimeout(() => releaseGift(item.id), GIFT_VISIBLE_MS)
  } else {
    giftQueue.value.push(item)
  }
}

function releaseGift(id: string): void {
  activeGifts.value = activeGifts.value.filter((g) => g.id !== id)
  const next = giftQueue.value.shift()
  if (next) {
    activeGifts.value.push(next)
    window.setTimeout(() => releaseGift(next.id), GIFT_VISIBLE_MS)
  }
}

function pushEnter(item: EnterItem): void {
  activeEnters.value.push(item)
  // 限制顶部最多 4 条同时显示，再多直接顶掉最早的
  if (activeEnters.value.length > 4) activeEnters.value.shift()
  window.setTimeout(() => {
    activeEnters.value = activeEnters.value.filter((e) => e.id !== item.id)
  }, ENTER_VISIBLE_MS)
}

onMounted(() => {
  on<OverlayPayload>('gift.received', (msg) => {
    const ev = msg.event
    const payload = ev.payload as {
      giftId?: number
      giftName?: string
      num?: number
      price?: number
      coinType?: 'gold' | 'silver'
    }
    enqueueGift({
      id: uid(),
      uname: ev.user?.uname ?? '观众',
      giftName: payload?.giftName ?? '礼物',
      num: typeof payload?.num === 'number' ? payload.num : 1,
      giftId: payload?.giftId,
      price: payload?.price,
      coinType: payload?.coinType
    })
  })

  on<OverlayPayload>('viewer.enter', (msg) => {
    const text = msg.text || `欢迎 ${msg.event?.user?.uname ?? '新观众'}`
    pushEnter({ id: uid(), text })
  })

  // 盲盒查询卡片：触发者通常是发"查盲盒"弹幕的人。同一时间只显示一张卡，
  // 新卡顶替旧卡（避免多人同时查询时叠满屏）。
  on<OverlayPayload>('blindbox.card', (msg) => {
    const extra = msg.extra as { record?: BlindboxRecord } | undefined
    if (!extra?.record) return
    const item: BlindboxCardItem = {
      id: uid(),
      uname: msg.event?.user?.uname ?? '观众',
      record: extra.record
    }
    activeBlindboxCard.value = item
    window.setTimeout(() => {
      if (activeBlindboxCard.value?.id === item.id) activeBlindboxCard.value = null
    }, BLINDBOX_VISIBLE_MS)
  })

  // 抽奖：start / tick / result / cancelled
  on<OverlayPayload>('lottery.start', (msg) => {
    const x = msg.extra as
      | { prize?: string; keyword?: string; winnerCount?: number; endsAt?: number }
      | undefined
    if (!x?.endsAt) return
    activeLotteryResult.value = null // 新一轮开始，清掉旧结果卡
    activeLottery.value = {
      prize: x.prize ?? '',
      keyword: x.keyword ?? '',
      winnerCount: x.winnerCount ?? 1,
      endsAt: x.endsAt,
      participantCount: 0
    }
  })

  on<OverlayPayload>('lottery.tick', (msg) => {
    const x = msg.extra as { participantCount?: number } | undefined
    if (!activeLottery.value || typeof x?.participantCount !== 'number') return
    activeLottery.value = { ...activeLottery.value, participantCount: x.participantCount }
  })

  on<OverlayPayload>('lottery.result', (msg) => {
    const x = msg.extra as
      | {
          prize?: string
          winners?: Array<{ uid: string; uname: string }>
          participantCount?: number
        }
      | undefined
    activeLottery.value = null // 进行中卡片让位给结果卡
    const result: LotteryResultState = {
      id: uid(),
      prize: x?.prize ?? '',
      winners: x?.winners ?? [],
      participantCount: x?.participantCount ?? 0
    }
    activeLotteryResult.value = result
    window.setTimeout(() => {
      if (activeLotteryResult.value?.id === result.id) activeLotteryResult.value = null
    }, LOTTERY_RESULT_MS)
  })

  on<OverlayPayload>('lottery.cancelled', () => {
    activeLottery.value = null
  })

  // SuperChat 横幅：系统级 broadcast，不依赖规则引擎。按价位放顶部 / 中央
  on<OverlayPayload>('super.chat.banner', (msg) => {
    const ev = msg.event
    const p = ev.payload as { message?: string; price?: number; durationSec?: number }
    const price = typeof p?.price === 'number' ? p.price : 0
    const isLegendary = price >= 1000
    const visibleMs =
      price >= 1000 ? 60_000 : price >= 500 ? 40_000 : price >= 100 ? 25_000 : 15_000

    const item: SuperChatItem = {
      id: uid(),
      uname: ev.user?.uname ?? '观众',
      message: p?.message ?? '',
      price,
      avatar: (ev.user as { avatar?: string })?.avatar,
      durationSec: typeof p?.durationSec === 'number' ? p.durationSec : 0,
      visibleMs,
      isLegendary
    }

    if (isLegendary) {
      // legendary 独占屏幕中央，新一张顶替旧的（罕见，价位 ≥1000 一般不连续）
      legendarySuperChat.value = item
      window.setTimeout(() => {
        if (legendarySuperChat.value?.id === item.id) legendarySuperChat.value = null
      }, item.visibleMs)
    } else {
      topSuperChats.value.push(item)
      if (topSuperChats.value.length > MAX_TOP_SC) topSuperChats.value.shift()
      window.setTimeout(() => {
        topSuperChats.value = topSuperChats.value.filter((s) => s.id !== item.id)
      }, item.visibleMs)
    }
  })

  // OBS 弹幕信息板配置推送（启动 / Home 页改配置时 push）
  on<OverlayPayload>('danmu.board.config', (msg) => {
    const x = msg.extra as Partial<BoardConfig> | undefined
    if (!x) return
    danmuBoardConfig.value = { ...danmuBoardConfig.value, ...x }
  })

  // OBS 弹幕信息板：每条弹幕 / 礼物（仅 enabled 时主进程才推）
  on<OverlayPayload>('danmu.board.item', (msg) => {
    const ev = msg.event
    const item = {
      id: uid(),
      kind: (ev.kind === 'gift.received' ? 'gift' : 'danmu') as 'danmu' | 'gift',
      uname: ev.user?.uname ?? '观众',
      guardLevel: ev.user?.guardLevel ?? 0,
      isAnchor: false,
      fansMedalLevel: 0,
      content: undefined as string | undefined,
      giftName: undefined as string | undefined,
      num: undefined as number | undefined
    }
    // user 上还可能有 fansMedal（main 端 toUserInfo 加的）
    const u = ev.user as unknown as { fansMedal?: { isAnchor: boolean; level: number } }
    if (u?.fansMedal) {
      item.isAnchor = u.fansMedal.isAnchor
      item.fansMedalLevel = u.fansMedal.level
    }
    if (ev.kind === 'gift.received') {
      const p = ev.payload as { giftName?: string; num?: number }
      item.giftName = p?.giftName ?? '礼物'
      item.num = typeof p?.num === 'number' ? p.num : 1
    } else {
      const p = ev.payload as { content?: string }
      item.content = p?.content ?? ''
    }
    danmuBoardRef.value?.push(item)
  })
})
</script>

<template>
  <div class="relative h-screen w-screen overflow-hidden">
    <!-- 顶部进房欢迎区 -->
    <div class="absolute left-1/2 top-6 -translate-x-1/2 flex flex-col items-center gap-2">
      <ViewerEnterBanner v-for="e in activeEnters" :key="e.id" :text="e.text" />
    </div>

    <!-- 右下礼物特效区 -->
    <div class="absolute bottom-10 right-10 flex flex-col-reverse items-end gap-3">
      <GiftEffect
        v-for="g in activeGifts"
        :key="g.id"
        :uname="g.uname"
        :gift-name="g.giftName"
        :num="g.num"
        :gift-id="g.giftId"
        :price="g.price"
        :coin-type="g.coinType"
      />
    </div>

    <!-- 屏幕中央盲盒查询卡 -->
    <div
      v-if="activeBlindboxCard"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <BlindboxCard
        :key="activeBlindboxCard.id"
        :uname="activeBlindboxCard.uname"
        :record="activeBlindboxCard.record"
      />
    </div>

    <!-- 屏幕中央抽奖进行中卡 -->
    <div
      v-if="activeLottery"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <LotteryCard
        :prize="activeLottery.prize"
        :keyword="activeLottery.keyword"
        :winner-count="activeLottery.winnerCount"
        :ends-at="activeLottery.endsAt"
        :participant-count="activeLottery.participantCount"
      />
    </div>

    <!-- 屏幕中央抽奖结果卡 -->
    <div
      v-if="activeLotteryResult"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <LotteryResultCard
        :key="activeLotteryResult.id"
        :prize="activeLotteryResult.prize"
        :winners="activeLotteryResult.winners"
        :participant-count="activeLotteryResult.participantCount"
      />
    </div>

    <!-- OBS 弹幕信息板（给观众看），enabled 时按 position 定位 -->
    <div v-if="danmuBoardConfig.enabled" class="absolute" :style="boardPosStyle">
      <DanmuBoard
        ref="danmuBoardRef"
        :max-lines="danmuBoardConfig.maxLines"
        :font-size="danmuBoardConfig.fontSize"
      />
    </div>

    <!-- SuperChat 顶部横幅区（< 1000 元都在这） -->
    <div class="absolute left-1/2 top-20 -translate-x-1/2 flex flex-col items-center gap-3">
      <SuperChatBanner
        v-for="sc in topSuperChats"
        :key="sc.id"
        :uname="sc.uname"
        :message="sc.message"
        :price="sc.price"
        :avatar="sc.avatar"
        :duration-sec="sc.durationSec"
      />
    </div>

    <!-- SuperChat legendary（≥ 1000）独占屏幕中央 -->
    <div
      v-if="legendarySuperChat"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <SuperChatBanner
        :key="legendarySuperChat.id"
        :uname="legendarySuperChat.uname"
        :message="legendarySuperChat.message"
        :price="legendarySuperChat.price"
        :avatar="legendarySuperChat.avatar"
        :duration-sec="legendarySuperChat.durationSec"
      />
    </div>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
body { background: transparent; }
</style>
