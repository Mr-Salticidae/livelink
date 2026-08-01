// B 站弹幕服务器握手信息（token + host_list）的直连获取。
//
// 为什么不用 tiny-bilibili-ws 自己去拿：
// lib 内部把 getDanmuInfo 的结果缓存在模块级 Map（`X`，按 room_id 建键），
// 进程生命周期内永不失效、也没有对外的清除入口；而 KeepLiveTCP 的 socket.reconnect
// 又是个闭包，只重连到 init() 当时算出来的 host/port，且
//   this.options.key || (this.options.key = token)
// 意味着 key 一旦写进去就再也不会被刷新。
//
// 后果：token 过期（或首次连接时正好断网导致 key 压根没拿到）之后，
// 无论底层怎么重连、甚至用户手动"停止 → 开始"重新 startListen，
// 用的都是同一份失效的 token → 握手被拒 → 无限重连且永远失败。
// 这正是"意外断网后不间断重连但始终失败"的根因。
//
// 因此这里自己实现一份带 WBI 签名的 getDanmuInfo，每次（重）连都取全新 token，
// 再通过 ws options 的 `key` 传进去（lib 见 key 已存在就不会覆盖），彻底绕开那份缓存。
import { createHash } from 'node:crypto'

// WBI 签名混淆表。与 tiny-bilibili-ws / B 站 web 端一致
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const NAV_API = 'https://api.bilibili.com/x/web-interface/nav'
const DANMU_INFO_API = 'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo'
const SPI_API = 'https://api.bilibili.com/x/frontend/finger/spi'

// WBI 的 img_key / sub_key 官方按天轮换。缓存 30 分钟够用，
// 且拿到 -352（签名/风控失败）时会主动作废重取，不会卡在旧 key 上
const WBI_KEY_TTL_MS = 30 * 60 * 1000

// 撞上 -352/-412（风控/签名被拒）后，等一下再重签一次。
// 立刻重试会被判定为更密集的异常请求，反而更难恢复
const RISK_CONTROL_RETRY_DELAY_MS = 2_000

// 握手 token 的短期复用窗口。
//
// 这里要在两个坏结果之间取平衡：
//  - 像 lib 那样永久缓存 → token 过期后永远连不上（正在修的那个 bug）
//  - 每次重连都强制回源 → 未登录状态下 getDanmuInfo 调密了会被 B 站风控（-352），
//    实测连着跑几轮就会开始拒绝，反而更连不上
// 所以：5 分钟内复用（token 这点时间绝对没过期），超时回源；
// 而真正判断 token 失效的信号不是时间，是握手失败——那时 adapter 会显式
// 调 invalidateDanmuInfo() 强制下次回源。既不会连不上，也不会捶接口
const DANMU_INFO_TTL_MS = 5 * 60 * 1000

// 回源失败（风控 / 网络抖动）时，只要手上这份 token 还没老到离谱，
// 就先拿它去试一把——带着可能过期的 token 重连，也远好过直接放弃重连
const DANMU_INFO_STALE_FALLBACK_MS = 30 * 60 * 1000

const danmuInfoCache = new Map<number, { info: DanmuInfo; fetchedAt: number }>()

/**
 * 作废某个房间缓存的握手信息，强制下次回源。
 * 由 adapter 在"握手被拒"时调用——那是 token 真失效的确切信号
 */
export function invalidateDanmuInfo(roomId: number): void {
  danmuInfoCache.delete(roomId)
}

export interface DanmuHost {
  host: string
  port: number
  ws_port: number
  wss_port: number
}

export interface DanmuInfo {
  /** 弹幕服务器握手 token（就是 ws options 里的 key），有时效 */
  token: string
  hostList: DanmuHost[]
}

export class BilibiliApiError extends Error {
  readonly code = 'BILIBILI_API'
  /** B 站业务码，网络层失败时为 null */
  readonly apiCode: number | null
  constructor(message: string, apiCode: number | null = null, cause?: unknown) {
    super(message)
    this.name = 'BilibiliApiError'
    this.apiCode = apiCode
    if (cause) (this as { cause?: unknown }).cause = cause
  }
}

interface WbiKeys {
  imgKey: string
  subKey: string
}

