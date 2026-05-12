# resources/

打包资源目录。MVP 阶段还没准备图标。

跳蛛先生需要补：

- `icon.ico` — Windows 应用图标（256×256 推荐，多分辨率 ICO）

补好后回到 `electron-builder.yml`，把 `win.icon` / `nsis.installerIcon` / `nsis.uninstallerIcon` 三行的注释去掉。
