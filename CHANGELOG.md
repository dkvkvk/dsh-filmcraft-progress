# Changelog

## 0.1.0 — 2026-10-14

首个版本。

- Host 插件：注册 HTTP 路由 `/dsh-filmcraft-progress/api/state` 与工具 `filmcraft_progress`
- Client 插件：侧边栏入口 + 浮层面板 + 设置分节（`sidebar.footer.action` / `shell.overlay` / `settings.section`）
- 进度来源：进度契约文件 + 输出文件实时采样（大小、写入速度、ETA、运行状态）
- 面板内容：进度条、已用/剩余时间、写入速度、输出大小、分镜表、成片规格、调色参数、备注
- 附带 `tools/publish.cjs` 用于流水线写入进度
- 进度文件路径支持 `FILMCRAFT_PROGRESS_FILE` 环境变量覆盖