let cachedWbi: { keys: WbiKeys; fetchedAt: number } | null = null

/** 让下次取 WBI key 时强制回源。签名被拒（-352）后调用 */
export function invalidateWbiKeys(): void {
  cachedWbi = null
}

// 进程内的 buvid3 设备指纹。浏览器访问 B 站时这个 cookie 一定在，
// 而缺了它的未登录请求很容易被 getDanmuInfo 判风控直接回 -352。
// 拿一次存着复用（本来就代表"同一台设备"，不该每次换）
let cachedBuvid: string | null = null

function headersFor(sessdata?: string, referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Referer: referer ?? 'https://live.bilibili.com/',
    Origin: 'https://live.bilibili.com'
  }
  // 尽量把 cookie 拼得像个真实浏览器：buvid3 在未登录时尤其关键
  const cookies: string[] = []
  const s = sessdata?.trim()
  if (s) cookies.push(`SESSDATA=${s}`)
  if (cachedBuvid) cookies.push(`buvid3=${cachedBuvid}`)
  if (cookies.length > 0) h.Cookie = cookies.join('; ')
  return h
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  let resp: Response
  try {
    resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    // AbortSignal.timeout 触发时是 TimeoutError，其余是网络层错误。两者都当"网络不通"处理
    const name = (err as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new BilibiliApiError(`请求 B 站接口超时（${timeoutMs}ms）`, null, err)
    }
    throw new BilibiliApiError('请求 B 站接口失败（网络不通？）', null, err)
  }
  if (!resp.ok) {
    throw new BilibiliApiError(`B 站接口 HTTP ${resp.status}`, null)
  }
  try {
    return (await resp.json()) as Record<string, unknown>
  } catch (err) {
    throw new BilibiliApiError('B 站接口返回的不是合法 JSON', null, err)
  }
}

function mixinKey(orig: string): string {
  let s = ''
  for (const n of MIXIN_KEY_ENC_TAB) s += orig[n] ?? ''
  return s.slice(0, 32)
}

