# 系统架构与模块边界

> 配合 README.md / ROADMAP.md 一起读。本文档侧重"模块怎么切、数据怎么流、为什么这么选"。Claude Code 实施时应严格遵守模块边界。

---

## 一、整体架构图

```
                           ┌──────────────────────┐
                           │   B 站直播间 (WSS)    │
                           └──────────┬───────────┘
                                      │ WebSocket 弹幕协议
                                      ▼
┌────────────────────────────────────────────────────────────────────┐
│                  Electron 主进程 (Node.js / TypeScript)             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │  Platform Adapter (接口抽象)                                  ││
│  │    └─ BilibiliAdapter  (blive-message-listener)               ││
│  │       预留：DouyinAdapter / HuyaAdapter                        ││
│  └────────────────────────┬──────────────────────────────────────┘│
│                            │ 标准化事件                              │
│                            ▼                                        │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │  Event Bus (内存事件总线 - 用 mitt 或 EventEmitter)            ││
│  │    事件类型：viewer.enter / danmu.received / gift.received     ││
│  │              / follow.received / guard.bought / super.chat     ││
│  └────────────────────────┬──────────────────────────────────────┘│
│                            │                                        │
│      ┌─────────────────────┼─────────────────────────┐              │
│      ▼                     ▼                         ▼              │
│  ┌──────────┐         ┌──────────┐              ┌──────────┐       │
│  │  Rule    │         │ Console  │              │ Overlay  │       │
│  │  Engine  │         │  Logger  │              │ Broadcaster      │
│  └────┬─────┘         └──────────┘              └────┬─────┘       │
│       │ 匹配命中的规则                                │ Socket.IO   │
│       ▼                                              │ emit         │
│  ┌──────────────────────────────────────────────┐    │             │
│  │  Action Dispatcher                            │    │             │
│  │    ├─ TTSAction     (Edge TTS 合成 → 播放)   │    │             │
│  │    ├─ OverlayAction (推送到 Overlay 端)      │────┤             │
│  │    └─ LogAction     (写实时日志，供 UI 看)   │    │             │
│  │   预留：DanmuSendAction (P1 起，需要登录态)   │    │             │
│  └──────────────────────────────────────────────┘    │             │
│                                                        ▼            │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │  Local HTTP Server (Express + Socket.IO)                       ││
│  │    GET  /overlay             → 返回 overlay 单页 (Vue build)    ││
│  │    GET  /api/health          → 状态探活                         ││
│  │    WS   /socket.io           → 推送 gift / enter / danmu 事件   ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │  Config Store (electron-store)                                 ││
│  │    - 房间号 (room.id)                                          ││
│  │    - 规则列表 (rules.welcome / rules.replies / rules.thanks)   ││
│  │    - TTS 偏好 (tts.enabled / tts.voice / tts.rate / tts.volume)││
│  │    - Overlay 端口 (overlay.port，默认 38501，冲突时自动 +1)    ││
│  │    - 平台选择 (platform.active = "bilibili")                   ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
        ▲ IPC                                          ▲ HTTP/WS
        │ (preload bridge)                             │
        ▼                                              │
┌────────────────────────────────┐    ┌────────────────────────────────┐
│ Electron 渲染进程 (Vue 控制台)  │    │ OBS 浏览器源 (Vue overlay)      │
│  - 首页：房间号 + 开始/停止     │    │  - 礼物弹出特效                  │
│  - 规则编辑：欢迎/回复/感谢     │    │  - 进房欢迎动画                  │
│  - TTS 设置                    │    │  - SuperChat 横幅 (P1)           │
│  - 实时日志 (滚动)              │    │  - 抽奖结果 (P1)                 │
│  - Overlay URL 一键复制         │    │  - 透明背景，CSS 动画            │
└────────────────────────────────┘    └────────────────────────────────┘
```

## 二、模块边界（强制约束）

### 1. Platform Adapter

接口形如：

```typescript
interface PlatformAdapter {
  readonly platform: 'bilibili' | 'douyin' | 'huya'
  connect(roomId: string | number): Promise<void>
  disconnect(): Promise<void>
  on(event: 'event', listener: (e: StandardEvent) => void): void
}

interface StandardEvent {
  kind: 'viewer.enter' | 'danmu.received' | 'gift.received' | 'follow.received' | 'guard.bought' | 'super.chat'
  platform: string
  timestamp: number
  user: { uid: string; uname: string; avatar?: string; isAdmin?: boolean; guardLevel?: number }
  payload: ViewerEnterPayload | DanmuPayload | GiftPayload | /* ... */
}
```

**为什么这么切**：未来加抖音只需写一个 DouyinAdapter，把抖音的 SDK 事件转成 StandardEvent，规则引擎和 Action 完全不动。

### 2. Event Bus

