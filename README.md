# B 站直播弹幕+礼物插件（LiveLink）

[![Release](https://img.shields.io/github/v/release/Mr-Salticidae/livelink?style=flat-square&color=4ade80)](https://github.com/Mr-Salticidae/livelink/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Mr-Salticidae/livelink/total?style=flat-square&color=60a5fa)](https://github.com/Mr-Salticidae/livelink/releases)
![Platform](https://img.shields.io/badge/Platform-Windows-blue?style=flat-square)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](https://opensource.org/licenses/MIT)
![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-47848F?style=flat-square&logo=electron&logoColor=white)

> 给主播朋友们用的 B 站直播间桌面助手。自动欢迎、礼物感谢、屏幕特效、TTS 语音、弹幕抽奖 / 投票 / 赛马互动小游戏、弹幕悬浮窗（钉住穿透）、SuperChat 横幅、盲盒查询、AI 智能回复（规划中）。
> 立项时间：2026-05-12 · 立项人：跳蛛先生 · **当前版本：v1.0 · 状态：P0-P2 全部交付**

---

## 一、项目愿景

跳蛛先生在朋友的直播间看到一个弹幕互动插件，感兴趣，决定 DIY 一个供主播朋友圈使用。终端用户是**非技术主播**，对"装环境"零容忍。

最终交付：

- 一份双击即用的 Windows 桌面应用（`.exe` 安装包）
- 主播双击安装 → 输入直播间号 → 点击"开始" → 在 OBS 添加一个浏览器源 → 立即能用
- 不写 Python、不装 Node、不开命令行

## 二、核心功能

### v1.0 已交付

#### 基础三件套（P0）
| # | 功能 | 状态 |
|---|---|---|
| 1 | 新进房间自动欢迎（按粉丝牌等级过滤、Home 快捷开关） | ✅ |
| 2 | 观众弹幕关键词回复（自定义关键词 / 正则 / 粉丝牌门槛） | ✅ |
| 3 | 礼物感谢 + OBS overlay 礼物特效（按价位 3 档动画 + 真实礼物图） | ✅ |
| 4 | TTS 语音播报（Edge TTS 8 个中文音色，**分事件多角色**） | ✅ |

#### 主播专用工具（P1+）
| # | 功能 | 状态 |
|---|---|---|
| 5 | 主播弹幕悬浮窗（alwaysOnTop 子窗 / 钉住模式 / 鼠标穿透 / 在线人数 / 新弹幕高亮淡出） | ✅ |
| 6 | OBS 弹幕信息板（给观众看，**任意位置拖动**） | ✅ |
| 7 | SuperChat 横幅展示（按价位 4 档视觉：basic / premium / epic / legendary 屏幕中央） | ✅ |
| 8 | 盲盒投喂记录查询（弹幕"查盲盒"→ Overlay 盈亏卡） | ✅ |

#### 互动玩法（P1-P2）
| # | 功能 | 状态 |
|---|---|---|
| 9 | 弹幕抽奖（关键词参与 → 倒计时 → Overlay 公布中奖名单） | ✅ |
| 10 | 互动投票（2-6 选项 → 实时柱状图 → 公布赢家） | ✅ |
| 11 | 赛马（2-8 匹马 → 弹幕押注 → 随机赛跑动画 → 排名 + 押中观众） | ✅ |
| 12 | 三大游戏开场招牌 + 结果飘彩庆祝（屏幕全局视觉） | ✅ |

### 后续规划

| # | 功能 | 状态 |
|---|---|---|
| 13 | AI 智能回复（Claude API） | P2 后续 |
| 14 | 喂宠物虚拟养成 | P2 后续 |
| 15 | 简单点歌队列 | P1 剩余 |
| 16 | 抖音 / 虎牙适配器 | P3 |

## 三、技术栈（已敲定，详见 ARCHITECTURE.md）

- **桌面框架**：Electron + TypeScript
- **UI 层**：Vue 3 + Vite + Tailwind CSS（控制台 + OBS Overlay 同一技术栈）
- **B 站协议**：`blive-message-listener` (npm)
- **TTS**：`edge-tts-universal` (npm，免费、20+ 中文语音、无 API key)
- **OBS 联动**：内嵌 Express + Socket.IO 本地 HTTP 服务，OBS 用浏览器源加载 `http://localhost:<port>/overlay`
- **配置持久化**：`electron-store`
- **打包**：`electron-builder` 输出 NSIS 安装器

## 四、阶段路线图

```
P0 MVP        ┃ ✅ 骨架 + 三件套 + TTS + 礼物特效 overlay + 打包成 exe
P0.5 分发就绪 ┃ ✅ NSIS 中文化 + SESSDATA 加密 + 应用图标 + 开始菜单分组
P1 增强       ┃ ✅ 粉丝牌过滤 / 盲盒查询 / 弹幕悬浮窗 / 抽奖 / SC 横幅 / 分事件 TTS
                  /  OBS 弹幕信息板（任意位置）
P2 互动小游戏 ┃ ✅ 投票 / 赛马 / 开场招牌 + 结果飘彩
P2 后续       ┃ ❌ AI 智能回复 / 喂宠物
P3 多平台     ┃ ❌ 抖音 / 虎牙适配器
```

详见 `ROADMAP.md`，v1.0 完整变更日志见 `D:\AIGC工作站\跨会话协作\B站直播弹幕插件_v1.0_发布说明.md`。

## 五、目录结构（最终态）

```
D:\B站直播弹幕+礼物插件\
├── README.md                    # 本文档（项目概述）
├── ROADMAP.md                   # 阶段路线图
├── ARCHITECTURE.md              # 系统架构与模块边界
├── package.json                 # Electron + Vite 项目根
├── electron-builder.yml         # 打包配置
├── src/
│   ├── main/                    # Electron 主进程（Node.js）
│   │   ├── index.ts             # 主进程入口
│   │   ├── platform/            # 平台适配层（含 BilibiliAdapter）
│   │   ├── events/              # 统一事件总线
│   │   ├── rules/               # 规则引擎（欢迎/回复/感谢）
│   │   ├── actions/             # 动作派发（TTS / Overlay / 日志）
│   │   ├── overlay-server/      # 内嵌 Express + Socket.IO
│   │   └── config/              # electron-store 配置封装
│   ├── preload/                 # Electron preload 脚本（IPC 桥）
│   ├── renderer/                # 控制台 UI（Vue 3）
│   │   ├── pages/               # 房间号配置 / 规则编辑 / 实时日志
│   │   └── components/
│   └── overlay/                 # OBS 浏览器源页面（Vue 3 单页）
│       ├── index.html
│       └── gift-effect/         # 礼物弹出特效组件
├── resources/                   # 打包资源（图标、默认音效等）
├── dist/                        # 打包输出（gitignored）
└── docs/                        # 用户文档（主播使用手册）
    └── 主播使用说明.md
```

## 六、文档索引

- 项目主文档：`README.md`（你正在读）
- 路线图：`ROADMAP.md`
- 架构设计：`ARCHITECTURE.md`
- 阶段交接文档：`D:\AIGC工作站\跨会话协作\B站直播弹幕插件_P*_交接给_ClaudeCode.md`
- 完工报告（Claude Code 写）：`D:\AIGC工作站\跨会话协作\B站直播弹幕插件_P*_完成报告.md`

## 七、协作模式

**当前模式（2026-05-13 起）**：

```
[跳蛛先生]                  [Claude Code]            [Cowork Claude · 按需]
      │                          │                          │
      │  直接说需求               │                          │
      ├──────────────────────────►│                          │
      │                          │  实现 + 自己 ff 到 main   │
      │                          │  + 复制 exe 到主工作树    │
      │                          │  + 写完成报告             │
      │◄─────────────────────────┤                          │
      │  自己测试 + git push                                 │
      │                                                     │
      │  遇到架构决策 / review / 全局协调 时主动叫           │
      ├────────────────────────────────────────────────────►│
      │                                                     │  讨论 / 二选一意见
      │◄────────────────────────────────────────────────────┤
```

**跳蛛先生参与度：高**。他直接 drive 工程，Cowork 只在他主动求助时介入。

---

**历史模式（P0/P0.5 期 · 2026-05-12 之前）**：

```
[跳蛛先生] ──► [Cowork] ──写交接文档──► [Claude Code]
                  │                          │
                  │◄──完成报告 / 验收─────────┘
[跳蛛先生] ◄── [Cowork] 反馈
```

那个阶段 Cowork 当协调员价值高（架构选型 / 静态审查 / 教程图 / 模式约定）。进入 P1 维护期后，跳蛛先生直接对接 Claude Code 更高效，Cowork 仅在需要"另一双眼睛"或"卡住要拍板"时被主动调用。

模式变更详见 `D:\AIGC工作站\跨会话协作\B站直播弹幕插件_协作模式变更_交接给_ClaudeCode.md`。
