<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { on, socket } from './socket'
import type { OverlayPayload } from './types'
import GiftEffect from './components/GiftEffect.vue'
import ViewerEnterBanner from './components/ViewerEnterBanner.vue'
import BlindboxCard from './components/BlindboxCard.vue'
import WalletCard from './components/WalletCard.vue'
import LotteryCard from './components/LotteryCard.vue'
import LotteryResultCard from './components/LotteryResultCard.vue'
import DanmuBoard from './components/DanmuBoard.vue'
import SuperChatBanner from './components/SuperChatBanner.vue'
import VotingCard from './components/VotingCard.vue'
import VotingResultCard from './components/VotingResultCard.vue'
import HorseRaceCard from './components/HorseRaceCard.vue'
import HorseRaceResultCard from './components/HorseRaceResultCard.vue'
import GuessingCard from './components/GuessingCard.vue'
import GuessingResultCard from './components/GuessingResultCard.vue'
import IntroBanner from './components/IntroBanner.vue'
import Celebration from './components/Celebration.vue'
import PetDock from './components/PetDock.vue'
import PetCard from './components/PetCard.vue'
import SongBoard from './components/SongBoard.vue'
import type { PetDisplayItem } from '../shared/pets'
import { DEFAULT_OVERLAY_THEME, normalizeOverlayThemeId, type OverlayThemeId } from '../shared/overlay-theme'

