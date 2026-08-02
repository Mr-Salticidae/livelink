# 更新报告长图 · 生成模板

面向粉丝群（浆pu之家）发布的版本更新长图。体例沿用 pb-arena 的
《项目进展说明_给团队与测试用户》：**全程大白话、按人群说话、
用用户能感知的现象描述而不是技术实现**。

## 怎么用

1. 改 `report.html` 里的文案（版本号、日期、各段内容）。
2. 跑一次渲染：

```bash
# Windows / PowerShell。注意先清掉 ELECTRON_RUN_AS_NODE，
# 否则 Electron 会被当成纯 Node 跑，起不来窗口
[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null)
& .\node_modules\electron\dist\electron.exe .\docs\更新报告模板
```

3. 产物 `out.png` 重命名成 `LiveLink_v<版本>_更新报告.png` 放到 `docs/`。

## 两个已经踩过的坑

- **画布宽度用 750，不要用 1080。** 群里绝大多数人用手机看。1080 宽的图在手机上
  正文会缩到 5px 左右，根本读不了。750 画布配 26px 正文，相当于手机满宽阅读 15px。

- **量高度别用 `Page.getLayoutMetrics().contentSize`。** 它按宿主显示器的 DPI 报
  物理像素（本机 125% 缩放下会多报 25%），当成 CSS 像素套进截图参数，
  图底部会空出一大截。用 `document.documentElement.scrollHeight`，那是纯 CSS 像素。
  脚本里已经顺带检查横向溢出，溢出会打警告。

渲染用的是项目自带的 Electron（内置 Chromium），不需要额外装 playwright。