/** 按 B 站 web 端算法给查询参数加 wts + w_rid 签名，返回拼好的 query string */
function encWbi(params: Record<string, string | number>, keys: WbiKeys): string {
  const mk = mixinKey(keys.imgKey + keys.subKey)
  const withTs: Record<string, string | number> = {
    ...params,
    wts: Math.round(Date.now() / 1000)
  }
  const illegal = /[!'()*]/g
  const query = Object.keys(withTs)
    .sort()
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(withTs[k]).replace(illegal, ''))}`
    )
    .join('&')
  const wRid = createHash('md5')
    .update(query + mk)
    .digest('hex')
  return `${query}&w_rid=${wRid}`
}

async function getWbiKeys(sessdata: string | undefined, timeoutMs: number): Promise<WbiKeys> {
  const now = Date.now()
  if (cachedWbi && now - cachedWbi.fetchedAt < WBI_KEY_TTL_MS) return cachedWbi.keys

  const json = await getJson(NAV_API, headersFor(sessdata, 'https://www.bilibili.com/'), timeoutMs)
  const data = json.data as { wbi_img?: { img_url?: string; sub_url?: string } } | undefined
  const imgUrl = data?.wbi_img?.img_url ?? ''
  const subUrl = data?.wbi_img?.sub_url ?? ''
  const basename = (u: string): string => {
    const slash = u.lastIndexOf('/')
    const dot = u.lastIndexOf('.')
    if (slash < 0 || dot <= slash) return ''
    return u.slice(slash + 1, dot)
  }
  const keys: WbiKeys = { imgKey: basename(imgUrl), subKey: basename(subUrl) }
  if (!keys.imgKey || !keys.subKey) {
    throw new BilibiliApiError('拿不到 B 站 WBI 签名密钥（nav 接口返回异常）', null)
  }
  cachedWbi = { keys, fetchedAt: now }
  return keys
}

/**
 * 取弹幕服务器握手信息（token + host_list）。
 *
 * 缓存语义见 DANMU_INFO_TTL_MS 的说明：TTL 内复用，超时回源；
 * 真正判定 token 失效靠 adapter 在握手失败时调 invalidateDanmuInfo()。
 * 关键是**不存在**"进程内永久复用"这种状态——那正是 lib 里要修的 bug。
 *
 * 签名被风控拒（-352）时作废 WBI key、隔一下重签一次，覆盖 key 轮换的场景。
 */
export async function fetchDanmuInfo(
  roomId: number,
  opts: { sessdata?: string; timeoutMs?: number } = {}
): Promise<DanmuInfo> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const cached = danmuInfoCache.get(roomId)
  if (cached && Date.now() - cached.fetchedAt < DANMU_INFO_TTL_MS) {
    return cached.info
  }
  // 先确保手上有 buvid3。它会被 headersFor 拼进 Cookie，
  // 未登录时缺这个 cookie 的 getDanmuInfo 很容易直接吃 -352
  await fetchBuvid({ sessdata: opts.sessdata, timeoutMs })

  const attempt = async (): Promise<DanmuInfo> => {
    const keys = await getWbiKeys(opts.sessdata, timeoutMs)
    const query = encWbi({ id: roomId, type: 0 }, keys)
    const json = await getJson(
      `${DANMU_INFO_API}?${query}`,
      headersFor(opts.sessdata, `https://live.bilibili.com/${roomId}`),
      timeoutMs
    )
    const code = typeof json.code === 'number' ? json.code : -1
    if (code !== 0) {
      const msg = typeof json.message === 'string' ? json.message : String(code)
      throw new BilibiliApiError(`getDanmuInfo 失败：${msg}`, code)
    }
    const data = json.data as { token?: string; host_list?: DanmuHost[] } | undefined
    const token = data?.token
    if (!token) {
      throw new BilibiliApiError('getDanmuInfo 没返回 token', code)
    }
    return {
      token,
      hostList: Array.isArray(data?.host_list) ? data!.host_list! : []
    }
  }

  const fetchFresh = async (): Promise<DanmuInfo> => {
    try {
      return await attempt()
    } catch (err) {
      // -352 / -412 是签名或风控维度的拒绝。可能是 WBI key 轮换了（作废重签能好），
      // 也可能是短时间请求太密被限流（这时立刻重试只会火上浇油）。
      // 所以作废缓存后隔一小会儿再试一次，只试一次——真被限流了就如实往上抛
      if (err instanceof BilibiliApiError && (err.apiCode === -352 || err.apiCode === -412)) {
        invalidateWbiKeys()
        await new Promise((r) => setTimeout(r, RISK_CONTROL_RETRY_DELAY_MS))
        return attempt()
      }
      throw err
    }
  }

  try {
    const info = await fetchFresh()
    danmuInfoCache.set(roomId, { info, fetchedAt: Date.now() })
    return info
  } catch (err) {
    // 回源失败但手上还有一份没老太多的 token —— 拿它去试。
    // 断网 / 风控期间这条兜底是"还能重连上"和"彻底连不上"的分界
    if (cached && Date.now() - cached.fetchedAt < DANMU_INFO_STALE_FALLBACK_MS) {
      console.warn(
        `[bilibili-api] 取新 token 失败（${(err as Error)?.message ?? err}），` +
          `改用 ${Math.round((Date.now() - cached.fetchedAt) / 1000)}s 前那份继续尝试重连`
      )
      return cached.info
    }
    throw err
  }
}

/**
 * 取 buvid3（设备指纹）。两个用途：
 *  - 作为弹幕握手包里的 buvid 字段（缺了 B 站会降级推送）
 *  - 作为后续所有 API 请求的 buvid3 cookie（缺了未登录请求容易被判 -352 风控）
 *
 * 取到就在进程内存着复用；拿不到不致命，调用方降级继续
 */
export async function fetchBuvid(
  opts: { sessdata?: string; timeoutMs?: number } = {}
): Promise<string | null> {
  if (cachedBuvid) return cachedBuvid
  try {
    const json = await getJson(SPI_API, headersFor(opts.sessdata), opts.timeoutMs ?? 8_000)
    const data = json.data as { b_3?: string } | undefined
    cachedBuvid = data?.b_3 ?? null
    return cachedBuvid
  } catch (err) {
    console.warn('[bilibili-api] fetchBuvid failed (non-fatal):', (err as Error)?.message ?? err)
    return null
  }
}