interface BoardPosition { x: number; y: number }
interface BoardConfig {
  enabled: boolean
  position: BoardPosition
  maxLines: number
  fontSize: number
  showGift: boolean
  width: number
  maxHeightPct: number
  previewFull?: boolean // 装修预览模式（瞬时，主进程下发）
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

interface WalletRecord {
  balance: number
  totalBet: number
  totalWon: number
  totalDeposited: number
}
interface WalletCardItem {
  id: string
  uname: string
  currencyName: string
  initialBalance: number
  record: WalletRecord | null
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

interface GuessingOpt { key: string; label: string }
interface GuessingActive {
  phase: 'enrolling' | 'settling'
  title: string
  options: GuessingOpt[]
  bets: Record<string, number>
  pool: number
  bettorCount: number
  currencyName: string
  defaultBet: number
  endsAt?: number
}
interface GuessingWinner { uname: string; bet: number; payout: number }
interface GuessingResult {
  id: string
  title: string
  options: GuessingOpt[]
  winnerKey: string
  winnerLabel: string
  winners: GuessingWinner[]
  pool: number
  bets: Record<string, number>
}

interface HorseDef { key: string; name: string; emoji: string }
interface HorseRanking { horseKey: string; position: number; rank: number }
interface HorseRaceWinner { uname: string; bet: number; payout: number }
interface HorseRaceActive {
  phase: 'enrolling' | 'racing'
  horses: HorseDef[]
  enrollments: Record<string, number>
  bets: Record<string, number>
  pool: number
  bettorCount: number
  currencyName: string
  defaultBet: number
  positions: Record<string, number>
  endsAt?: number
}
interface HorseRaceResult {
  id: string
  horses: HorseDef[]
  rankings: HorseRanking[]
  enrollments: Record<string, number>
  winners: HorseRaceWinner[]
  pool: number
  currencyName: string
  winnerBettors: string[]
  winnerHorseKey: string | null
}

interface VotingOption { key: string; label: string }
interface VotingRunningState {
  title: string
  options: VotingOption[]
  endsAt: number
  counts: Record<string, number>
  totalVotes: number
}
interface VotingResultState {
  id: string
  title: string
  options: VotingOption[]
  counts: Record<string, number>
  totalVotes: number
  winnerKey: string | null
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

interface PetCardItem {
  id: string
  title: string
  item: PetDisplayItem
  mode: 'normal' | 'level' | 'evolve'
}

const MAX_ACTIVE_GIFTS = 3
const GIFT_VISIBLE_MS = 4000
const ENTER_VISIBLE_MS = 4500
const BLINDBOX_VISIBLE_MS = 7000
const WALLET_VISIBLE_MS = 6000
const LOTTERY_RESULT_MS = 10_000

const activeGifts = ref<GiftItem[]>([])
const giftQueue = ref<GiftItem[]>([])
const activeEnters = ref<EnterItem[]>([])
const activeBlindboxCard = ref<BlindboxCardItem | null>(null)
const activeWalletCard = ref<WalletCardItem | null>(null)
const activeLottery = ref<LotteryRunningState | null>(null)
const activeLotteryResult = ref<LotteryResultState | null>(null)
// SC：顶部排队（basic/premium/epic 最多 2 个同时显示），legendary 独占屏幕中央
const topSuperChats = ref<SuperChatItem[]>([])
const legendarySuperChat = ref<SuperChatItem | null>(null)
const MAX_TOP_SC = 2
const VOTING_RESULT_MS = 9_000

const activeVoting = ref<VotingRunningState | null>(null)
const activeVotingResult = ref<VotingResultState | null>(null)
const HORSE_RESULT_MS = 10_000
const activeHorseRace = ref<HorseRaceActive | null>(null)
const activeHorseRaceResult = ref<HorseRaceResult | null>(null)
const GUESSING_RESULT_MS = 10_000
const activeGuessing = ref<GuessingActive | null>(null)
const activeGuessingResult = ref<GuessingResult | null>(null)
const petDockEnabled = ref(false)
const petDockItems = ref<PetDisplayItem[]>([])
const petDockOffsetY = ref(0)
const activePetCard = ref<PetCardItem | null>(null)
const PET_CARD_VISIBLE_MS = 6500

// 点歌板：常驻组件，靠主进程推全量状态，自己不维护增量
interface SongBoardItem {
  id: string
  title: string
  uname: string
  cost: number
  source: 'danmu' | 'host'
}
interface SongBoardState {
  enabled: boolean
  corner: string
  open: boolean
  keyword: string
  cost: number
  currencyName: string
  current: SongBoardItem | null
  queue: SongBoardItem[]
  queueTotal: number
}
const songBoard = ref<SongBoardState>({
  enabled: false,
  corner: 'top-right',
  open: true,
  keyword: '点歌',
  cost: 0,
  currencyName: '哈松币',
  current: null,
  queue: [],
  queueTotal: 0
})
// 一首都没有时整块隐藏：没人点歌的直播不该在画面上常年挂一个空框
const songBoardVisible = computed(
  () =>
    songBoard.value.enabled &&
    (songBoard.value.current !== null || songBoard.value.queueTotal > 0)
)
const songBoardPositionClass = computed(() => {
  switch (songBoard.value.corner) {
    case 'top-left':
      return 'left-4 top-4'
    case 'bottom-left':
      return 'bottom-4 left-4'
    case 'bottom-right':
      return 'bottom-4 right-4'
    default:
      return 'right-4 top-4'
  }
})
const overlayThemeId = ref<OverlayThemeId>(DEFAULT_OVERLAY_THEME.id)

// 开场招牌：游戏启动那 2.4 秒显示
interface IntroState {
  id: string
  icon: string
  title: string
  subtitle?: string
  theme: 'gold' | 'sky' | 'amber'
}
const activeIntro = ref<IntroState | null>(null)
const INTRO_VISIBLE_MS = 2400

function showIntro(intro: Omit<IntroState, 'id'>): void {
  const item: IntroState = { ...intro, id: uid() }
  activeIntro.value = item
  window.setTimeout(() => {
    if (activeIntro.value?.id === item.id) activeIntro.value = null
  }, INTRO_VISIBLE_MS)
}

// 结果飘彩：result 揭晓时撒 2.5 秒彩纸
const activeCelebration = ref<string | null>(null)
const CELEBRATION_VISIBLE_MS = 2800

function triggerCelebration(): void {
  const id = uid()
  activeCelebration.value = id
  window.setTimeout(() => {
    if (activeCelebration.value === id) activeCelebration.value = null
  }, CELEBRATION_VISIBLE_MS)
}

// OBS 弹幕信息板：默认关闭，主进程通过 danmu.board.config 推送配置
const danmuBoardConfig = ref<BoardConfig>({
  enabled: false,
  position: { x: 2, y: 76 },
  maxLines: 10,
  fontSize: 16,
  showGift: true,
  width: 360,
  maxHeightPct: 80
})
const danmuBoardRef = ref<InstanceType<typeof DanmuBoard> | null>(null)

// 弹幕板缓冲：item 事件可能在 DanmuBoard 还没挂载（enabled 刚 true / ref 未绑定）时到达，
// 直接 push 会被丢 → 观众看不到新弹幕。先入缓冲，板子就绪后按序补放。
type BoardPushItem = Parameters<NonNullable<typeof danmuBoardRef.value>['push']>[0]
const boardBuffer: BoardPushItem[] = []
function pushToBoard(item: BoardPushItem): void {
  const board = danmuBoardRef.value
  if (board) {
    board.push(item)
    return
  }
  boardBuffer.push(item)
  if (boardBuffer.length > 200) boardBuffer.splice(0, boardBuffer.length - 200)
}
function flushBoardBuffer(): void {
  const board = danmuBoardRef.value
  if (!board || boardBuffer.length === 0) return
  for (const it of boardBuffer) board.push(it)
  boardBuffer.length = 0
}
// 板子被开启 → 等组件挂载完再把缓冲补上
watch(
  () => danmuBoardConfig.value.enabled,
  (en) => {
    if (en) void nextTick(flushBoardBuffer)
  }
)
// 板子定位：锚点放在视口 (x%, y%)，再按板子「自身尺寸」反向位移同样的百分比。
// transform translate 的 % 是相对元素自身算的，所以 x=0 贴左、x=100 贴右、
// x=50 水平居中——任何分辨率、任何板子尺寸都保证整块永远在屏幕内，不会被边缘切。
const boardPosStyle = computed(() => {
  const p = danmuBoardConfig.value.position
  return {
    left: `${p.x}%`,
    top: `${p.y}%`,
    transform: `translate(${-p.x}%, ${-p.y}%)`
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

  // 货币余额查询卡：发"查余额"弹幕触发。无记录也推卡（"待开户"提示）。
  // 同一时间只显示一张，新卡顶替旧卡
  on<OverlayPayload>('wallet.card', (msg) => {
    const extra = msg.extra as
      | {
          uname?: string
          currencyName?: string
          initialBalance?: number
          record?: WalletRecord | null
        }
      | undefined
    if (!extra) return
    const item: WalletCardItem = {
      id: uid(),
      uname: extra.uname ?? msg.event?.user?.uname ?? '观众',
      currencyName: extra.currencyName ?? '哈松币',
      initialBalance: extra.initialBalance ?? 1000,
      record: extra.record ?? null
    }
    activeWalletCard.value = item
    window.setTimeout(() => {
      if (activeWalletCard.value?.id === item.id) activeWalletCard.value = null
    }, WALLET_VISIBLE_MS)
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
    showIntro({
      icon: '🎰',
      title: '抽奖开始啦',
      subtitle: x.keyword ? `发 "${x.keyword}" 参与` : undefined,
      theme: 'gold'
    })
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
    // 有中奖者才庆祝（没人参与不撒彩）
    if (result.winners.length > 0) triggerCelebration()
    window.setTimeout(() => {
      if (activeLotteryResult.value?.id === result.id) activeLotteryResult.value = null
    }, LOTTERY_RESULT_MS)
  })

  on<OverlayPayload>('lottery.cancelled', () => {
    activeLottery.value = null
  })

  // 互动投票：start / tick / result / cancelled
  on<OverlayPayload>('voting.start', (msg) => {
    const x = msg.extra as
      | { title?: string; options?: VotingOption[]; endsAt?: number; counts?: Record<string, number> }
      | undefined
    if (!x?.endsAt || !Array.isArray(x?.options)) return
    activeVotingResult.value = null
    activeVoting.value = {
      title: x.title ?? '',
      options: x.options,
      endsAt: x.endsAt,
      counts: x.counts ?? {},
      totalVotes: 0
    }
    showIntro({
      icon: '📊',
      title: '投票时间',
      subtitle: x.title ?? '发选项号参与',
      theme: 'sky'
    })
  })
  on<OverlayPayload>('voting.tick', (msg) => {
    const x = msg.extra as { counts?: Record<string, number>; totalVotes?: number } | undefined
    if (!activeVoting.value || !x?.counts) return
    activeVoting.value = {
      ...activeVoting.value,
      counts: x.counts,
      totalVotes: x.totalVotes ?? 0
    }
  })
  on<OverlayPayload>('voting.result', (msg) => {
    const x = msg.extra as
      | {
          title?: string
          options?: VotingOption[]
          counts?: Record<string, number>
          totalVotes?: number
          winnerKey?: string | null
        }
      | undefined
    activeVoting.value = null
    if (!x || !Array.isArray(x.options)) return
    const result: VotingResultState = {
      id: uid(),
      title: x.title ?? '',
      options: x.options,
      counts: x.counts ?? {},
      totalVotes: x.totalVotes ?? 0,
      winnerKey: x.winnerKey ?? null
    }
    activeVotingResult.value = result
    if (result.totalVotes > 0) triggerCelebration()
    window.setTimeout(() => {
      if (activeVotingResult.value?.id === result.id) activeVotingResult.value = null
    }, VOTING_RESULT_MS)
  })
  on<OverlayPayload>('voting.cancelled', () => {
    activeVoting.value = null
  })

  // 赛马
  on<OverlayPayload>('horserace.enroll-start', (msg) => {
    const x = msg.extra as
      | {
          horses?: HorseDef[]
          endsAt?: number
          enrollments?: Record<string, number>
          bets?: Record<string, number>
          pool?: number
          bettorCount?: number
          currencyName?: string
          defaultBet?: number
        }
      | undefined
    if (!x?.endsAt || !Array.isArray(x?.horses)) return
    activeHorseRaceResult.value = null
    activeHorseRace.value = {
      phase: 'enrolling',
      horses: x.horses,
      enrollments: x.enrollments ?? {},
      bets: x.bets ?? {},
      pool: x.pool ?? 0,
      bettorCount: x.bettorCount ?? 0,
      currencyName: x.currencyName ?? '哈松币',
      defaultBet: x.defaultBet ?? 100,
      positions: {},
      endsAt: x.endsAt
    }
    showIntro({
      icon: '🏇',
      title: '赛马来啦',
      subtitle: '发马号押注',
      theme: 'amber'
    })
  })
  on<OverlayPayload>('horserace.enroll-tick', (msg) => {
    const x = msg.extra as
      | {
          enrollments?: Record<string, number>
          bets?: Record<string, number>
          pool?: number
          bettorCount?: number
        }
      | undefined
    if (!activeHorseRace.value || activeHorseRace.value.phase !== 'enrolling' || !x) return
    activeHorseRace.value = {
      ...activeHorseRace.value,
      enrollments: x.enrollments ?? activeHorseRace.value.enrollments,
      bets: x.bets ?? activeHorseRace.value.bets,
      pool: x.pool ?? activeHorseRace.value.pool,
      bettorCount: x.bettorCount ?? activeHorseRace.value.bettorCount
    }
  })
  on<OverlayPayload>('horserace.race-start', (msg) => {
    const x = msg.extra as
      | {
          horses?: HorseDef[]
          positions?: Record<string, number>
          enrollments?: Record<string, number>
          bets?: Record<string, number>
          pool?: number
          bettorCount?: number
          currencyName?: string
        }
      | undefined
    if (!Array.isArray(x?.horses)) return
    activeHorseRace.value = {
      phase: 'racing',
      horses: x.horses,
      enrollments: x.enrollments ?? activeHorseRace.value?.enrollments ?? {},
      bets: x.bets ?? activeHorseRace.value?.bets ?? {},
      pool: x.pool ?? activeHorseRace.value?.pool ?? 0,
      bettorCount: x.bettorCount ?? activeHorseRace.value?.bettorCount ?? 0,
      currencyName: x.currencyName ?? activeHorseRace.value?.currencyName ?? '哈松币',
      defaultBet: activeHorseRace.value?.defaultBet ?? 100,
      positions: x.positions ?? {}
    }
  })
  on<OverlayPayload>('horserace.tick', (msg) => {
    const x = msg.extra as { positions?: Record<string, number> } | undefined
    if (!activeHorseRace.value || activeHorseRace.value.phase !== 'racing' || !x?.positions) return
    activeHorseRace.value = { ...activeHorseRace.value, positions: x.positions }
  })
  on<OverlayPayload>('horserace.result', (msg) => {
    const x = msg.extra as
      | {
          horses?: HorseDef[]
          rankings?: HorseRanking[]
          enrollments?: Record<string, number>
          bets?: Record<string, number>
          pool?: number
          currencyName?: string
          winners?: HorseRaceWinner[]
          winnerBettors?: string[]
          winnerHorseKey?: string | null
        }
      | undefined
    activeHorseRace.value = null
    if (!Array.isArray(x?.horses) || !Array.isArray(x?.rankings)) return
    const result: HorseRaceResult = {
      id: uid(),
      horses: x.horses,
      rankings: x.rankings,
      enrollments: x.enrollments ?? {},
      winners: x.winners ?? [],
      pool: x.pool ?? 0,
      currencyName: x.currencyName ?? '哈松币',
      winnerBettors: x.winnerBettors ?? [],
      winnerHorseKey: x.winnerHorseKey ?? null
    }
    activeHorseRaceResult.value = result
    // 有押中冠军的观众才庆祝（冷场不撒彩）
    if (result.winners.length > 0 || result.winnerBettors.length > 0) triggerCelebration()
    window.setTimeout(() => {
      if (activeHorseRaceResult.value?.id === result.id) activeHorseRaceResult.value = null
    }, HORSE_RESULT_MS)
  })
  on<OverlayPayload>('horserace.cancelled', () => {
    activeHorseRace.value = null
  })

  // 竞猜：start / tick / locked / result / cancelled
  on<OverlayPayload>('guessing.start', (msg) => {
    const x = msg.extra as
      | {
          title?: string
          options?: GuessingOpt[]
          endsAt?: number
          bets?: Record<string, number>
          pool?: number
          bettorCount?: number
          currencyName?: string
          defaultBet?: number
        }
      | undefined
    if (!x?.endsAt || !Array.isArray(x.options)) return
    activeGuessingResult.value = null
    activeGuessing.value = {
      phase: 'enrolling',
      title: x.title ?? '',
      options: x.options,
      bets: x.bets ?? {},
      pool: x.pool ?? 0,
      bettorCount: x.bettorCount ?? 0,
      currencyName: x.currencyName ?? '哈松币',
      defaultBet: x.defaultBet ?? 100,
      endsAt: x.endsAt
    }
    showIntro({
      icon: '🎲',
      title: '竞猜开始啦',
      subtitle: x.title ?? '弹幕押注',
      theme: 'amber'
    })
  })
  on<OverlayPayload>('guessing.tick', (msg) => {
    const x = msg.extra as
      | { bets?: Record<string, number>; pool?: number; bettorCount?: number }
      | undefined
    if (!activeGuessing.value || !x?.bets) return
    activeGuessing.value = {
      ...activeGuessing.value,
      bets: x.bets,
      pool: x.pool ?? activeGuessing.value.pool,
      bettorCount: x.bettorCount ?? activeGuessing.value.bettorCount
    }
  })
  on<OverlayPayload>('guessing.locked', (msg) => {
    const x = msg.extra as
      | {
          title?: string
          options?: GuessingOpt[]
          bets?: Record<string, number>
          pool?: number
          bettorCount?: number
        }
      | undefined
    if (!activeGuessing.value) return
    activeGuessing.value = {
      ...activeGuessing.value,
      phase: 'settling',
      title: x?.title ?? activeGuessing.value.title,
      options: x?.options ?? activeGuessing.value.options,
      bets: x?.bets ?? activeGuessing.value.bets,
      pool: x?.pool ?? activeGuessing.value.pool,
      bettorCount: x?.bettorCount ?? activeGuessing.value.bettorCount,
      endsAt: undefined
    }
  })
  on<OverlayPayload>('guessing.result', (msg) => {
    const x = msg.extra as
      | {
          title?: string
          options?: GuessingOpt[]
          winnerKey?: string
          winnerLabel?: string
          winners?: GuessingWinner[]
          pool?: number
          bets?: Record<string, number>
        }
      | undefined
    activeGuessing.value = null
    if (!x || !x.winnerKey) return
    const result: GuessingResult = {
      id: uid(),
      title: x.title ?? '',
      options: x.options ?? [],
      winnerKey: x.winnerKey,
      winnerLabel: x.winnerLabel ?? x.winnerKey,
      winners: x.winners ?? [],
      pool: x.pool ?? 0,
      bets: x.bets ?? {}
    }
    activeGuessingResult.value = result
    if (result.winners.length > 0) triggerCelebration()
    window.setTimeout(() => {
      if (activeGuessingResult.value?.id === result.id) activeGuessingResult.value = null
    }, GUESSING_RESULT_MS)
  })
  on<OverlayPayload>('guessing.cancelled', () => {
    activeGuessing.value = null
  })

  on<OverlayPayload>('song.board.update', (msg) => {
    const x = msg.extra as Partial<SongBoardState> | undefined
    if (!x) return
    songBoard.value = {
      enabled: Boolean(x.enabled),
      corner: typeof x.corner === 'string' ? x.corner : 'top-right',
      open: x.open !== false,
      keyword: typeof x.keyword === 'string' ? x.keyword : '点歌',
      cost: typeof x.cost === 'number' ? x.cost : 0,
      currencyName: typeof x.currencyName === 'string' ? x.currencyName : '哈松币',
      current: x.current ?? null,
      queue: Array.isArray(x.queue) ? x.queue : [],
      queueTotal: typeof x.queueTotal === 'number' ? x.queueTotal : 0
    }
  })

  on<OverlayPayload>('pet.dock.update', (msg) => {
    const x = msg.extra as { enabled?: boolean; dock?: PetDisplayItem[]; dockOffsetY?: number } | undefined
    petDockEnabled.value = Boolean(x?.enabled)
    petDockItems.value = Array.isArray(x?.dock) ? x.dock : []
    petDockOffsetY.value = typeof x?.dockOffsetY === 'number' ? x.dockOffsetY : 0
  })

  function showPetCard(title: string, item: PetDisplayItem, mode: PetCardItem['mode']): void {
    const card: PetCardItem = { id: uid(), title, item, mode }
    activePetCard.value = card
    window.setTimeout(() => {
      if (activePetCard.value?.id === card.id) activePetCard.value = null
    }, PET_CARD_VISIBLE_MS)
  }

  on<OverlayPayload>('pet.card', (msg) => {
    const x = msg.extra as { title?: string; item?: PetDisplayItem } | undefined
    if (!x?.item) return
    showPetCard(x.title ?? '宠物', x.item, 'normal')
  })

  on<OverlayPayload>('pet.level-up', (msg) => {
    const x = msg.extra as { item?: PetDisplayItem } | undefined
    if (!x?.item) return
    showPetCard('升级啦', x.item, 'level')
  })

  on<OverlayPayload>('pet.evolve', (msg) => {
    const x = msg.extra as { item?: PetDisplayItem } | undefined
    if (!x?.item) return
    showPetCard('进化啦', x.item, 'evolve')
    triggerCelebration()
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

  on<OverlayPayload>('overlay.theme', (msg) => {
    const x = msg.extra as { id?: string } | undefined
    overlayThemeId.value = normalizeOverlayThemeId(x?.id)
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
    pushToBoard(item)
  })

  // 自动重载：服务端每次进程启动有新 bootId。第一次记下，之后发现变了
  // （= app 重启 / 出了新版本）就刷新自己。配合 HTML no-store，
  // OBS 浏览器源 URL 固定不变也能自动拿到新包，不用再手动加 ?v=
  let seenBootId: string | null = null
  on<{ bootId?: string }>('overlay.hello', (m) => {
    const id = m?.bootId
    if (!id) return
    if (seenBootId === null) {
      seenBootId = id
      return
    }
    if (id !== seenBootId) window.location.reload()
  })

  // 主动拉一次板子配置：socket 在模块加载时就建连，可能早于上面 on() 注册完成，
  // 导致服务端「连上即推」的首发 config 丢失 → 开了板子却一直不显示。
  // 挂载后 + 每次（重）连上都请求一次，确保 enabled / 位置一定同步过来
  socket.emit('danmu.board.config:request')
  socket.on('connect', () => socket.emit('danmu.board.config:request'))
})
</script>

<template>
  <div class="overlay-root relative h-screen w-screen overflow-hidden" :class="`overlay-theme-${overlayThemeId}`">
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

    <!-- 屏幕中央货币余额查询卡 -->
    <div
      v-if="activeWalletCard"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <WalletCard
        :key="activeWalletCard.id"
        :uname="activeWalletCard.uname"
        :currency-name="activeWalletCard.currencyName"
        :initial-balance="activeWalletCard.initialBalance"
        :record="activeWalletCard.record"
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

    <!-- 庆祝飘彩（在结果卡之下，作为氛围层） -->
    <Celebration v-if="activeCelebration" :key="activeCelebration" />

    <!-- 开场招牌（屏幕中央，z-index 最高，2.4 秒自动消失） -->
    <div
      v-if="activeIntro"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
    >
      <IntroBanner
        :key="activeIntro.id"
        :icon="activeIntro.icon"
        :title="activeIntro.title"
        :subtitle="activeIntro.subtitle"
        :theme="activeIntro.theme"
      />
    </div>

    <!-- OBS 弹幕信息板（给观众看），enabled 时按 position 定位 -->
    <div v-if="danmuBoardConfig.enabled" class="absolute" :style="boardPosStyle">
      <DanmuBoard
        ref="danmuBoardRef"
        :max-lines="danmuBoardConfig.maxLines"
        :font-size="danmuBoardConfig.fontSize"
        :width="danmuBoardConfig.width"
        :max-height-pct="danmuBoardConfig.maxHeightPct"
        :preview-full="danmuBoardConfig.previewFull"
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

    <!-- 竞猜进行中 / 买定离手卡（屏幕中央偏上） -->
    <div
      v-if="activeGuessing"
      class="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2"
    >
      <GuessingCard
        :phase="activeGuessing.phase"
        :title="activeGuessing.title"
        :options="activeGuessing.options"
        :bets="activeGuessing.bets"
        :pool="activeGuessing.pool"
        :bettor-count="activeGuessing.bettorCount"
        :currency-name="activeGuessing.currencyName"
        :default-bet="activeGuessing.defaultBet"
        :ends-at="activeGuessing.endsAt"
      />
    </div>

    <!-- 竞猜结果卡（屏幕中央） -->
    <div
      v-if="activeGuessingResult"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <GuessingResultCard
        :key="activeGuessingResult.id"
        :title="activeGuessingResult.title"
        :options="activeGuessingResult.options"
        :winner-key="activeGuessingResult.winnerKey"
        :winner-label="activeGuessingResult.winnerLabel"
        :winners="activeGuessingResult.winners"
        :pool="activeGuessingResult.pool"
        :bets="activeGuessingResult.bets"
      />
    </div>

    <!-- 赛马进行中（报名 + 比赛同位置） -->
    <div
      v-if="activeHorseRace"
      class="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2"
    >
      <HorseRaceCard
        :phase="activeHorseRace.phase"
        :horses="activeHorseRace.horses"
        :enrollments="activeHorseRace.enrollments"
        :bets="activeHorseRace.bets"
        :pool="activeHorseRace.pool"
        :bettor-count="activeHorseRace.bettorCount"
        :currency-name="activeHorseRace.currencyName"
        :default-bet="activeHorseRace.defaultBet"
        :positions="activeHorseRace.positions"
        :ends-at="activeHorseRace.endsAt"
      />
    </div>

    <!-- 赛马结果卡（屏幕中央） -->
    <div
      v-if="activeHorseRaceResult"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <HorseRaceResultCard
        :key="activeHorseRaceResult.id"
        :horses="activeHorseRaceResult.horses"
        :rankings="activeHorseRaceResult.rankings"
        :enrollments="activeHorseRaceResult.enrollments"
        :winners="activeHorseRaceResult.winners"
        :pool="activeHorseRaceResult.pool"
        :currency-name="activeHorseRaceResult.currencyName"
        :winner-bettors="activeHorseRaceResult.winnerBettors"
        :winner-horse-key="activeHorseRaceResult.winnerHorseKey"
      />
    </div>

    <!-- 投票进行中卡片（屏幕中央偏上） -->
    <div
      v-if="activeVoting"
      class="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2"
    >
      <VotingCard
        :title="activeVoting.title"
        :options="activeVoting.options"
        :ends-at="activeVoting.endsAt"
        :counts="activeVoting.counts"
        :total-votes="activeVoting.totalVotes"
      />
    </div>

    <!-- 投票结果卡（屏幕中央） -->
    <div
      v-if="activeVotingResult"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
    >
      <VotingResultCard
        :key="activeVotingResult.id"
        :title="activeVotingResult.title"
        :options="activeVotingResult.options"
        :counts="activeVotingResult.counts"
        :total-votes="activeVotingResult.totalVotes"
        :winner-key="activeVotingResult.winnerKey"
      />
    </div>

    <!-- 常驻点歌板 -->
    <div v-if="songBoardVisible" class="absolute z-20" :class="songBoardPositionClass">
      <SongBoard
        :open="songBoard.open"
        :keyword="songBoard.keyword"
        :cost="songBoard.cost"
        :currency-name="songBoard.currencyName"
        :current="songBoard.current"
        :queue="songBoard.queue"
        :queue-total="songBoard.queueTotal"
      />
    </div>

    <!-- 底部常驻宠物栏 -->
    <div
      v-if="petDockEnabled && petDockItems.length > 0"
      class="absolute left-1/2 z-20 -translate-x-1/2"
      :style="{ bottom: petDockOffsetY + 'px' }"
    >
      <PetDock :items="petDockItems" />
    </div>

    <!-- 宠物事件卡片 -->
    <div
      v-if="activePetCard"
      class="absolute bottom-28 left-1/2 z-40 -translate-x-1/2"
    >
      <PetCard
        :key="activePetCard.id"
        :title="activePetCard.title"
        :item="activePetCard.item"
        :mode="activePetCard.mode"
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

.overlay-root {
  --ov-accent: #38bdf8;
  --ov-accent-2: #f59e0b;
  --ov-card-bg: rgba(15, 23, 42, 0.78);
  --ov-card-border: rgba(148, 163, 184, 0.28);
  --ov-text: #f8fafc;
  --ov-muted: #cbd5e1;
  --ov-glow: rgba(56, 189, 248, 0.28);
  --ov-radius: 18px;
  --ov-blur: 8px;
  --ov-font: 'Noto Sans SC', system-ui, sans-serif;
  font-family: var(--ov-font);
}

.overlay-theme-sakura {
  --ov-accent: #fb7185;
  --ov-accent-2: #f9a8d4;
  --ov-card-bg: rgba(76, 29, 60, 0.58);
  --ov-card-border: rgba(251, 207, 232, 0.55);
  --ov-text: #fff7ed;
  --ov-muted: #ffe4e6;
  --ov-glow: rgba(244, 114, 182, 0.34);
  --ov-radius: 24px;
}

.overlay-theme-candy {
  --ov-accent: #2dd4bf;
  --ov-accent-2: #f9a8d4;
  --ov-card-bg: rgba(20, 83, 88, 0.54);
  --ov-card-border: rgba(153, 246, 228, 0.46);
  --ov-text: #f0fdfa;
  --ov-muted: #ccfbf1;
  --ov-glow: rgba(45, 212, 191, 0.32);
  --ov-radius: 22px;
}

.overlay-theme-neon {
  --ov-accent: #a855f7;
  --ov-accent-2: #22d3ee;
  --ov-card-bg: rgba(24, 13, 49, 0.72);
  --ov-card-border: rgba(216, 180, 254, 0.5);
  --ov-text: #faf5ff;
  --ov-muted: #e9d5ff;
  --ov-glow: rgba(168, 85, 247, 0.42);
  --ov-radius: 14px;
}

.overlay-root .enter-banner {
  border: 1px solid var(--ov-card-border);
  border-radius: 999px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ov-accent), transparent 10%), color-mix(in srgb, var(--ov-accent-2), transparent 8%)) !important;
  color: var(--ov-text);
  box-shadow: 0 10px 34px var(--ov-glow);
  backdrop-filter: blur(var(--ov-blur));
}

.overlay-root .gift-card,
.overlay-root .hr-card,
.overlay-root .guess-card,
.overlay-root .guess-result,
.overlay-root .vote-card,
.overlay-root .vote-result,
.overlay-root .lottery-card,
.overlay-root .lottery-result,
.overlay-root .blindbox-card,
.overlay-root .wallet-card {
  border-color: var(--ov-card-border) !important;
  border-radius: var(--ov-radius) !important;
  background:
    radial-gradient(circle at 12% 8%, color-mix(in srgb, var(--ov-accent), transparent 64%), transparent 34%),
    linear-gradient(135deg, var(--ov-card-bg), rgba(15, 23, 42, 0.72)) !important;
  color: var(--ov-text) !important;
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.48), 0 0 34px var(--ov-glow) !important;
  backdrop-filter: blur(var(--ov-blur));
}

.overlay-root .pet-dock {
  border-color: var(--ov-card-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ov-accent), transparent 82%), var(--ov-card-bg));
  box-shadow: 0 -14px 46px var(--ov-glow);
}

.overlay-root .pet-card {
  --accent: var(--ov-accent);
}

.overlay-theme-sakura .intro-card {
  background: linear-gradient(135deg, #fb7185, #f9a8d4, #fda4af) !important;
  border-color: rgba(255, 228, 230, 0.78) !important;
  box-shadow: 0 0 82px rgba(244, 114, 182, 0.62), 0 24px 80px -10px rgba(0, 0, 0, 0.72) !important;
}

.overlay-theme-candy .intro-card {
  background: linear-gradient(135deg, #2dd4bf, #f9a8d4, #fde68a) !important;
  border-color: rgba(240, 253, 250, 0.78) !important;
}

.overlay-theme-neon .intro-card {
  background: linear-gradient(135deg, #581c87, #a855f7, #0891b2) !important;
  border-color: rgba(216, 180, 254, 0.78) !important;
}
</style>
