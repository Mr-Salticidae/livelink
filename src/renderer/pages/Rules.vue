<script setup lang="ts">
import { computed, ref } from 'vue'
import { rules } from '../store'
import type { Rule, EventKind, RuleMatch } from '../types'

const TRIGGER_GROUPS: { kind: EventKind; label: string }[] = [
  { kind: 'viewer.enter', label: '进房欢迎' },
  { kind: 'danmu.received', label: '弹幕回复' },
  { kind: 'gift.received', label: '礼物感谢' },
  { kind: 'guard.bought', label: '上舰感谢' },
  { kind: 'super.chat', label: 'SuperChat' },
  { kind: 'follow.received', label: '关注感谢' },
  { kind: 'blindbox.opened', label: '盲盒开盒' }
]

const grouped = computed(() => {
  const map = new Map<EventKind, Rule[]>()
  for (const r of rules.value) {
    const arr = map.get(r.trigger) ?? []
    arr.push(r)
    map.set(r.trigger, arr)
  }
  return TRIGGER_GROUPS.map((g) => ({ ...g, rules: map.get(g.kind) ?? [] }))
})

const editing = ref<Record<string, Rule>>({})
const savingId = ref<string | null>(null)
const saveError = ref<string | null>(null)

function startEdit(rule: Rule): void {
  // 深拷贝，避免直接改 store 内引用
  editing.value[rule.id] = JSON.parse(JSON.stringify(rule))
}

function isEditing(id: string): boolean {
  return id in editing.value
}

function cancelEdit(id: string): void {
  delete editing.value[id]
}

async function save(id: string): Promise<void> {
  const rule = editing.value[id]
  if (!rule) return
  savingId.value = id
  saveError.value = null
  try {
    const list = await window.api.ruleUpsert(rule)
    rules.value = list
    delete editing.value[id]
  } catch (err) {
    saveError.value = (err as Error)?.message ?? '保存失败'
  } finally {
    savingId.value = null
  }
}

async function toggleEnabled(rule: Rule): Promise<void> {
  const next: Rule = { ...rule, enabled: !rule.enabled }
  try {
    const list = await window.api.ruleUpsert(next)
    rules.value = list
  } catch (err) {
    saveError.value = (err as Error)?.message ?? '切换失败'
  }
}

async function remove(id: string): Promise<void> {
  if (!confirm('确定要删除这条规则吗？')) return
  try {
    const list = await window.api.ruleDelete(id)
    rules.value = list
    delete editing.value[id]
  } catch (err) {
    saveError.value = (err as Error)?.message ?? '删除失败'
  }
}

function actionLabel(kind: string): string {
  if (kind === 'tts') return 'TTS'
  if (kind === 'overlay') return 'Overlay'
  if (kind === 'log') return '日志'
  if (kind === 'query_blindbox') return '盲盒查询'
  return kind
}

function matchSummary(rule: Rule): string {
  const m = rule.match
  if (m.kind === 'always') return '总是触发'
  if (m.kind === 'keyword') return `关键词（${m.mode === 'all' ? '全部命中' : '任一命中'}）：${m.keywords.join('、')}`
  if (m.kind === 'regex') return `正则：${m.pattern}`
  if (m.kind === 'fans_medal') {
    return `粉丝牌 ≥ ${m.minLevel} 级${m.requireAnchor ? '（仅本主播）' : ''}`
  }
  return ''
}

// 切换匹配方式时，把当前 match 重置成新 kind 的默认形态。
// 保留旧 keywords 文本到 keywordsText 让用户切回来时不丢——但跨 kind 重置 match 主体
function changeMatchKind(rule: Rule, kind: RuleMatch['kind']): void {
  if (kind === 'always') rule.match = { kind: 'always' }
  else if (kind === 'keyword')
    rule.match = { kind: 'keyword', keywords: [], mode: 'any' }
  else if (kind === 'regex') rule.match = { kind: 'regex', pattern: '' }
  else if (kind === 'fans_medal')
    rule.match = { kind: 'fans_medal', minLevel: 0, requireAnchor: true }
}

