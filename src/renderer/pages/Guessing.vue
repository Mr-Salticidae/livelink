<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { guessingState, isConnected } from '../store'
import type { GuessingGlobalConfig, GuessingPreset, GuessingOption, WalletEntry } from '../types'

// 加载状态
const globalCfg = ref<GuessingGlobalConfig>({
  currencyName: '哈松币',
  initialBalance: 1000,
  presets: []
})
const activePresetId = ref<string>('')
const submitting = ref(false)
const error = ref<string | null>(null)

// 当前编辑中的 preset 副本（保存时回写到 globalCfg.presets）
const editing = ref<GuessingPreset | null>(null)

const tick = ref(Date.now())
let tickTimer: number | null = null

onMounted(async () => {
  try {
    globalCfg.value = await window.api.guessingGetConfig()
    if (globalCfg.value.presets.length > 0) {
      selectPreset(globalCfg.value.presets[0].id)
    }
  } catch (err) {
    console.error('guessingGetConfig failed', err)
  }
  tickTimer = window.setInterval(() => (tick.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer)
})

function selectPreset(id: string): void {
  const p = globalCfg.value.presets.find((x) => x.id === id)
  if (!p) return
  activePresetId.value = id
  editing.value = JSON.parse(JSON.stringify(p)) // 深拷贝可编辑
}

function addPreset(): void {
  const newPreset: GuessingPreset = {
    id: `preset-${Date.now()}`,
    name: '新竞猜',
    title: '猜什么',
    options: [
      { key: '1', label: '选项 A' },
      { key: '2', label: '选项 B' }
    ],
    enrollSec: 120,
    defaultBet: 100,
    requireAnchorFansMedal: false,
    minFansMedalLevel: 0
  }
  globalCfg.value.presets.push(newPreset)
  selectPreset(newPreset.id)
  persistConfig()
}

async function deletePreset(id: string): Promise<void> {
  if (globalCfg.value.presets.length <= 1) {
    error.value = '至少保留 1 个 preset'
    return
  }
  if (!confirm('确定删除这个竞猜模板吗？')) return
  globalCfg.value.presets = globalCfg.value.presets.filter((p) => p.id !== id)
  if (globalCfg.value.presets.length > 0) {
    selectPreset(globalCfg.value.presets[0].id)
  }
  await persistConfig()
}

function addOption(): void {
  if (!editing.value) return
  if (editing.value.options.length >= 8) {
    error.value = '最多 8 个选项'
    return
  }
  const used = new Set(editing.value.options.map((o) => o.key))
  const candidates = ['1', '2', '3', '4', '5', '6', '7', '8']
  const key = candidates.find((c) => !used.has(c)) ?? String(editing.value.options.length + 1)
  editing.value.options.push({ key, label: '' })
  error.value = null
}
function removeOption(idx: number): void {
  if (!editing.value) return
  if (editing.value.options.length <= 2) {
    error.value = '至少 2 个选项'
    return
  }
  editing.value.options.splice(idx, 1)
  error.value = null
}

async function saveEditing(): Promise<void> {
  if (!editing.value) return
  const idx = globalCfg.value.presets.findIndex((p) => p.id === editing.value!.id)
  if (idx < 0) return
  globalCfg.value.presets[idx] = JSON.parse(JSON.stringify(editing.value))
  await persistConfig()
}

async function persistConfig(): Promise<void> {
  try {
    globalCfg.value = await window.api.guessingPatchConfig(JSON.parse(JSON.stringify(globalCfg.value)))
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存配置失败'
  }
}

async function startGuessing(): Promise<void> {
  if (!editing.value) return
  error.value = null
  if (!isConnected.value) {
    error.value = '直播间未连接，去首页连上'
    return
  }
  // 保存当前 preset 修改作为下次默认
  await saveEditing()
  submitting.value = true
  try {
    const cfg = {
      title: editing.value.title,
      options: editing.value.options,
      enrollSec: editing.value.enrollSec,
      defaultBet: editing.value.defaultBet,
      requireAnchorFansMedal: editing.value.requireAnchorFansMedal,
      minFansMedalLevel: editing.value.minFansMedalLevel
    }
    await window.api.guessingStart(JSON.parse(JSON.stringify(cfg)))
  } catch (err) {
    error.value = (err as Error)?.message ?? '启动失败'
  } finally {
    submitting.value = false
  }
}

async function lockNow(): Promise<void> {
  try { await window.api.guessingLockNow() } catch (err) { error.value = (err as Error)?.message ?? '操作失败' }
}
async function cancelGuessing(): Promise<void> {
  if (!confirm('取消竞猜会退还所有押注的哈松币。确认？')) return
  try { await window.api.guessingCancel() } catch (err) { error.value = (err as Error)?.message ?? '取消失败' }
}
async function settleBy(winnerKey: string): Promise<void> {
  if (!confirm(`确认 "${winnerKey}" 为赢家结算？此操作不可撤销。`)) return
  try { await window.api.guessingSettle(winnerKey) } catch (err) { error.value = (err as Error)?.message ?? '结算失败' }
}
async function resetGuessing(): Promise<void> {
  await window.api.guessingReset()
}

// 全局货币 / 初始余额改名 / 改额
async function updateCurrencyName(name: string): Promise<void> {
  globalCfg.value.currencyName = name.trim() || '哈松币'
  await persistConfig()
}
async function updateInitialBalance(n: number): Promise<void> {
  if (!Number.isFinite(n) || n < 0) return
  globalCfg.value.initialBalance = Math.round(n)
  await persistConfig()
}

// 钱包排行榜
const topBalance = ref<WalletEntry[]>([])
async function refreshTopBalance(): Promise<void> {
  try {
    topBalance.value = await window.api.guessingTopBalance(10)
  } catch {
    topBalance.value = []
  }
}
onMounted(() => refreshTopBalance())

const isIdle = computed(() => guessingState.value.phase === 'idle')
const isEnrolling = computed(() => guessingState.value.phase === 'enrolling')
const isSettling = computed(() => guessingState.value.phase === 'settling')
const isDone = computed(() => guessingState.value.phase === 'done')

const remainingSec = computed(() => {
  if (guessingState.value.phase !== 'enrolling') return 0
  return Math.max(0, Math.ceil((guessingState.value.endsAt - tick.value) / 1000))
})

function betOf(opt: GuessingOption): number {
  const s = guessingState.value
  if (s.phase === 'idle') return 0
  return s.bets[opt.key] ?? 0
}
function percent(opt: GuessingOption): number {
  const s = guessingState.value
  if (s.phase === 'idle' || s.pool === 0) return 0
  return Math.round((betOf(opt) / s.pool) * 100)
}

// done 阶段赢家标签（template 里联合类型 narrowing 不便，提到 script）
const winnerLabel = computed(() => {
  const s = guessingState.value
  if (s.phase !== 'done') return ''
  return s.config.options.find((o) => o.key === s.winnerKey)?.label ?? s.winnerKey
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">竞猜</h1>
      <p class="mt-1 text-sm text-slate-400">
        观众用<strong class="text-amber-300">{{ globalCfg.currencyName }}</strong>押注 → 买定离手 → 主播手动结算赢家 → 押中按金额比例瓜分总池
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <!-- 全局货币设置 -->
    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
      <h2 class="text-xs uppercase tracking-wide text-slate-500">全局货币设置</h2>
      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-slate-400">
          货币名称
          <input
            :value="globalCfg.currencyName"
            @change="updateCurrencyName(($event.target as HTMLInputElement).value)"
            type="text"
            maxlength="10"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          新观众初始余额
          <input
            :value="globalCfg.initialBalance"
            @change="updateInitialBalance(Number(($event.target as HTMLInputElement).value))"
            type="number" min="0"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>
    </section>

    <!-- idle: preset 选择 + 配置 -->
    <section
      v-if="isIdle && editing"
      class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
    >
      <!-- preset 切换 -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs uppercase tracking-wide text-slate-500">竞猜模板</h2>
          <button @click="addPreset" class="text-xs text-sky-400 hover:underline">+ 新模板</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in globalCfg.presets"
            :key="p.id"
            @click="selectPreset(p.id)"
            class="group rounded border px-3 py-1 text-xs transition relative"
            :class="
              activePresetId === p.id
                ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'
            "
          >
            {{ p.name }}
            <span
              v-if="globalCfg.presets.length > 1 && activePresetId === p.id"
              @click.stop="deletePreset(p.id)"
              class="ml-1.5 text-rose-400 hover:text-rose-300"
              title="删除模板"
            >×</span>
          </button>
        </div>
      </div>

      <!-- 模板编辑 -->
      <div class="space-y-3">
        <label class="block text-xs text-slate-400">
          模板名（侧栏显示）
          <input
            v-model="editing.name"
            @change="saveEditing"
            type="text" maxlength="20"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label class="block text-xs text-slate-400">
          Overlay 标题（"{{ editing.title }}"）
          <input
            v-model="editing.title"
            @change="saveEditing"
            type="text" maxlength="60"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>

        <div>
          <div class="flex items-center justify-between">
            <label class="text-xs text-slate-400">选项（2-8 个）</label>
            <button
              v-if="editing.options.length < 8"
              @click="addOption"
              class="text-xs text-sky-400 hover:underline"
            >+ 添加</button>
          </div>
          <div
            v-for="(opt, idx) in editing.options"
            :key="idx"
            class="mt-1.5 flex items-center gap-2"
          >
            <input
              v-model="opt.key"
              @change="saveEditing"
              type="text"
              maxlength="8"
              placeholder="key"
              class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 text-center font-mono"
            />
            <input
              v-model="opt.label"
              @change="saveEditing"
              type="text"
              maxlength="30"
              placeholder="选项名"
              class="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
            <button
              @click="removeOption(idx)"
              :disabled="editing.options.length <= 2"
              class="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-rose-600/60 disabled:opacity-30"
            >×</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs text-slate-400">
            押注时长（10-600 秒）
            <input
              v-model.number="editing.enrollSec"
              @change="saveEditing"
              type="number" min="10" max="600"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            默认押注金额（弹幕只发 key 时用）
            <input
              v-model.number="editing.defaultBet"
              @change="saveEditing"
              type="number" min="1"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>

        <div class="space-y-2 rounded-lg bg-slate-950/40 p-3">
          <label class="flex items-center gap-2 text-xs text-slate-300">
            <input
              v-model="editing.requireAnchorFansMedal"
              @change="saveEditing"
              type="checkbox"
            />
            <span>仅本主播粉丝牌可押注</span>
          </label>
          <label class="block text-xs text-slate-400">
            最低粉丝牌等级（0 = 不限）
            <input
              v-model.number="editing.minFansMedalLevel"
              @change="saveEditing"
              type="number" min="0" max="40"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
        </div>

        <div class="flex justify-end">
          <button
            @click="startGuessing"
            :disabled="submitting"
            class="rounded-lg bg-amber-500 px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
          >{{ submitting ? '启动中…' : '🎲 开始竞猜' }}</button>
        </div>
      </div>

      <!-- 弹幕格式说明 -->
      <div class="rounded-lg bg-slate-950/40 p-3 text-xs text-slate-400 space-y-1">
        <div class="text-slate-300 font-medium">观众怎么押注？</div>
        <div>· 发选项 key（例 <code class="text-amber-300">1</code>）→ 押 {{ editing.defaultBet }} {{ globalCfg.currencyName }}</div>
        <div>· 发 <code class="text-amber-300">key 金额</code>（例 <code class="text-amber-300">1 500</code>）→ 押指定金额</div>
        <div>· 改选项 = 退还前面的，押新的</div>
        <div>· 同选项追加 = 累加</div>
        <div>· 新观众自动开户赠送 {{ globalCfg.initialBalance }} {{ globalCfg.currencyName }}</div>
      </div>
    </section>

    <!-- enrolling: 押注进行中 -->
    <section
      v-if="isEnrolling && guessingState.phase === 'enrolling'"
      class="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-medium text-amber-200">🎲 押注进行中</h2>
          <div class="mt-1 text-base text-slate-200 truncate">{{ guessingState.config.title }}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-3xl font-bold text-amber-300 tabular-nums">{{ remainingSec }}s</div>
          <div class="text-xs text-slate-500 mt-0.5">
            池 <strong class="text-slate-200">{{ guessingState.pool }}</strong> {{ globalCfg.currencyName }} · {{ guessingState.bettorCount }} 人
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <div v-for="opt in guessingState.config.options" :key="opt.key" class="space-y-1">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-300">
              <code class="bg-slate-950 px-1.5 py-0.5 rounded mr-1.5">{{ opt.key }}</code>
              {{ opt.label }}
            </span>
            <span class="text-slate-400 tabular-nums">{{ betOf(opt) }} · {{ percent(opt) }}%</span>
          </div>
          <div class="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
              :style="{ width: percent(opt) + '%' }"
            ></div>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button @click="cancelGuessing" class="rounded bg-slate-700 px-4 py-1.5 text-xs text-slate-100 hover:bg-slate-600">取消（退款）</button>
        <button @click="lockNow" class="rounded bg-amber-500 px-4 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-400">买定离手</button>
      </div>
    </section>

    <!-- settling: 等主播选赢家 -->
    <section
      v-if="isSettling && guessingState.phase === 'settling'"
      class="rounded-2xl border border-sky-500/40 bg-sky-500/5 p-5 space-y-4"
    >
      <div>
        <h2 class="text-sm font-medium text-sky-200">⏳ 买定离手 · 等待结算</h2>
        <div class="mt-1 text-base text-slate-200">{{ guessingState.config.title }}</div>
        <div class="mt-1 text-xs text-slate-400">
          池 <strong>{{ guessingState.pool }}</strong> {{ globalCfg.currencyName }} ·
          {{ guessingState.bettorCount }} 人押注
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-slate-400">选择今天的赢家（不可撤销）：</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="opt in guessingState.config.options"
            :key="opt.key"
            @click="settleBy(opt.key)"
            class="rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-left hover:border-emerald-500 hover:bg-emerald-500/10 transition"
          >
            <div class="text-sm font-medium text-slate-200">
              <code class="bg-slate-800 px-1.5 py-0.5 rounded mr-1.5 text-amber-300">{{ opt.key }}</code>
              {{ opt.label }}
            </div>
            <div class="mt-1 text-xs text-slate-500">
              押 {{ betOf(opt) }} {{ globalCfg.currencyName }} · {{ percent(opt) }}%
            </div>
          </button>
        </div>
      </div>

      <div class="flex justify-end">
        <button @click="cancelGuessing" class="rounded bg-slate-700 px-4 py-1.5 text-xs text-slate-100 hover:bg-slate-600">取消（退款）</button>
      </div>
    </section>

    <!-- done: 结算结果 -->
    <section
      v-if="isDone && guessingState.phase === 'done'"
      class="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium text-emerald-200">🎉 结算结果</h2>
          <div class="mt-1 text-base text-slate-200">{{ guessingState.config.title }}</div>
          <div class="mt-1 text-xs text-slate-400">
            赢家：<strong class="text-emerald-300">{{ winnerLabel }}</strong>
            · 池 {{ guessingState.pool }} {{ globalCfg.currencyName }}
          </div>
        </div>
        <button @click="resetGuessing" class="shrink-0 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">关闭，开新一轮</button>
      </div>

      <div v-if="guessingState.winners.length === 0" class="rounded-lg bg-slate-950/40 p-4 text-center text-sm text-slate-500">
        没人押中赢家，{{ guessingState.pool }} {{ globalCfg.currencyName }} 流失（庄家通吃）
      </div>
      <div v-else class="space-y-1.5">
        <div class="text-xs text-slate-400">押中赢家的观众（按金额比例分配总池）：</div>
        <div
          v-for="(w, i) in guessingState.winners"
          :key="i"
          class="flex items-center justify-between rounded-lg bg-slate-950/40 px-3 py-2"
        >
          <span class="text-sm text-slate-200">{{ w.uname }}</span>
          <span class="text-xs text-slate-400 tabular-nums">
            押 {{ w.bet }} → 拿 <strong class="text-emerald-300">{{ w.payout }}</strong> {{ globalCfg.currencyName }}
          </span>
        </div>
      </div>
    </section>

    <!-- 钱包排行榜 -->
    <section v-if="topBalance.length > 0" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs uppercase tracking-wide text-slate-500">{{ globalCfg.currencyName }} 排行（TOP 10）</h2>
        <button @click="refreshTopBalance" class="text-xs text-sky-400 hover:underline">刷新</button>
      </div>
      <div class="space-y-1">
        <div
          v-for="(w, i) in topBalance"
          :key="i"
          class="flex items-center justify-between rounded bg-slate-950/40 px-3 py-1.5 text-xs"
        >
          <span class="text-slate-200">
            <span class="text-slate-500 mr-2">#{{ i + 1 }}</span>{{ w.uname }}
          </span>
          <span class="text-amber-300 tabular-nums font-mono">{{ w.balance }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
