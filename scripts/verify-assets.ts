/**
 * 静态资源可达性自检（对着真实构建产物跑，跑之前先 pnpm build）
 *
 *   pnpm verify:assets
 *
 * 为什么要单独有这个：宠物图鉴那次碎图，根因是 shared/pets.ts 里写的是根绝对路径
 * '/assets/pets/x.png'，它在两种 base 下都对、只在第三种下错：
 *
 *   OBS overlay（http，主进程 express 挂了 /assets）      ✅
 *   控制台 dev（vite dev server 从项目根提供 public/）     ✅
 *   控制台 打包后（file:// 加载 index.html）               ❌ 解析到盘符根
 *
 * 于是 `pnpm dev` 一切正常，装出来的正式版一片碎图 —— 靠人肉点是点不出来的，
 * 因为开发时那条路径根本不会走到。这个脚本直接按 file:// 的解析规则算一遍，
 * 落到磁盘上看文件在不在。
 */
import { existsSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PET_SPECIES } from '../src/shared/pets'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`)
}

// 用 cwd 而不是 __dirname：这个脚本被 esbuild 打进 node_modules/.cache/ 再跑，
// __dirname 会指到那里去。pnpm 脚本一律从项目根启动，cwd 才是稳的
const ROOT = process.cwd()
const RENDERER_HTML = resolve(ROOT, 'out/renderer/src/renderer/index.html')
const OVERLAY_ASSETS_DIR = resolve(ROOT, 'out/renderer/assets')

// src/renderer/asset-url.ts 里写死的前缀。两边必须一致
const FILE_PROTOCOL_PREFIX = '../../'

console.log('\nA. 构建产物就位')
check('renderer index.html 存在（没有就先 pnpm build）', existsSync(RENDERER_HTML), RENDERER_HTML)
check('assets 目录存在', existsSync(OVERLAY_ASSETS_DIR), OVERLAY_ASSETS_DIR)

if (!existsSync(RENDERER_HTML)) {
  console.log('\n构建产物缺失，先跑 pnpm build 再来。')
  process.exit(1)
}

console.log('\nB. 控制台（file://）能解析到每一张宠物图')
// 完整复刻 assetUrl() 在 file: 协议下的行为
const htmlUrl = pathToFileURL(RENDERER_HTML)
function resolveAsFileProtocol(rootRelative: string): string {
  return new URL(FILE_PROTOCOL_PREFIX + rootRelative.slice(1), htmlUrl).href
}

for (const species of PET_SPECIES) {
  for (const stage of [1, 2, 3] as const) {
    const rootRelative = species.assets[stage]
    check(
      `${species.name} 第 ${stage} 阶 assets 是根绝对路径`,
      typeof rootRelative === 'string' && rootRelative.startsWith('/assets/'),
      String(rootRelative)
    )
    const diskPath = fileURLToPath(resolveAsFileProtocol(rootRelative))
    check(`${species.name} 第 ${stage} 阶图能落到磁盘`, existsSync(diskPath), diskPath)
  }
}

console.log('\nC. OBS overlay（http://）那条路径同样能命中')
// 主进程把 out/renderer/assets 挂在 /assets 前缀下，所以去掉前缀直接拼即可
for (const species of PET_SPECIES) {
  for (const stage of [1, 2, 3] as const) {
    const served = resolve(OVERLAY_ASSETS_DIR, species.assets[stage].replace(/^\/assets\//, ''))
    check(`${species.name} 第 ${stage} 阶可被 overlay 静态服务命中`, existsSync(served), served)
  }
}

console.log('\nD. 前缀假设本身')
// 若哪天改了 electron.vite.config.ts 的 rollup input，index.html 的层级会变，
// 这条会红 —— 那时候 asset-url.ts 里的 FILE_PROTOCOL_PREFIX 也要跟着改
check(
  `从 index.html 往上 ${FILE_PROTOCOL_PREFIX} 正好是 assets 的父目录`,
  resolve(dirname(RENDERER_HTML), FILE_PROTOCOL_PREFIX) === resolve(OVERLAY_ASSETS_DIR, '..'),
  `${resolve(dirname(RENDERER_HTML), FILE_PROTOCOL_PREFIX)} vs ${resolve(OVERLAY_ASSETS_DIR, '..')}`
)

console.log('\nE. 每张宠物图只有一只宠物')
// 这批图是从精灵图切出来的，切宽了就会把相邻形态的一角带进来（v1.7.1 修过一次：
// 9 张里有 6 张右边粘着下一形态的碎片，图鉴上看像三只叠在一起）。
// 判据：整张图的非透明像素在水平方向上必须是**一段连续区间**；
// 出现被宽空白带隔开的第二段，就说明又带进了不该有的东西。
const MIN_GAP = 8 // 小于这个宽度的空隙算同一只宠物身上的缝（比如手臂与身体之间）

for (const species of PET_SPECIES) {
  for (const stage of [1, 2, 3] as const) {
    const diskPath = fileURLToPath(resolveAsFileProtocol(species.assets[stage]))
    if (!existsSync(diskPath)) continue
    try {
      const runs = alphaColumnRuns(readFileSync(diskPath), MIN_GAP)
      check(
        `${species.name} 第 ${stage} 阶图里没有游离碎片`,
        runs.length === 1,
        runs.length === 1 ? `列 ${runs[0][0]}-${runs[0][1]}` : `发现 ${runs.length} 段：${runs.map((r) => r[0] + '-' + r[1]).join(' / ')}`
      )
    } catch (err) {
      check(`${species.name} 第 ${stage} 阶图可解析`, false, (err as Error).message)
    }
  }
}

console.log(`\n${failures === 0 ? '全部通过' : '有失败项'}：${checks - failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)

/**
 * 只为读 alpha 通道写的极简 PNG 解码：8bit RGBA、非隔行。
 * 不引第三方库是刻意的——这个仓库没有图像依赖，为一条断言装 sharp 不划算。
 * 遇到不支持的格式直接抛，不静默放行（静默放行等于这条断言白写）。
 */
function alphaColumnRuns(buf: Buffer, minGap: number): [number, number][] {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('不支持隔行 PNG')
    } else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`只支持 8bit RGBA，实际 bitDepth=${bitDepth} colorType=${colorType}`)
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`未知 filter ${filter}`)
      cur[i] = v & 0xff
    }
  }
  const colHas = new Array<boolean>(width).fill(false)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (out[y * stride + x * bpp + 3] >= 16) colHas[x] = true
    }
  }
  // 先按连续非空列切段，再把窄于 minGap 的缝合并回去
  const runs: [number, number][] = []
  let start = -1
  for (let x = 0; x <= width; x++) {
    if (x < width && colHas[x]) {
      if (start < 0) start = x
    } else if (start >= 0) {
      const last = runs[runs.length - 1]
      if (last && start - last[1] - 1 < minGap) last[1] = x - 1
      else runs.push([start, x - 1])
      start = -1
    }
  }
  return runs
}
