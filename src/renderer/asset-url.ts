// 把 shared 里那种根绝对路径的静态资源（如 '/assets/pets/xxx.png'）
// 解析成主播端控制台真正能加载的 URL。
//
// 为什么需要这一层：同一个常量被三处消费，但它们的 base 不一样——
//
//   OBS overlay      http://127.0.0.1:38506/overlay
//                    → 主进程用 express.static('/assets', ...) 挂了这个前缀，
//                      '/assets/pets/x.png' 直接就是对的
//   控制台 dev       http://localhost:5173/...
//                    → vite dev server 从项目根提供 public/，绝对路径也是对的
//   控制台 打包后    file:///D:/.../out/renderer/src/renderer/index.html
//                    → '/assets/...' 会被解析成盘符根目录，永远 404
//
// 前两种情况天然正确，所以这个 bug 在 `pnpm dev` 里根本看不见，
// 只有装出来的正式版会露馅（宠物图鉴一片碎图 + alt 文字）。

// 打包后 renderer 的 index.html 落在 out/renderer/src/renderer/，
// 而静态资源在 out/renderer/assets/，中间差两层。
// 这个层级由 electron.vite.config.ts 的 rollup input 决定，
// scripts/verify-asset-url.ts 会对着真实构建产物校验它没被改动过。
const FILE_PROTOCOL_PREFIX = '../../'

export function assetUrl(rootRelative: string): string {
  if (!rootRelative || !rootRelative.startsWith('/')) return rootRelative
  if (location.protocol !== 'file:') return rootRelative
  return new URL(FILE_PROTOCOL_PREFIX + rootRelative.slice(1), location.href).href
}
