<script setup lang="ts">
import { ref, watch } from 'vue'
import { bilibiliAuth } from '../store'

const expanded = ref(false)
const local = ref({
  sessdata: bilibiliAuth.value.sessdata,
  uid: bilibiliAuth.value.uid,
  buvid: bilibiliAuth.value.buvid
})
const saving = ref(false)
const toast = ref<string | null>(null)
const error = ref<string | null>(null)

watch(
  bilibiliAuth,
  (next) => {
    // store 异步 load 完成后同步到本地表单
    local.value = { sessdata: next.sessdata, uid: next.uid, buvid: next.buvid }
  },
  { deep: true }
)

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    const next = await window.api.patchBilibiliAuth({
      sessdata: local.value.sessdata.trim(),
      uid: local.value.uid.trim(),
      buvid: local.value.buvid.trim()
    })
    bilibiliAuth.value = next
    toast.value = '已保存。停止再开始才会生效'
    setTimeout(() => (toast.value = null), 3000)
  } catch (err) {
    error.value = (err as Error)?.message ?? '保存失败'
  } finally {
    saving.value = false
  }
}

const filled = (): boolean => Boolean(local.value.sessdata.trim())
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/40">
    <button
      class="flex w-full items-center justify-between px-5 py-3 text-left text-sm text-slate-300 hover:text-slate-100"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-2">
        <span>🔐</span>
        <span>高级 · B 站登录态</span>
        <span
          v-if="filled()"
          class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300"
        >已填写</span>
        <span v-else class="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400">未填写</span>
      </span>
      <span class="text-xs text-slate-500">{{ expanded ? '收起' : '展开' }}</span>
    </button>

    <div v-if="expanded" class="space-y-4 border-t border-slate-800 px-5 py-5">
      <div class="rounded-lg bg-amber-500/10 border border-amber-500/40 p-3 text-xs leading-relaxed text-amber-200">
        ⚠️ 未登录情况下 B 站会限制弹幕推送（你只能收到礼物和进房，看不到弹幕）。
        填上你自己 B 站账号的登录信息可以解决。<strong>仅在本地存储，不会上传</strong>。<br />
        但请注意：SESSDATA 等同于你的登录凭证。<strong>不要把这台电脑上的配置文件发给别人</strong>。
      </div>

      <details class="text-xs text-slate-400">
        <summary class="cursor-pointer hover:text-slate-200">怎么抓 SESSDATA？</summary>
        <ol class="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>用 Chrome / Edge 打开并登录 <code class="rounded bg-slate-800 px-1">live.bilibili.com</code></li>
          <li>按 <code class="rounded bg-slate-800 px-1">F12</code> 打开开发者工具</li>
          <li>切到 <strong>Application</strong> → 左侧 <strong>Cookies</strong> → <code class="rounded bg-slate-800 px-1">https://live.bilibili.com</code></li>
          <li>找到 <code class="rounded bg-slate-800 px-1">SESSDATA</code> 这一行，复制 Value 列的内容</li>
          <li>UID 在 cookie 里叫 <code class="rounded bg-slate-800 px-1">DedeUserID</code>；buvid3 是可选的，多数情况不用填</li>
        </ol>
      </details>

      <label class="block">
        <span class="mb-1 block text-xs text-slate-300">SESSDATA</span>
        <input
          v-model="local.sessdata"
          type="text"
          placeholder="b1c4...（一长串字符）"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
        />
      </label>

      <label class="block">
        <span class="mb-1 block text-xs text-slate-300">UID（你的 B 站账号 ID）</span>
        <input
          v-model="local.uid"
          type="text"
          placeholder="比如 12345678"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
        />
      </label>

      <label class="block">
        <span class="mb-1 block text-xs text-slate-300">buvid3 <span class="text-slate-500">（可选，大部分情况不填也行）</span></span>
        <input
          v-model="local.buvid"
          type="text"
          placeholder="留空即可"
          class="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
        />
      </label>

      <p
        v-if="error"
        class="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
      >{{ error }}</p>

      <div class="flex items-center gap-3">
        <button
          @click="save"
          :disabled="saving"
          class="rounded-lg bg-sky-500 px-5 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >{{ saving ? '保存中…' : '保存' }}</button>
        <span v-if="toast" class="text-xs text-emerald-400">{{ toast }}</span>
      </div>

      <p class="text-xs text-slate-500">
        改完后需要先点首页 <strong>"停止"</strong> 再 <strong>"开始"</strong> 重新连接才生效。
      </p>
    </div>
  </section>
</template>
