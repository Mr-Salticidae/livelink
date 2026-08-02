import type { StandardEvent } from '../platform/adapter'

// 一条弹幕可能同时命中多个"会出声"的功能：
//   观众发「小助手 今天玩什么」→ AI 回复会念答案；
//   观众发「你好」→ 问候规则会念"XX你好呀"；
//   观众发「查余额」→ 钱包规则会推卡片。
// 如果弹幕朗读再把原文念一遍，听感就是同一句话被念两次。
//
// 这里用一个 WeakSet 给事件对象打"已被接管"的标记：
// mitt 把同一个事件对象引用交给所有监听器，所以先跑的监听器打的标记，
// 后跑的弹幕朗读能直接看到。用 WeakSet 是因为事件对象一被回收标记就自动消失，
// 不需要任何清理逻辑，也不会泄漏。
//
// 时序要求（main/index.ts 装配时必须保证）：
//   规则引擎 / AI 回复 先 attach，弹幕朗读后 attach，
//   且打标记必须发生在监听器的同步段里（不能等到 await 之后）。
const claimed = new WeakSet<StandardEvent>()

export function claimSpeech(event: StandardEvent): void {
  claimed.add(event)
}

export function isSpeechClaimed(event: StandardEvent): boolean {
  return claimed.has(event)
}
