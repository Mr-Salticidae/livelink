<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { petState } from '../store'
import type { PetConfig, PetDisplayItem } from '../types'
import { PET_LEVEL_EXP, PET_SPECIES } from '../../shared/pets'

const config = ref<PetConfig>({ ...petState.value.config })
const topPets = ref<PetDisplayItem[]>([])
const saving = ref(false)
const error = ref<string | null>(null)
const currencyName = ref('哈松币')

onMounted(async () => {
  try {
    config.value = await window.api.petConfigGet()
    const g = await window.api.guessingGetConfig()
    currencyName.value = g.currencyName || '哈松币'
    await refreshTop()
  } catch (err) {
    error.value = (err as Error)?.message ?? '读取宠物配置失败'
  }
})

const enabledLabel = computed(() => (config.value.enabled ? '已显示' : '已隐藏'))

async function saveConfig(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    config.value = await window.api.petConfigPatch({ ...config.value })
    await refreshTop()
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

async function refreshTop(): Promise<void> {
  try {
    topPets.value = await window.api.petTop(20)
  } catch (err) {
    console.error('petTop failed', err)
  }
}

function expPct(item: PetDisplayItem): number {
  return Math.round((item.pet.exp / PET_LEVEL_EXP) * 100)
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">宠物</h1>
        <p class="mt-1 text-sm text-slate-400">
          观众用 {{ currencyName }} 领养、投喂，进房观看会让首选宠物慢慢升级进化。
        </p>
      </div>
      <button
        @click="refreshTop"
        class="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
      >刷新列表</button>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>

    <section class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-medium text-slate-200">OBS 底部宠物栏</h2>
            <p class="mt-1 text-xs text-slate-500">默认显示最近活跃且等级较高的首选宠物。</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="config.enabled" type="checkbox" />
            <span>{{ enabledLabel }}</span>
          </label>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="text-xs text-slate-400">
            展示数量（1-20）
            <input
              v-model.number="config.displayLimit"
              type="number"
              min="1"
              max="20"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            领养价格
            <input
              v-model.number="config.adoptionCost"
              type="number"
              min="0"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            默认投喂价格
            <input
              v-model.number="config.feedCost"
              type="number"
              min="1"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            每次投喂经验
            <input
              v-model.number="config.feedExp"
              type="number"
              min="1"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            每分钟观看经验
            <input
              v-model.number="config.watchExpPerMinute"
              type="number"
              min="0"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label class="text-xs text-slate-400">
            宠物栏位置（距底部像素）
            <div class="mt-1 flex items-center gap-2">
              <input
                v-model.number="config.dockOffsetY"
                type="range"
                min="0"
                max="400"
                step="10"
                class="flex-1"
              />
              <span class="w-10 text-right text-slate-300">{{ config.dockOffsetY ?? 0 }}px</span>
            </div>
          </label>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            @click="saveConfig"
            :disabled="saving"
            class="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >{{ saving ? '保存中…' : '保存配置' }}</button>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 class="text-sm font-medium text-slate-200">弹幕指令</h2>
        <div class="mt-3 space-y-2 text-sm text-slate-300">
          <div class="rounded-lg bg-slate-950/50 px-3 py-2"><code>领养宠物 1</code> · 领养芽芽灵</div>
          <div class="rounded-lg bg-slate-950/50 px-3 py-2"><code>投喂</code> 或 <code>投喂 500</code></div>
          <div class="rounded-lg bg-slate-950/50 px-3 py-2"><code>我的宠物</code> · 查看首选宠物</div>
          <div class="rounded-lg bg-slate-950/50 px-3 py-2"><code>切换宠物 2</code> · 切换首选</div>
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium text-slate-200">宠物图鉴</h2>
          <p class="mt-1 text-xs text-slate-500">每种宠物 3 阶，5 级和 12 级进化。</p>
        </div>
        <div class="text-xs text-slate-500">
          {{ petState.totalOwners }} 位主人 · {{ petState.totalPets }} 只宠物
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-3">
        <div
          v-for="species in PET_SPECIES"
          :key="species.id"
          class="rounded-xl border border-slate-800 bg-slate-950/50 p-4"
        >
          <div class="flex items-center justify-between">
            <div>
              <div class="text-base font-semibold text-slate-100">{{ species.name }}</div>
              <div class="mt-0.5 text-xs text-slate-500">{{ species.title }}</div>
            </div>
            <code class="rounded bg-slate-900 px-2 py-1 text-xs text-slate-300">{{ species.key }}</code>
          </div>
          <div class="mt-3 flex items-end justify-around rounded-lg bg-slate-900/50 px-2 py-3">
            <img
              v-for="stage in [1, 2, 3]"
              :key="stage"
              :src="species.assets[stage]"
              class="h-16 w-16 object-contain"
              :alt="species.stageNames[stage]"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 class="text-sm font-medium text-slate-200">当前展示队列</h2>
      <div v-if="topPets.length === 0" class="py-10 text-center text-sm text-slate-600">
        还没有观众领养宠物
      </div>
      <div v-else class="mt-4 grid gap-3 md:grid-cols-2">
        <div
          v-for="item in topPets"
          :key="item.ownerUid + item.pet.id"
          class="flex items-center gap-3 rounded-xl bg-slate-950/50 px-3 py-3"
        >
          <img :src="item.species.assets[item.pet.stage]" class="h-16 w-16 object-contain" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-sm font-medium text-slate-100">{{ item.pet.nickname }}</span>
              <span class="text-xs text-slate-400">Lv.{{ item.pet.level }}</span>
            </div>
            <div class="mt-0.5 truncate text-xs text-slate-500">
              {{ item.ownerName }} · {{ item.species.stageNames[item.pet.stage] }}
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded bg-slate-800">
              <div
                class="h-full rounded bg-emerald-400"
                :style="{ width: expPct(item) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
img {
  image-rendering: pixelated;
}
</style>
