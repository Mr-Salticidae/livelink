<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { on } from './socket'
import type { OverlayPayload } from './types'
import GiftEffect from './components/GiftEffect.vue'
import ViewerEnterBanner from './components/ViewerEnterBanner.vue'

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

const MAX_ACTIVE_GIFTS = 3
const GIFT_VISIBLE_MS = 4000
const ENTER_VISIBLE_MS = 4500

const activeGifts = ref<GiftItem[]>([])
const giftQueue = ref<GiftItem[]>([])
const activeEnters = ref<EnterItem[]>([])

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
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
body { background: transparent; }
</style>
