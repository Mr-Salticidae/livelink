// HTML → 长图 PNG。沿用 pb-arena/ui-proposals/export-proposals.cjs 的思路
// （无头浏览器截整页），这里用 Electron 自带的 Chromium，免装 playwright。
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const HTML = path.join(__dirname, 'report.html')
const OUT = path.join(__dirname, "out.png")
const WIDTH = 750
const SCALE = 2 // 2 倍图，文字锐利

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: 1200,
    webPreferences: { offscreen: true }
  })
  await win.loadFile(HTML)
  await new Promise((r) => setTimeout(r, 1200)) // 等字体落位

  const dbg = win.webContents.debugger
  dbg.attach('1.3')

  // 必须先把视口宽度定死再量高度：窗口自身的宽度未必等于 1080，
  // 在错误宽度下量出来的高度套到 1080 上，图底部会多出一大片空白
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: 1200,
    deviceScaleFactor: SCALE,
    mobile: false
  })
  await new Promise((r) => setTimeout(r, 500))

  // 不能用 Page.getLayoutMetrics().contentSize —— 它按宿主显示器的 DPI
  // 报物理像素（本机 1.25 倍缩放下会多报 25%），当成 CSS 像素用会让图底部空一大截。
  // scrollHeight 是纯 CSS 像素，与 DPI 无关
  const { result } = await dbg.sendCommand('Runtime.evaluate', {
    expression: 'JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})',
    returnByValue: true
  })
  const m = JSON.parse(result.value)
  const height = Math.ceil(m.h)
  console.log(`content ${m.w} x ${height} (CSS px)`)
  if (m.w > WIDTH) console.warn(`⚠ 横向溢出 ${m.w - WIDTH}px，右侧会被裁掉`)

  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height,
    deviceScaleFactor: SCALE,
    mobile: false
  })
  await new Promise((r) => setTimeout(r, 600))

  const shot = await dbg.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true
  })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  const b = fs.readFileSync(OUT)
  console.log(`saved ${OUT}  ${b.readUInt32BE(16)}x${b.readUInt32BE(20)}  ${(b.length / 1048576).toFixed(2)}MB`)

  dbg.detach()
  app.quit()
})