用 `mitt` 或 Node `EventEmitter`，单一职责：转发标准事件。**不要在 Event Bus 里做任何业务判断**。

### 3. Rule Engine

每条规则 = 一个 `Rule` 对象：

```typescript
interface Rule {
  id: string
  enabled: boolean
  trigger: EventKind                                         // 哪类事件触发
  match: (e: StandardEvent) => boolean                       // 是否命中（关键词/正则/无脑命中）
  cooldownSec?: number                                       // 冷却（防刷屏）
  perUserCooldownSec?: number                                // 同一用户冷却
  actions: ActionSpec[]                                      // 命中后派发哪些动作
}
```

MVP 阶段三套默认规则集：
- `welcome.default`：trigger = `viewer.enter`，match = 总命中，cooldown = 30 秒（避免刷屏），action = [LogAction, TTSAction（话术模板：欢迎 {uname} 来到直播间）, OverlayAction（小动画）]
- `reply.keyword.*`：trigger = `danmu.received`，match = 关键词包含，action = [LogAction（MVP 不发弹幕，仅日志，原因见下）]
- `gift.thanks.default`：trigger = `gift.received`，match = 总命中，action = [LogAction, TTSAction（"感谢 {uname} 送出的 {giftName} × {num}"）, OverlayAction（礼物特效）]

**MVP 不实际向 B 站发弹幕的原因**：发弹幕需要登录态 + Cookie，涉及账号风险和验证码风险，留到 P1 用户明确同意后再做。MVP 阶段"回复"先表现为日志和 TTS。

### 4. Action Dispatcher

每个 Action 是一个 async 函数 `(spec, event) => Promise<void>`。Dispatcher 串行/并行调度（gift 特效要等 TTS 念完再放下一条，需要队列；进房欢迎不阻塞）。

**TTSAction 设计要点**：
- 用 `edge-tts-universal` 合成音频流 → 写临时 wav → Electron 主进程用 Node 播放（用 `play-sound` 或 `node-speaker` 或 Electron BrowserWindow 隐藏播放）
- 中文女声推荐 `zh-CN-XiaoxiaoNeural` 作默认，提供 5-8 个可选
- **音频不要放在 overlay 页里**：OBS 浏览器源默认不让 autoplay audio，且主播自己要听到 TTS（OBS 不一定回环录到自己耳机），所以 TTS 必须主进程播

### 5. Local HTTP Server

- 默认端口 38501，冲突自动 +1 直到可用，最终端口写回 ConfigStore 并显示在控制台 UI 上
- 启动时把 `src/overlay/dist` 作为静态目录 serve
- Socket.IO 用 namespace `/overlay`，所有 Overlay 端连进来
- **不要做 CORS 限制**：本机访问，OBS 也是本机，简单优先

### 6. Config Store

key 命名约定：`<domain>.<field>`，比如 `room.id`、`tts.voice`、`overlay.port`。

### 7. Console (Renderer)

只通过 IPC 和主进程交互，**不要在渲染进程里直接 import Node 模块**（Electron 23+ 安全策略，contextIsolation = true，nodeIntegration = false）。

IPC 通道命名：
- `app:start` / `app:stop` — 开始/停止连接直播间
- `app:status` — 拉取当前状态
- `event:stream` — 主进程向渲染进程推实时事件（用于实时日志）
- `config:get` / `config:set` — 读写配置
- `rule:list` / `rule:upsert` / `rule:delete`
- `tts:test` — UI 上点"测试声音"按钮触发

### 8. Overlay (独立 Vue 单页)

- Build 输出到 `src/overlay/dist`，主进程的 Express 把它 serve 出去
- 入口 `index.html` 透明背景（`body { background: transparent }`）
- 用 Socket.IO 客户端连 `http://localhost:<port>`，namespace `/overlay`
- 收到 `gift.received` 事件 → 触发礼物特效组件（一个礼物图标飞入 + 用户名 + 礼物名 + 数量，CSS 动画 3-5 秒）
- 收到 `viewer.enter` 事件 → 顶部一条短滚动条欢迎（可关闭）
- **不要在 overlay 里播音频**（OBS 政策 + 主进程已经在播）

## 三、关键技术决策（已定，不要再权衡）

