/**
 * 弹幕展示配置回归自检（纯函数、离线运行）：
 *
 *   pnpm verify:danmu-display
 */
import {
  DANMU_ANIMATION_OPTIONS,
  DANMU_FONT_OPTIONS,
  DANMU_MESSAGE_ORDER_OPTIONS,
  DANMU_STYLE_PRESETS,
  DEFAULT_DANMU_APPEARANCE,
  DEFAULT_DANMU_BOARD_CONFIG,
  DEFAULT_DANMU_OVERLAY_SETTINGS,
  buildDanmuTextShadow,
  clampInteger,
  clampNumber,
  getDanmuFontStack,
  getDanmuStylePreset,
  hexToRgba,
  isHexColor,
  normalizeDanmuAppearanceConfig,
  normalizeDanmuBoardConfig,
  normalizeDanmuBoardPosition,
  normalizeDanmuOverlaySettings,
  normalizeDanmuStylePresetId,
  normalizeHexColor
} from '../src/shared/danmu-display'

let checks = 0
let failures = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

console.log('\nA. clamp 与颜色工具')
check('clampNumber 限制上下界', clampNumber(9, 0, 1, 0.5) === 1)
check('clampNumber 不接受数字字符串', clampNumber('0.8', 0, 1, 0.5) === 0.5)
check('clampNumber 非有限数回退', clampNumber(Number.NaN, 0, 1, 0.4) === 0.4)
check('clampInteger 四舍五入', clampInteger(12.6, 5, 30, 10) === 13)
check('严格识别 #RRGGBB', isHexColor('#A1b2C3') && !isHexColor('#abc') && !isHexColor('ffffff'))
check('hex 统一小写', normalizeHexColor('#A1B2C3') === '#a1b2c3')
check('非法 hex 使用安全 fallback', normalizeHexColor('red', '#123456') === '#123456')
check('hexToRgba 正确转换', hexToRgba('#ff8040', 0.25) === 'rgba(255, 128, 64, 0.25)')
check('hexToRgba alpha 会 clamp', hexToRgba('#ffffff', 9) === 'rgba(255, 255, 255, 1)')
check(
  'hexToRgba 非法颜色不会注入 CSS',
  hexToRgba('url(javascript:1)', 0.5, '#010203') === 'rgba(1, 2, 3, 0.5)'
)

console.log('\nB. 外观 normalize')
check(
  '默认外观幂等',
  same(normalizeDanmuAppearanceConfig(DEFAULT_DANMU_APPEARANCE), DEFAULT_DANMU_APPEARANCE)
)
{
  const cfg = normalizeDanmuAppearanceConfig({
    fontFamily: 'evil-font',
    fontSize: 999,
    fontWeight: 550,
    textColor: 'red',
    textOpacity: -2,
    usernameColor: '#ABCDEF',
    giftColor: '#xyzxyz',
    backgroundColor: '#000001',
    backgroundOpacity: 4,
    lineHeight: 0.2,
    lineGap: 99,
    shadowStrength: -1,
    borderRadius: 1000,
    animation: 'spin-forever',
    animationDuration: 9999,
    messageOrder: 'random',
    messageLifetimeSec: -5,
    showUsername: 'yes',
    showBadges: 0
  })
  check('非法字体回退', cfg.fontFamily === DEFAULT_DANMU_APPEARANCE.fontFamily)
  check('字号 clamp 到 64', cfg.fontSize === 64)
  check('字重必须来自 allowlist', cfg.fontWeight === DEFAULT_DANMU_APPEARANCE.fontWeight)
  check('颜色非法回退、合法颜色规范化', cfg.textColor === '#f8fafc' && cfg.usernameColor === '#abcdef')
  check('透明度 clamp', cfg.textOpacity === 0 && cfg.backgroundOpacity === 1)
  check('排版数值 clamp', cfg.lineHeight === 1 && cfg.lineGap === 32 && cfg.borderRadius === 48)
  check('阴影强度 clamp', cfg.shadowStrength === 0)
  check(
    '动画非法回退且时长 clamp',
    cfg.animation === DEFAULT_DANMU_APPEARANCE.animation && cfg.animationDuration === 2000
  )
  check(
    '顺序非法回退且生命周期 clamp',
    cfg.messageOrder === DEFAULT_DANMU_APPEARANCE.messageOrder && cfg.messageLifetimeSec === 0
  )
  check('布尔值不做 truthy 转换', cfg.showUsername === true && cfg.showBadges === true)
}
{
  const transparent = getDanmuStylePreset('transparent').appearance
  const cfg = normalizeDanmuAppearanceConfig({ fontSize: 22 }, transparent)
  check('支持 preset 作为 partial patch fallback', cfg.fontSize === 22 && cfg.backgroundOpacity === 0)
}

