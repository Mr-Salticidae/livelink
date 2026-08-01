/**
 * 断线重连回归自检（手动跑，需要联网 + 一个正在直播的房间号）
 *
 *   pnpm verify:reconnect            # 用默认房间
 *   pnpm verify:reconnect 24160384   # 指定房间（必须正在开播）
 *
 * 为什么值得单独留一个脚本：v1.2.1 修的那个"意外断网后不停重连但永远连不上"，
 * 靠单元测试测不出来——它是 tiny-bilibili-ws 的缓存 / 生命周期与真实网络耦合出来的。
 * 这个脚本直接连真实 B 站，把当初的事故时序一条条重放一遍。改动连接层之后跑一次。
 *
 * 覆盖的回归点（每一条都对应一个真实修过的 bug）：
 *   0. 握手 token 短期可复用、但必须能被作废重取（lib 是进程内永久缓存，作废不了）
 *   1. connect() 要等真正的 CONNECT_SUCCESS，而不是 TCP 一连上就报"已连接"
 *   2. 被动断线要能被察觉并上报 closed(intended=false)
 *   3. reconnect() 是"拆掉重建"，不是 lib 那个复用失效 token 的 reconnect()
 *   4. disconnect() 必须真的杀死底层 socket，不留僵尸
 *   5. 停止后能重新开始，不会误报"已经连接了"
 *   6. 事故时序：先断网、再点停止 —— 旧实现在这条路径上 100% 留下停不掉的僵尸
 */
import { BilibiliAdapter } from '../src/main/platform/bilibili'
import { fetchDanmuInfo, invalidateDanmuInfo } from '../src/main/platform/bilibili-api'

const ROOM = Number(process.argv[2] ?? 24160384)

const log = (...a: unknown[]): void =>
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 探进 adapter 私有字段拿底层 socket，只有自检脚本能这么干 */
function rawOf(
  adapter: BilibiliAdapter
): { tcpSocket?: { destroyed?: boolean; destroy?: () => void } } | null {
  const l = (adapter as unknown as { listener: { live: unknown } | null }).listener
  if (!l) return null
  return l.live as { tcpSocket?: { destroyed?: boolean; destroy?: () => void } }
}

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  log(`${ok ? '  PASS' : '  FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  log(`自检房间：${ROOM}（必须正在直播，否则收不到下行事件会误判失败）`)

  // ── 0. token 缓存语义 ────────────────────────────────────────
  log('测试 0：token 缓存语义 —— 短期可复用，但必须能作废重取')
  const t1 = await fetchDanmuInfo(ROOM)
  check('host_list 非空', t1.hostList.length > 0, `${t1.hostList.length} 个节点`)
  const t2 = await fetchDanmuInfo(ROOM)
  check('TTL 内复用同一 token（避免把 getDanmuInfo 打到风控）', t1.token === t2.token)
  invalidateDanmuInfo(ROOM)
  const t3 = await fetchDanmuInfo(ROOM)
  check('作废后能取到全新 token（lib 的永久缓存做不到）', t3.token !== t1.token)

  const adapter = new BilibiliAdapter()
  const statusLog: string[] = []
  adapter.onStatus((e) => {
    statusLog.push(e.kind)
    log(`  status → ${JSON.stringify(e)}`)
  })
  let eventCount = 0
  adapter.on(() => {
    eventCount++
  })

  // ── 1. 首次连接 ──────────────────────────────────────────────
  log('测试 1：首次连接')
  const t0 = Date.now()
  await adapter.connect(ROOM)
  check('connect() 成功返回', true, `耗时 ${Date.now() - t0}ms`)
  check('isConnected 为 true', adapter.isConnected)
  check('收到 opened', statusLog.includes('opened'))
  await sleep(8000)
  check('收到真实下行事件（证明握手真的过了）', eventCount > 0, `${eventCount} 条`)

  // ── 2. 模拟意外断网 ─────────────────────────────────────────
  log('测试 2：模拟意外断网（强行 destroy 底层 socket）')
  statusLog.length = 0
  rawOf(adapter)?.tcpSocket?.destroy?.()
  await sleep(2500)
  check('收到 closed(intended=false)', statusLog.includes('closed'))
  check('isConnected 变回 false', !adapter.isConnected)

  // ── 3. 重连 ─────────────────────────────────────────────────
  log('测试 3：reconnect() 拆掉重建')
  statusLog.length = 0
  eventCount = 0
  const tRe = Date.now()
  await adapter.reconnect()
  check('reconnect() 成功 resolve', true, `耗时 ${Date.now() - tRe}ms`)
  check('重连后 isConnected 为 true', adapter.isConnected)
  check('重连后收到 opened', statusLog.includes('opened'))
  await sleep(8000)
  check('重连后重新收到下行事件', eventCount > 0, `${eventCount} 条`)

  // ── 4. 正常停止不留僵尸 ─────────────────────────────────────
  log('测试 4：disconnect() 必须真的杀死底层连接')
  const rawBefore = rawOf(adapter)
  statusLog.length = 0
  eventCount = 0
  await adapter.disconnect()
  check('isConnected 为 false', !adapter.isConnected)
  check('底层 tcpSocket 已 destroyed', rawBefore?.tcpSocket?.destroyed === true)
  log('  静默观察 12s…')
  await sleep(12000)
  check('无状态泄漏', statusLog.length === 0, statusLog.join(','))
  check('无事件泄漏', eventCount === 0, `${eventCount} 条`)

  // ── 5. 停止后能重新开始 ─────────────────────────────────────
  log('测试 5：停止后重新 connect')
  await adapter.connect(ROOM)
  check('重新 connect() 成功', adapter.isConnected)

  // ── 6. 事故时序：先断网、再点停止 ───────────────────────────
  log('测试 6：先意外断网、再点"停止"（旧实现这条路径 100% 留僵尸）')
  statusLog.length = 0
  rawOf(adapter)?.tcpSocket?.destroy?.()
  await sleep(1500)
  check('断网后收到 closed', statusLog.includes('closed'))
  await adapter.disconnect()
  statusLog.length = 0
  eventCount = 0
  log('  静默观察 15s（跨过 lib 那个 5s 重连计时器）…')
  await sleep(15000)
  check('无僵尸重连、无状态泄漏', statusLog.length === 0, statusLog.join(','))
  check('无事件泄漏', eventCount === 0, `${eventCount} 条`)
  check('isConnected 为 false', !adapter.isConnected)

  log('')
  log(failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  log('自检脚本本身跑挂了：', err)
  process.exit(1)
})
