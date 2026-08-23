<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { normalizeApiKey } from '../../shared/ai-reply'
import type { AiReplyPublicConfig } from '../types'

const config = ref<AiReplyPublicConfig | null>(null)
const apiKeyInput = ref('')
const showKey = ref(false)
const saving = ref(false)
const testing = ref(false)
const error = ref<string | null>(null)
const toast = ref<string | null>(null)
const testPrompt = ref('小助手，今天适合玩什么？')
const testReply = ref<string | null>(null)

// 框里有字 = 有一份还没落盘的 Key。光填在框里不算数，得提醒主播去点保存
const pendingKey = computed(() => normalizeApiKey(apiKeyInput.value).length > 0)

onMounted(load)

// IPC 抛回来的错误长这样：
//   Error invoking remote method 'ai-reply:test': Error: 真正的原因
// 前半截是 Electron 的包装，对主播毫无意义还吓人，剥掉只留真正的原因。
function friendlyMessage(err: unknown, fallback: string): string {
  const raw = (err as Error)?.message ?? String(err ?? '')
  const stripped = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error|TypeError):\s*/, '')
    .trim()
  return stripped || fallback
}

function clearNotices(): void {
  error.value = null
  toast.value = null
}

async function load(): Promise<void> {
  try {
    config.value = await window.api.aiReplyConfigGet()
  } catch (err) {
    error.value = friendlyMessage(err, '读取 AI 回复配置失败')
  }
}

