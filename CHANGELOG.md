# Changelog

## 0.2.0 — 2026-10-14

**两种任务模式 + 面板里直接剪片。**

### 修

- **分镜表空白**：`.fc-shots` 是带 `max-height` 的纵向 flex 容器，而 `.fc-shot`
  没写 `flex-shrink: 0`，所有行被压扁到几像素、文字被裁掉。补上 `flex: 0 0 auto`。
- **短文件名吃掉片段编号**：`DJI_<时间戳>_<编号>_D.MP4` 被正则削成 `D`，改为只削
  前缀，保留编号。

### 加

- **两种模式**：`mode: "batch"`（逐段调色，每段独立导出）与 `mode: "film"`
  （多段剪成一条成片）。进度契约新增 `mode` 字段，面板据此换版式——
  逐段模式显示「片段表 + 每段状态（待处理/导出中/已完成/失败）」，
  成片模式才显示成片时间码。
- **剪辑页**（右侧栏面板内的「剪辑」标签）：
  - 扫描并打开 `.fcproj` 工程，列出片段（名称、时长、是否已调色）
  - **裁头 / 裁尾**（±0.5s / +1s / +3s，波纹模式）
  - **删除**（波纹删除，自动合拢）
  - **上移 / 下移**
  - **套用调色预设**（海景 / 山路 / 猫 / 中性 / 清空），与批处理流水线同一套参数
  - **停用 / 启用**片段
  - **撤销**（见下）
  - **导出**选中片段或整条序列（后台运行，进度页看百分比）
- Host 新增路由：`GET /api/projects`、`POST /api/open`、`POST /api/apply`、
  `POST /api/undo`、`POST /api/export`；新增工具 `filmcraft_edit`。
- 构建脚本支持 POST 路由与 JSON 请求体，并注入 `spawnSync` / `spawn`。

### 设计取舍

- **撤销用文件快照，不用 CLI 的 undo**：`filmcraft-cli` 每次调用都是独立进程，
  撤销栈随进程结束消失，`--save` 存的是结果不是历史。所以每次编辑前把工程复制
  一份到 `snapshots/`（保留最近 20 份），撤销即还原最新快照。
- **写操作走白名单**：`/api/apply` 只接受剪辑相关的二十余条命令，
  不让面板变成 700 条命令的遥控器。
- **导出在后台**：`spawn(detached)` + `unref()`，请求立刻返回 PID，
  不占住 HTTP 连接。

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