| 决策 | 选择 | 备选 | 决策理由 |
|---|---|---|---|
| 桌面框架 | **Electron** | Tauri / PyQt | OBS overlay 复用 web 技术栈；Node 生态有现成的 B 站 / TTS 库；打包成熟；bundle 大点对主播 PC 不是问题 |
| 渲染层 | **Vue 3 + Vite + Tailwind** | React / Svelte | Vue 模板对非 React 派开发者更直观；与 overlay 共用一套；Tailwind 让 UI 不用纠结样式 |
| B 站协议 | **blive-message-listener** | bilibili-live-ws / 直接逆向 / 开放平台 | TypeScript 友好、ddiu8081 维护活跃、零登录态零风险 |
| TTS | **edge-tts-universal** | 百度 TTS / Azure / 微软 SAPI | 免费、无 API key、中文 20+ 声音、Node 包成熟 |
| 内嵌 HTTP | **Express + Socket.IO** | Fastify / 原生 ws | Express 心智成本最低；Socket.IO 重连 + 命名空间开箱即用 |
| 配置 | **electron-store** | better-sqlite3 / lowdb | MVP 配置量少，JSON 文件够用 |
| 打包 | **electron-builder + NSIS** | electron-forge | electron-builder 中文文档丰富；NSIS 安装器对非技术用户友好 |
| 包管理 | **pnpm** | npm / yarn | 速度快、磁盘省、对 monorepo 友好（未来可能拆 packages/） |

## 四、数据流时序示例

**场景**：观众 "弹幕怪兽_007" 进了房间。

```
1. blive-message-listener 收到 INTERACT_WORD 包
   ↓
2. BilibiliAdapter 把它标准化成 StandardEvent
   { kind: 'viewer.enter', user: { uid: '...', uname: '弹幕怪兽_007' }, ... }
   ↓
3. Event Bus 广播 → 三处订阅
   ├─ Console Logger    → 日志 "弹幕怪兽_007 进入直播间"
   ├─ Rule Engine       → 匹配 welcome.default 规则
   │                       → 派发 [TTSAction("欢迎弹幕怪兽_007来到直播间"),
   │                              OverlayAction({ kind: 'viewer.enter', ... })]
   └─ Overlay Broadcaster → Socket.IO emit 'viewer.enter'
   ↓
4. TTSAction:
   - edge-tts-universal 合成 → wav buffer
   - 主进程播放（不阻塞主线程）
5. OverlayAction (=Overlay Broadcaster) 已经在步骤 3 发了
6. OBS Overlay (Vue) 收到 socket 事件 → CSS 动画播放欢迎条
```

**场景**：观众发了 100 个"❤"礼物（牛魔王礼物）。

```
1. SEND_GIFT 包 → BilibiliAdapter → StandardEvent { kind: 'gift.received', ... }
2. Event Bus 广播
3. Rule Engine 匹配 gift.thanks.default → 派发动作
4. TTSAction 进入队列（高优先级，且队列做合并：同一人 5 秒内同一礼物合并为一次"感谢XXX送的 N 个 X"）
5. OverlayAction 立即弹特效（特效要明显，因为礼物=钱）
```

## 五、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| B 站协议改动 / 反爬升级 | 中 | 弹幕断流 | Adapter 层抽象 + 监控 blive-message-listener issue tracker；P2 阶段考虑接入 B 站开放平台正规接口 |
| OBS 浏览器源音频被禁 | 高 | TTS 无声 | 已规避：TTS 在 Electron 主进程播放，不依赖 overlay |
| Windows Defender 误报 Electron 打包 exe | 中 | 主播朋友拒装 | electron-builder 配 NSIS + 加图标 + 写产品名；后期可考虑代码签名（淘宝 EV 证书约 ¥2000/年，跳蛛先生评估 ROI 再说，MVP 阶段不做） |
| 高并发刷礼物时 TTS 队列爆炸 | 低 | 念不完一堆 | 队列做合并（同人同礼物 5 秒内合并）+ 最长队列长度 20 截断 + UI 上有"高频时合并播报"开关 |
| 主播朋友输错房间号 | 高 | 连不上 | 连接前先调 `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=` 校验，错了给清楚提示 |
| 主播改密码 / 退登 | N/A | MVP 不需要登录态，不影响 | MVP 不依赖登录，到 P1 发弹幕功能才涉及，到时候再设计 |

## 六、性能/资源预算（MVP 基线）

- 内存：Electron 主进程 + 渲染 + overlay ≤ 350 MB
- CPU：空闲时 ≤ 2%，礼物高峰瞬时 ≤ 15%
- 安装包大小：≤ 120 MB（Electron 基础 ~80 MB，加上依赖和资源大约这个量级）
- 启动时间：双击图标 → 看到 UI ≤ 3 秒（NSIS 解压不算）

## 七、Out of Scope (MVP)

MVP 阶段**不做**：

- ❌ 发弹幕（涉及登录态，P1 再说）
- ❌ AI 智能回复（P2）
- ❌ 抽奖 / 点歌 / 小游戏（P1-P2）
- ❌ 多平台（P3）
- ❌ 自动更新（用户手动下新安装包覆盖即可）
- ❌ 代码签名
- ❌ macOS / Linux 打包（主播朋友都 Windows）
- ❌ 自托管中继服务器（纯本地）
