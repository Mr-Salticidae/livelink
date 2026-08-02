<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AiReplyPublicConfig } from '../types'

const config = ref<AiReplyPublicConfig | null>(null)
const apiKeyInput = ref('')
const saving = ref(false)
const testing = ref(false)
const error = ref<string | null>(null)
const testPrompt = ref('小助手，今天适合玩什么？')
const testReply = ref<string | null>(null)

onMounted(load)

async function load(): Promise<void> {
  try {
    config.value = await window.api.aiReplyConfigGet()
  } catch (err) {
    error.value = (err as Error)?.message ?? '读取 AI 回复配置失败'
  }
}

async function save(): Promise<void> {
  if (!config.value) return
  saving.value = true
  error.value = null
  try {
    const patch: Partial<AiReplyPublicConfig> & { apiKey?: string } = { ...config.value }
    if (apiKeyInput.value.trim()) patch.apiKey = apiKeyInput.value.trim()
    config.value = await window.api.aiReplyConfigPatch(patch)
    apiKeyInput.value = ''
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

async function test(): Promise<void> {
  testing.value = true
  error.value = null
  testReply.value = null
  try {
    await save()
    const result = await window.api.aiReplyTest(testPrompt.value)
    testReply.value = result.reply
  } catch (err) {
    error.value = (err as Error)?.message ?? '测试失败'
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
          @click="config.enabled = !config.enabled"
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
          <input
            v-model="apiKeyInput"
            type="password"
            placeholder="已保存则可留空"
            class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <span class="mt-1 block text-[11px]" :class="config.hasApiKey ? 'text-emerald-300' : 'text-amber-300'">
            {{ config.hasApiKey ? '已保存 Key；留空不会覆盖' : '还没有 Key，AI 回复不会运行' }}
          </span>
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
          :disabled="testing"
          class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >{{ testing ? '测试中…' : '保存并测试' }}</button>
        <button
          @click="save"
          :disabled="saving"
          class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >{{ saving ? '保存中…' : '保存' }}</button>
      </div>
      <div v-if="testReply" class="mt-3 rounded-lg bg-slate-950/60 px-3 py-2 text-sm text-emerald-200">
        {{ testReply }}
      </div>
    </section>
  </div>
</template>