// 返回"是否真的保存成功"。以前这里把异常吞掉就算完，
// 于是「保存并测试」在保存失败之后照样往下测，测出来一句"请先填写 API Key"，
// 把真正的失败原因盖掉了 —— 主播看到的就是"我明明填了 Key，它还说我没填"。
async function save(): Promise<boolean> {
  if (!config.value) return false
  saving.value = true
  clearNotices()
  const key = normalizeApiKey(apiKeyInput.value)
  try {
    const patch: Partial<AiReplyPublicConfig> & { apiKey?: string } = { ...config.value }
    // 输入框留空 = 不动已保存的 Key（主播改冷却、人格时不用把 Key 再粘一遍）
    if (key) patch.apiKey = key
    config.value = await window.api.aiReplyConfigPatch(patch)
    // 主进程写配置失败会抛错；万一哪天不抛，这里再兜一道，
    // 绝不让"没存上"冒充"保存成功"
    if (key && !config.value.hasApiKey) {
      throw new Error('Key 没能写进配置文件，看看杀毒软件是不是锁住了 LiveLink 的配置。')
    }
    apiKeyInput.value = ''
    return true
  } catch (err) {
    error.value = friendlyMessage(err, '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

async function saveKey(): Promise<void> {
  if (!pendingKey.value && !config.value?.hasApiKey) {
    error.value = '先把 DeepSeek API Key 粘到输入框里，再点保存。'
    return
  }
  if (!(await save())) return
  toast.value = config.value?.hasApiKey ? `已保存：${config.value.apiKeyHint}` : '已保存'
  setTimeout(() => (toast.value = null), 4000)
}

// 底部的"保存"：Key 可以留空（改冷却 / 人格时不必重填），但保存成功一定给回执，
// 免得主播不知道自己到底存没存上
async function saveAll(): Promise<void> {
  if (!(await save())) return
  toast.value = config.value?.hasApiKey ? `已保存（Key：${config.value.apiKeyHint}）` : '已保存'
  setTimeout(() => (toast.value = null), 4000)
}

// 开关是一下点完的动作，跟弹幕朗读页一样当场存盘 —— 别让主播以为
// "我明明打开了"，其实只是界面上绿了一下，重启就没了
async function toggleEnabled(): Promise<void> {
  if (!config.value) return
  config.value.enabled = !config.value.enabled
  if (!(await save())) {
    // 没存上就把开关弹回去，界面不许撒谎
    if (config.value) config.value.enabled = !config.value.enabled
  }
}

async function clearKey(): Promise<void> {
  if (!config.value) return
  saving.value = true
  clearNotices()
  try {
    // 显式传空串才是"清除"，与"留空不覆盖"区分开
    config.value = await window.api.aiReplyConfigPatch({ apiKey: '' })
    apiKeyInput.value = ''
    toast.value = '已清除保存的 Key，AI 回复不会再调用 API'
    setTimeout(() => (toast.value = null), 4000)
  } catch (err) {
    error.value = friendlyMessage(err, '清除失败')
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  testing.value = true
  clearNotices()
  testReply.value = null
  try {
    // 保存没成功就别往下测了：屏幕上要留住真正的失败原因
    if (!(await save())) return
    if (!config.value?.hasApiKey) {
      error.value = '还没有 DeepSeek API Key：把 Key 粘进上面的输入框，点「保存 Key」之后再测试。'
      return
    }
    const result = await window.api.aiReplyTest(testPrompt.value)
    testReply.value = result.reply
  } catch (err) {
    error.value = friendlyMessage(err, '测试失败')
  } finally {
    testing.value = false
  }
}

function keywordsText(): string {
  return config.value?.keywords.join('、') ?? ''
}

function setKeywords(text: string): void {
  if (!config.value) return
  config.value.keywords = text
    .split(/[、,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
</script>

<template>
  <div v-if="config" class="mx-auto max-w-4xl space-y-6">
    <header>
      <p class="ll-eyebrow-accent mb-1.5">ASSISTANT</p>
      <h1 class="ll-title text-[26px]">AI 智能回复</h1>
      <p class="mt-1 text-sm text-slate-400">
        使用主播自己的 DeepSeek API Key。默认关闭；未填写 Key 时不会产生任何 API 调用或费用。
      </p>
    </header>

    <p
      v-if="error"
      class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
    >{{ error }}</p>
    <p
      v-else-if="toast"
      class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
    >{{ toast }}</p>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="font-medium">启用 AI 回复</div>
          <div class="mt-1 text-xs text-slate-500">
            当前状态：{{ config.enabled && config.hasApiKey ? '会调用 DeepSeek' : '不会调用 API' }}
          </div>
        </div>
        <button
          class="relative h-6 w-11 rounded-full transition"
          :class="config.enabled ? 'bg-emerald-500' : 'bg-slate-600'"
          :disabled="saving"
          @click="toggleEnabled"
        >
          <span
            class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition"
            :class="config.enabled ? 'translate-x-5' : 'translate-x-0'"
          ></span>
        </button>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <label class="text-xs text-slate-400">
          DeepSeek API Key
          <div class="mt-1 flex gap-2">
            <input
              v-model="apiKeyInput"
              :type="showKey ? 'text' : 'password'"
              placeholder="sk- 开头，粘贴后要点右边的「保存 Key」"
              class="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              @input="clearNotices"
              @keyup.enter="saveKey"
            />
            <button
              class="shrink-0 rounded border border-slate-700 px-2 py-2 text-xs text-slate-300 hover:bg-slate-800"
              @click="showKey = !showKey"
            >{{ showKey ? '隐藏' : '显示' }}</button>
            <button
              :disabled="saving"
              class="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              @click="saveKey"
            >{{ saving ? '保存中…' : '保存 Key' }}</button>
          </div>
          <span
            class="mt-1 block text-[11px]"
            :class="config.hasApiKey ? 'text-emerald-300' : 'text-amber-300'"
          >
            {{
              config.hasApiKey
                ? `已保存 Key：${config.apiKeyHint}（输入框留空不会覆盖它）`
                : '还没有 Key，AI 回复不会运行'
            }}
          </span>
          <span v-if="pendingKey" class="mt-1 block text-[11px] text-amber-300">
            输入框里这串还没保存 —— 点一下「保存 Key」才会写进配置。
          </span>
          <button
            v-if="config.hasApiKey"
            class="mt-1 text-[11px] text-slate-500 underline hover:text-slate-300"
            @click="clearKey"
          >清除已保存的 Key</button>
        </label>

        <label class="text-xs text-slate-400">
          模型
          <select
            v-model="config.model"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            <option value="deepseek-chat">deepseek-chat</option>
            <option value="deepseek-reasoner">deepseek-reasoner</option>
          </select>
        </label>
      </div>

      <div class="mt-3 rounded-lg bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-400">
        主播朋友不会设置也没关系：保持关闭或不填 Key 即可，LiveLink 不会替你调用 API。
        需要使用时，让主播去 DeepSeek 开放平台创建自己的 API Key，再粘贴到这里保存。
      </div>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 class="text-sm font-medium text-slate-200">触发方式</h2>
      <div class="mt-4 grid gap-3 md:grid-cols-3">
        <label class="text-xs text-slate-400">
          模式
          <select
            v-model="config.triggerMode"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            <option value="mention">点名触发</option>
            <option value="keyword">关键词触发</option>
            <option value="all">所有弹幕</option>
          </select>
        </label>
        <label class="text-xs text-slate-400">
          点名词
          <input
            v-model="config.mentionName"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </label>
        <label class="text-xs text-slate-400">
          关键词
          <input
            :value="keywordsText()"
            @input="setKeywords(($event.target as HTMLInputElement).value)"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-4">
        <label class="text-xs text-slate-400">
          全局冷却秒
          <input v-model.number="config.cooldownSec" type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label class="text-xs text-slate-400">
          单人冷却秒
          <input v-model.number="config.perUserCooldownSec" type="number" min="0" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label class="text-xs text-slate-400">
          输入上限
          <input v-model.number="config.maxInputLength" type="number" min="20" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label class="text-xs text-slate-400">
          回复上限
          <input v-model.number="config.maxReplyLength" type="number" min="20" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
        </label>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 class="text-sm font-medium text-slate-200">回复人格</h2>
      <textarea
        v-model="config.systemPrompt"
        rows="5"
        class="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
      ></textarea>
      <div class="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <label class="flex items-center gap-2"><input v-model="config.speakReply" type="checkbox" /> 用 TTS 念出回复</label>
        <label class="flex items-center gap-2"><input v-model="config.logReply" type="checkbox" /> 写入日志</label>
      </div>
    </section>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 class="text-sm font-medium text-slate-200">保存与测试</h2>
      <div class="mt-3 flex gap-2">
        <input
          v-model="testPrompt"
          class="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <button
          @click="test"
          :disabled="testing || saving"
          class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >{{ testing ? '测试中…' : '保存并测试' }}</button>
        <button
          @click="saveAll"
          :disabled="saving || testing"
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >{{ saving ? '保存中…' : '保存' }}</button>
      </div>
      <div v-if="testReply" class="mt-3 rounded-lg bg-slate-950/60 px-3 py-2 text-sm text-emerald-200">
        {{ testReply }}
      </div>
    </section>
  </div>
</template>