// keyword.keywords 在表单里用逗号 / 顿号分隔输入，转回数组存
function keywordsToText(rule: Rule): string {
  return rule.match.kind === 'keyword' ? rule.match.keywords.join('、') : ''
}
function setKeywordsFromText(rule: Rule, text: string): void {
  if (rule.match.kind !== 'keyword') return
  rule.match.keywords = text
    .split(/[、,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">规则</h1>
        <p class="mt-1 text-sm text-slate-400">改了立即生效。下次启动也记得。</p>
      </div>
    </header>

    <p
      v-if="saveError"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >
      {{ saveError }}
    </p>

    <section v-for="group in grouped" :key="group.kind" class="space-y-3">
      <h2 class="text-sm font-medium uppercase tracking-wide text-slate-500">
        {{ group.label }} <span class="text-slate-600">· {{ group.rules.length }} 条</span>
      </h2>

      <div v-if="group.rules.length === 0" class="rounded-lg border border-dashed border-slate-800 px-4 py-3 text-sm text-slate-600">
        没有规则
      </div>

      <article
        v-for="rule in group.rules"
        :key="rule.id"
        class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"
      >
        <header class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <button
                class="relative h-5 w-9 rounded-full transition"
                :class="rule.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
                @click="toggleEnabled(rule)"
              >
                <span
                  class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition"
                  :class="rule.enabled ? 'translate-x-4' : 'translate-x-0'"
                ></span>
              </button>
              <span class="font-medium">{{ rule.name }}</span>
              <span class="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{{ rule.id }}</span>
            </div>
            <div class="mt-1 text-xs text-slate-500">
              {{ matchSummary(rule) }} · 全局冷却 {{ rule.cooldownSec }}s · 同人冷却 {{ rule.perUserCooldownSec }}s
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="(a, i) in rule.actions"
                :key="i"
                class="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
              >{{ actionLabel(a.kind) }}<span v-if="a.template">: {{ a.template.text }}</span></span>
            </div>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              v-if="!isEditing(rule.id)"
              class="rounded bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
              @click="startEdit(rule)"
            >编辑</button>
            <button
              class="rounded bg-rose-600/80 px-3 py-1 text-xs text-white hover:bg-rose-500"
              @click="remove(rule.id)"
            >删除</button>
          </div>
        </header>

        <!-- 编辑面板 -->
        <div v-if="isEditing(rule.id)" class="mt-4 space-y-3 border-t border-slate-800 pt-4">
          <div class="grid grid-cols-2 gap-3">
            <label class="text-xs text-slate-400">
              全局冷却（秒）
              <input
                v-model.number="editing[rule.id].cooldownSec"
                type="number" min="0"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              />
            </label>
            <label class="text-xs text-slate-400">
              同人冷却（秒）
              <input
                v-model.number="editing[rule.id].perUserCooldownSec"
                type="number" min="0"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              />
            </label>
          </div>

          <!-- 匹配方式 -->
          <div class="rounded border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <label class="text-xs text-slate-400">
              匹配方式
              <select
                :value="editing[rule.id].match.kind"
                @change="changeMatchKind(editing[rule.id], ($event.target as HTMLSelectElement).value as RuleMatch['kind'])"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
              >
                <option value="always">总是触发</option>
                <option value="keyword">关键词</option>
                <option value="regex">正则</option>
                <option value="fans_medal">粉丝牌等级</option>
              </select>
            </label>

            <!-- always: 无需配置 -->
            <p v-if="editing[rule.id].match.kind === 'always'" class="text-xs text-slate-500">
              每次事件都触发（适合"所有人进房都欢迎"这种规则）
            </p>

            <!-- keyword -->
            <template v-if="editing[rule.id].match.kind === 'keyword'">
              <label class="block text-xs text-slate-400">
                关键词（顿号 / 逗号 / 空格分隔）
                <input
                  :value="keywordsToText(editing[rule.id])"
                  @input="setKeywordsFromText(editing[rule.id], ($event.target as HTMLInputElement).value)"
                  type="text"
                  placeholder="你好、哈喽、hi"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
              </label>
              <label class="block text-xs text-slate-400">
                匹配模式
                <select
                  v-model="(editing[rule.id].match as Extract<RuleMatch, { kind: 'keyword' }>).mode"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                >
                  <option value="any">任一关键词命中</option>
                  <option value="all">全部关键词命中</option>
                </select>
              </label>
            </template>

            <!-- regex -->
            <template v-if="editing[rule.id].match.kind === 'regex'">
              <label class="block text-xs text-slate-400">
                正则表达式
                <input
                  v-model="(editing[rule.id].match as Extract<RuleMatch, { kind: 'regex' }>).pattern"
                  type="text"
                  placeholder="例如 ^(求|想)分享"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 font-mono"
                />
              </label>
            </template>

            <!-- fans_medal -->
            <template v-if="editing[rule.id].match.kind === 'fans_medal'">
              <label class="block text-xs text-slate-400">
                最低粉丝牌等级（0-40）
                <input
                  v-model.number="(editing[rule.id].match as Extract<RuleMatch, { kind: 'fans_medal' }>).minLevel"
                  type="number" min="0" max="40"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
              </label>
              <label class="flex items-center gap-2 text-xs text-slate-400">
                <input
                  v-model="(editing[rule.id].match as Extract<RuleMatch, { kind: 'fans_medal' }>).requireAnchor"
                  type="checkbox"
                  class="rounded border-slate-700 bg-slate-950"
                />
                必须是本主播的粉丝牌
              </label>
              <p v-if="rule.trigger === 'viewer.enter'" class="text-[11px] text-amber-300/80">
                注意：B 站协议层进房事件常不带粉丝牌信息，本规则在送过礼物 / 发过弹幕的老粉进房时才能命中
              </p>
            </template>
          </div>

          <div
            v-for="(action, idx) in editing[rule.id].actions"
            :key="idx"
            class="rounded border border-slate-800 bg-slate-950/60 p-3"
          >
            <div class="mb-1 text-xs text-slate-400">
              {{ actionLabel(action.kind) }} 模板
              <span class="text-slate-600">（占位符 {uname} {giftName} {num} {content} 等）</span>
            </div>
            <textarea
              v-if="action.template"
              v-model="action.template.text"
              rows="2"
              class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 font-mono"
            />
            <div v-else class="text-xs text-slate-600">此动作无模板（{{ action.kind }}）</div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="rounded bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
              @click="cancelEdit(rule.id)"
            >取消</button>
            <button
              class="rounded bg-sky-500 px-4 py-1 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              :disabled="savingId === rule.id"
              @click="save(rule.id)"
            >{{ savingId === rule.id ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
