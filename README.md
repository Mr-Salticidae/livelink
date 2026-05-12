# B 站直播弹幕+礼物插件（暂名 LiveLink）

> 给主播朋友们用的 B 站直播间桌面助手：自动欢迎、弹幕关键词回复、礼物感谢 + 屏幕特效、TTS 语音播报、弹幕抽奖/点歌、互动小游戏、AI 智能回复。
> 立项时间：2026-05-12 · 立项人：跳蛛先生 · 当前阶段：P0 (MVP) 待开发

---

## 一、项目愿景

跳蛛先生在朋友的直播间看到一个弹幕互动插件，感兴趣，决定 DIY 一个供主播朋友圈使用。终端用户是**非技术主播**，对"装环境"零容忍。

最终交付：

- 一份双击即用的 Windows 桌面应用（`.exe` 安装包）
- 主播双击安装 → 输入直播间号 → 点击"开始" → 在 OBS 添加一个浏览器源 → 立即能用
- 不写 Python、不装 Node、不开命令行

## 二、核心功能（必备 3 件套 + 4 项增量）

| # | 功能 | 状态 | 所属阶段 |
|---|---|---|---|
| 1 | 新进房间自动欢迎 | 待开发 | P0 |
| 2 | 观众发弹幕选择性自动回复（关键词/正则） | 待开发 | P0 |
| 3 | 刷礼物自动感谢 + 屏幕上礼物特效弹出 | 待开发 | P0 |
| 4 | TTS 语音播报（用 Edge TTS，免费） | 待开发 | P0 |
| 5 | 弹幕抽奖 / 点歌 | 待开发 | P1 |
| 6 | 弹幕互动小游戏（投票/赛马/喂宠物等） | 待开发 | P2 |
| 7 | AI 智能回复（Claude API 或本地 LLM） | 待开发 | P2 |
| 8 | 平台抽象层，预留抖音/虎牙接入 | 架构预留 | P3 |

## 三、技术栈（已敲定，详见 ARCHITECTURE.md）

- **桌面框架**：Electron + TypeScript
- **UI 层**：Vue 3 + Vite + Tailwind CSS（控制台 + OBS Overlay 同一技术栈）
- **B 站协议**：`blive-message-listener` (npm)
- **TTS**：`edge-tts-universal` (npm，免费、20+ 中文语音、无 API key)
- **OBS 联动**：内嵌 Express + Socket.IO 本地 HTTP 服务，OBS 用浏览器源加载 `http://localhost:<port>/overlay`
- **配置持久化**：`electron-store`
- **打包**：`electron-builder` 输出 NSIS 安装器

## 四、阶段路线图（概览，详见 ROADMAP.md）

```
P0 MVP        ┃ 骨架 + 三件套 + TTS + 礼物特效 overlay + 打包成 exe
              ┃ 验收：朋友能下载 exe，输入房间号，开播，OBS 上看到弹幕和礼物特效
              ┃ 工程量：10-15 小时（Claude Code）
P1 增强       ┃ 弹幕抽奖 + 点歌 + 规则编辑器 UI 优化
P2 智能化     ┃ AI 智能回复 + 弹幕互动小游戏
P3 多平台     ┃ 抖音 / 虎牙适配器
```

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
- 阶段交接文档：`D:\小红书运营\跨会话协作\B站直播弹幕插件_P*_交接给_ClaudeCode.md`
- 完工报告（Claude Code 写）：`D:\小红书运营\跨会话协作\B站直播弹幕插件_P*_完成报告.md`

## 七、协作模式

```
[跳蛛先生]      [Cowork Claude]               [Claude Code]
      │             │                               │
      │  说需求      │                               │
      ├────────────►│                               │
      │             │  调研 + 选型 + 写交接文档     │
      │             ├──────────────────────────────►│
      │             │                               │  按文档实现
      │             │                               │  写完成报告
      │             │◄──────────────────────────────┤
      │             │  读完成报告 + 反馈给跳蛛先生   │
      │◄────────────┤                               │
      │  里程碑 review                              │
      │  → 下一阶段交接                              │
      └────────────────────────────────────────────►│
```

跳蛛先生参与度：**中度**。每个阶段（P0/P1/P2/P3）完工后他 review 一下，需要决策时叫他，不需要他全程跟进每一行代码。
