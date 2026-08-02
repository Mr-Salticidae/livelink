/** @type {import('tailwindcss').Config} */
//
// LiveLink 视觉系统「蛛丝」——与跳蛛先生的另外两个站点同源：
//   · 蛛网之上（above-the-web）：杂志风、衬线标题、蛛丝紫、发丝级描边、卡片悬浮起边光
//   · pb-arena：等宽小标签（大字距全大写）、药丸控件、表格数字、印刷感留白
//
// 实现策略：全项目 656 处 slate-* / 47 处 sky-* 已经写死在各页面里，
// 与其逐页重写，不如把这两条色阶**重新映射**到品牌色板 ——
// 一处改动，10 个页面 + OBS overlay + 弹幕悬浮窗同时换肤，且零重构风险。
//   slate  → 紫调墨色阶（承自蛛网之上的 paper / ink / line）
//   sky    → 蛛丝紫（主行动色）
// emerald / amber / rose 保留为语义色（已连接 / 重连中 / 出错），
// 只压低饱和度让它们退到蛛丝紫身后，不与主色抢视觉重心。
export default {
  content: [
    './src/renderer/**/*.{vue,ts,html}',
    './src/overlay/**/*.{vue,ts,html}',
    './src/danmu-overlay/**/*.{vue,ts,html}'
  ],
  theme: {
    extend: {
      colors: {
        // ── 墨色阶（紫调中性色）。原 slate 的语义位置保持不变 ──
        //   950 最深 = 应用底 / 输入框底；900 = 卡片面；800 = 发丝描边
        //   400 = 次级文字；100 = 主文字
        slate: {
          50: '#f8f7fd',
          100: '#ece8f5', // --ink
          200: '#dbd5ec',
          300: '#bdb5d4',
          400: '#9a93ad', // --ink-soft
          500: '#7b7395',
          600: '#5c5578',
          700: '#3d3856',
          800: '#2a2738', // --line
          900: '#17151f', // --paper-2 卡片
          950: '#0d0c13' // --paper 应用底
        },
        // ── 蛛丝紫（主行动色）──
        sky: {
          50: '#f3f0ff',
          100: '#e7e0ff',
          200: '#d2c6ff',
          300: '#c3b5ff',
          400: '#b09aff',
          500: '#9b85ff', // accent
          600: '#7d5fff',
          700: '#6d4aff',
          800: '#5636d6',
          900: '#3f2799',
          950: '#241553'
        },
        // 渐变副色（蛛丝紫 → 品红），用于起边光 / 标题辉光
        silk: {
          DEFAULT: '#9b85ff',
          2: '#d98bff'
        },
        brand: {
          DEFAULT: '#9b85ff',
          dark: '#6d4aff'
        }
      },
      fontFamily: {
        // 全离线应用（CSP default-src 'self'），只能用系统字体，不引入网络字体
        sans: ['PingFang SC', 'Microsoft YaHei', 'system-ui', '-apple-system', 'sans-serif'],
        // 衬线标题——杂志感的来源
        serif: ['Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', 'Georgia', 'serif'],
        // 等宽——小标签与所有数字
        mono: ['DM Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        // 卡片悬浮：低透明度大扩散，印刷投影感而非游戏化光晕
        lift: '0 14px 34px -14px rgba(0, 0, 0, .55)',
        dock: '0 18px 48px rgba(0, 0, 0, .38)'
      },
      letterSpacing: {
        // pb-arena 的小标签字距
        label: '.16em'
      }
    }
  },
  plugins: []
}