console.log('\nC. 两端完整配置 normalize')
check(
  '主播端默认值幂等',
  same(
    normalizeDanmuOverlaySettings(DEFAULT_DANMU_OVERLAY_SETTINGS),
    DEFAULT_DANMU_OVERLAY_SETTINGS
  )
)
{
  const cfg = normalizeDanmuOverlaySettings({ maxLines: 1000, showGift: 'false', fontSize: 1 })
  check('主播端 maxLines / fontSize clamp', cfg.maxLines === 100 && cfg.fontSize === 10)
  check('主播端 showGift 严格布尔回退', cfg.showGift === true)
}
check(
  '旧 opacity 死字段不会让透明主播窗升级后突然出现底色',
  normalizeDanmuOverlaySettings({ opacity: 0.85 }).backgroundOpacity === 0
)

check(
  '展示端默认值幂等',
  same(normalizeDanmuBoardConfig(DEFAULT_DANMU_BOARD_CONFIG), DEFAULT_DANMU_BOARD_CONFIG)
)
{
  const legacy = normalizeDanmuBoardConfig({
    enabled: true,
    position: { x: 2, y: 76 },
    maxLines: 10,
    fontSize: 16,
    showGift: true,
    width: 360,
    maxHeightPct: 80
  })
  check(
    '旧展示端配置补齐接近原 CSS 的样式默认值',
    legacy.fontFamily === 'sans' &&
      legacy.textColor === '#e2e8f0' &&
      legacy.usernameColor === '#93c5fd' &&
      legacy.backgroundOpacity === 0.72
  )
}
{
  const cfg = normalizeDanmuBoardConfig({
    enabled: 'true',
    position: { x: -20, y: 100.126 },
    maxLines: 1000,
    showGift: false,
    width: 20,
    maxHeightPct: 999,
    extraCss: 'position:fixed'
  })
  check('展示端 enabled 严格布尔回退', cfg.enabled === false)
  check('position clamp 且保留两位', cfg.position.x === 0 && cfg.position.y === 100)
  check('展示端尺寸 / 条数 clamp', cfg.maxLines === 30 && cfg.width === 240 && cfg.maxHeightPct === 95)
  check('合法 showGift 生效', cfg.showGift === false)
  check('未知字段被丢弃', !('extraCss' in cfg))
}
check(
  'position 非对象回退默认',
  same(normalizeDanmuBoardPosition('bottom-right'), DEFAULT_DANMU_BOARD_CONFIG.position)
)

console.log('\nD. 字体、阴影与选项')
check('字体 stack 命中 allowlist', getDanmuFontStack('mono').includes('Consolas'))
check(
  '非法字体 stack 回退系统字体',
  getDanmuFontStack('url(evil)') === getDanmuFontStack(DEFAULT_DANMU_APPEARANCE.fontFamily)
)
check('阴影强度 0 返回 none', buildDanmuTextShadow(0) === 'none')
check('文字完全透明时不残留描边', buildDanmuTextShadow(1, '#000000', 0) === 'none')
{
  const shadow = buildDanmuTextShadow(1, '#123456')
  check('强阴影生成六层 text-shadow', (shadow.match(/rgba\(/g) ?? []).length === 6, shadow)
  check('强阴影使用 rgba 安全色值', shadow.includes('rgba(18, 52, 86,'))
}
check('字体选项 value 唯一', new Set(DANMU_FONT_OPTIONS.map((x) => x.value)).size === DANMU_FONT_OPTIONS.length)
check(
  '动画选项 value 唯一',
  new Set(DANMU_ANIMATION_OPTIONS.map((x) => x.value)).size === DANMU_ANIMATION_OPTIONS.length
)
check(
  '顺序选项 value 唯一',
  new Set(DANMU_MESSAGE_ORDER_OPTIONS.map((x) => x.value)).size ===
    DANMU_MESSAGE_ORDER_OPTIONS.length
)

console.log('\nE. 三套样式预设')
check('恰好提供三套预设', DANMU_STYLE_PRESETS.length === 3)
check(
  '预设 id 唯一',
  new Set(DANMU_STYLE_PRESETS.map((preset) => preset.id)).size === DANMU_STYLE_PRESETS.length
)
for (const preset of DANMU_STYLE_PRESETS) {
  check(
    `${preset.id} 预设本身可通过 normalize`,
    same(normalizeDanmuAppearanceConfig(preset.appearance), preset.appearance)
  )
}
check('非法 preset id 回退 glass', normalizeDanmuStylePresetId('missing') === 'glass')
{
  const copy = getDanmuStylePreset('glass')
  copy.appearance.fontSize = 63
  check(
    'getDanmuStylePreset 返回可改副本',
    getDanmuStylePreset('glass').appearance.fontSize === DEFAULT_DANMU_APPEARANCE.fontSize
  )
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
