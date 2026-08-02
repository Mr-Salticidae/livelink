/// <reference types="vite/client" />

// 构建时由 electron.vite.config.ts 的 define 注入，取自 package.json。
// 侧栏显示版本号用，杜绝手写副本与真实版本对不上
declare const __APP_VERSION__: string
