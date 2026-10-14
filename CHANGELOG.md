# Changelog

## 0.1.1 — 2026-10-14

**界面改为不遮挡主界面。**

- 新增官方**右侧栏标签** `sidebar.right.pane.tab`（`kind: filmcraft-progress`），
  与 DSH 自带右侧面板并排，由侧栏自身的按钮开关
- 移除全屏浮层：`shell.overlay` 现在只在右侧栏服务不可用时兜底，且降级为
  **非模态右侧抽屉**（窄条、无遮罩、`Esc` / `×` 关闭）；正常情况下渲染 `null`
- 侧栏底部入口改为**打开右侧栏标签**，不再弹出遮罩层
- 座位回调内对 `sidebarRightTabs` / `sidebarRight` 做短轮询，处理启动竞态

## 0.1.0 — 2026-10-14

首个版本。

- Host 插件：注册 HTTP 路由 `/dsh-filmcraft-progress/api/state` 与工具 `filmcraft_progress`
- Client 插件：侧边栏入口 + 浮层面板 + 设置分节（`sidebar.footer.action` / `shell.overlay` / `settings.section`）
- 进度来源：进度契约文件 + 输出文件实时采样（大小、写入速度、ETA、运行状态）
- 面板内容：进度条、已用/剩余时间、写入速度、输出大小、分镜表、成片规格、调色参数、备注
- 附带 `tools/publish.cjs` 用于流水线写入进度
- 进度文件路径支持 `FILMCRAFT_PROGRESS_FILE` 环境变量覆盖
