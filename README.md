# dsh-filmcraft-progress

> A generic [DeepSeek Harness](https://github.com/anywhere-labs/deepseek-harness-desktop) plugin for
> **FilmCraft video editing** — many projects, many sequences, per-clip processing, and merging
> several videos into one timeline, all from a docked sidebar tab.

DSH 面板插件：**通用 FilmCraft 剪辑台**。不是一个项目专用的脚本，而是一层「工程 / 序列 / 素材 /
片段 / 任务」的通用模型 —— 换项目、换机器、换素材目录都不用改代码。

右侧栏一个常驻标签，五页：

| 页 | 干什么 |
|---|---|
| **项目** | 注册表里所有 `.fcproj`：打开、重新扫描、登记已有、新建、移除 |
| **剪辑** | 打开工程后的工作区：序列、画面预览、片段表、裁切/排序/停用/删除、单段与**批量**调色、素材导入与放置、导出 |
| **合并** | 把 N 段素材排成一列 → 建成新工程/新序列（或并进当前工程），可选合并完直接出片 |
| **任务** | 导出任务队列：百分比、已用时、剩余、写入速度、取消、清记录 |
| **设置** | 工作区目录、CLI 路径、调色预设增删、路径与版本信息 |

```
┌────────────────────────────────────────────────────┐
│ [ 项目 ] [ 剪辑 ] [ 合并 ] [ 任务 ] [ 设置 ]        │
│ 工程 12   缺失 0   任务 1   版本 0.3.0              │
│ 工作区：D:\Myfiles\FilmCraft                        │
├────────────────────────────────────────────────────┤
│ 工程 (12)                                          │
│ [重新扫描] [+ 登记已有工程] [+ 新建工程]            │
│ ┌────────────────────────────────────────────────┐ │
│ │ ● 深圳天文台          1.4 MB · 3 小时前         │ │
│ │   品牌片合集          820 KB · 昨天             │ │
│ │   合并工程            1.1 MB · 刚刚             │ │
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

## 为什么是「重构」而不是加功能

0.2.x 是给**某一个项目**写的：工程路径、导出目录、四套调色配方、预览的 4:3 比例、
只认 `V1` 一条轨、一个全局状态文件（同时只能有一个任务）—— 全部写死在代码里。

0.3.0 把这些全部换成数据：

| 0.2.x 写死的东西 | 0.3.0 变成 |
|---|---|
| `STATUS_PATH` 一个状态文件 | 任务注册表，N 个任务，各有 id / 状态 / 进度 |
| 工程路径常量 | 工程注册表（id ↔ 文件），可增删、可换工作区 |
| 一个工程 = 一支片 | 工程内 `sequences[]` + 当前序列，导出/预览都带序列 id |
| 没有素材层 | 素材表：路径、在线状态、指纹、宽高、帧率、代理 |
| 四个写死的调色配方 | 预设系统：内置只读 + 自定义可存可删 |
| 4:3 预览 | 预览按素材真实宽高比 |
| 只认第一条视频轨 | 所有视频轨 + 音频轨，带 `V1/A1` 标签 |
| 逐条 move 拼坐标做「合并」 | 一等的合并操作：按数组顺序一次落位，算一个 undo |

## 合并是怎么做的

**引擎没有 concat/append 命令，机器上也没有 ffmpeg**，所以「合并」不是拼文件，而是：

```
导入 N 段素材 → file.newSequence → timeline.place{items:[...], track:'V1', audioTrack:'A1', time:0}
```

`timeline.place` 按**数组顺序**首尾相接、音视频联动，并且是**一个 undo 步**。合并的可编辑性
是文档层的事实：源素材、入点、时长都还在时间线上，随时能改。成片靠导出渲染 —— 这是唯一
诚实的做法，`copy /b` 那种拼法会毁掉 moov atom。

合并前会做**兼容性预检**：把每段素材的宽高和帧率与目标序列比一遍，不一致就提前告诉你
「X 段素材尺寸不同，导出时会被缩放或补边」「Y 段帧率不同，将被重采样」—— 而不是等你渲染完
才发现画面被裁了。

想把合并结果交给别的剪辑软件继续做，用 `project.write{action:'exportInterchange'}` 导出
EDL / FCP7 XML / FCPXML / OTIO / AAF —— 渲染好的 mp4 里没有剪切点，工程文件才有。

## 安装

DSH 的插件装在 profile 里（桌面端 profile 名是 `desktop`）。两步：**加依赖 + 登记 bundle**，
然后跑宿主自带的 pnpm。

```bash
# 1) 在 profile 目录里加依赖（<profile> = ~/.dsh/profiles/desktop）
#    用 git 安装：
#      "dsh-filmcraft-progress": "github:dkvkvk/dsh-filmcraft-progress"
#    或本地开发用 link：
#      "dsh-filmcraft-progress": "link:<仓库绝对路径>"

# 2) 把【包名】加进 package.json 的 dsh.profile.bundles 数组
#    注意：写包名，不是 cordis.patch.yml 里的 insert.id

# 3) 安装（用宿主自带的 node + pnpm）
node "<DSH>/resources/runtime/pnpm/bin/pnpm.cjs" install
```

`bundles` 里必须写 **package name**（`dsh-filmcraft-progress`），不能写
`cordis.patch.yml` 里的 `insert.id`（`filmcraft-progress`）—— 这是最容易踩的坑。

装完 **刷新页面** 即可看到侧边栏入口（新 bundle 由宿主的 `patchReload: live` 热加载；
若没出现再重启 DSH）。

> 本仓库的 `dist/` 是**提交进版本库**的，所以从 git 安装不需要自己构建。

### 宿主端与客户端要分开重启

这是 0.3.0 开发中最耽误时间的一处：

| 改了什么 | 怎么生效 |
|---|---|
| `src/client/**`（面板界面） | 刷新网页 |
| `src/host/**`（工具、路由、引擎调用） | **必须重启 DSH** —— 宿主端是在宿主进程里跑的，热加载管不到 |
| `scripts/build-native.mjs` | 先 `npm run build`，再按上面两行 |

## 在哪里看

主界面是**右侧栏的一个常驻标签**——它和 DSH 自带的右侧面板并排，**不遮挡主界面**，
用侧栏自己的按钮开关。

| 位置 | 内容 |
|---|---|
| **右侧栏标签**「剪辑」 | 完整面板：项目 / 剪辑 / 合并 / 任务 / 设置 |
| **左侧栏底部入口** | 点一下打开上面的右侧栏标签；有任务在跑时直接显示百分比 |
| **设置 → 剪辑** | 同一个面板，宽屏版式 |

> 只有当宿主的右侧栏服务（`sidebarRightTabs` / `sidebarRight`）不可用时，才降级为
> **右侧停靠的抽屉**：窄条、**没有全屏遮罩**，`Esc` 或 `×` 关闭。正常情况下面板
> 在 `shell.overlay` 座位上渲染 `null`，不会画任何东西盖住主界面。

## 数据放在哪

工作区默认 `D:\Myfiles\FilmCraft`（可换，见下表），结构：

```
<root>/
  workspace.json     工程注册表 + 预设 + 设置
  projects/          合并时新建的工程
  exports/           导出成片
  jobs/<id>.json     任务记录（重启后仍在）
  snapshots/         每次编辑前的工程快照（撤销用，保留最近 20 个）
  work/              日志、渲染校准数据
  previews/          预览帧与短预览片段（保留最近 240 个）
```

覆盖方式：`~/.dsh/filmcraft-progress/config.json` 里的 `root` / `cliPath` / `scanDepth`，
或在面板「设置」页直接改。

首次运行会把旧版目录 `D:\Myfiles\临时` 里的 `.fcproj` **一次性**登记进注册表，之后不再读写
那个目录（除了只读地展示旧版状态文件）。

## Agent 工具

两个工具，都在宿主侧注册：

### `filmcraft_progress`

查看导出/渲染的实时进度：任务队列（百分比、已用时、预计剩余、输出大小与速度）+ 旧版状态
文件（如果有）。唯一能**主动采样**进度的入口。

### `filmcraft_edit`

一个工具 16 个 action：

| action | 用途 |
|---|---|
| `workspace` | 工作区、路径、预设、计数 |
| `projects` | 工程列表 |
| `open` | 打开并返回工程详情（序列、素材、片段、效果） |
| `assets` | 工程素材（含在线状态、指纹、宽高、帧率） |
| `browse` | 浏览目录（返回子目录、可导入文件、`.fcproj`） |
| `import` | 导入素材到工程（`place:true` 则同时建序列并落位） |
| `sequence` | 激活/新建/删除/重命名序列 |
| `merge` | **合并**：`sources:[{item|file}]` 按顺序拼成新序列（可 `create:{name}` 建新工程） |
| `apply` | 执行白名单命令（`dryRun:true` 只返回将要执行的命令） |
| `grade` | 套调色预设（`clear:true` 清空） |
| `undo` | 撤销一步（回到上一个快照） |
| `export` | 导出（后台任务，返回 job id） |
| `jobs` | 任务列表 |
| `cancel` | 取消任务 |
| `frame` | 渲染单帧 PNG |
| `proxy` | 渲染短预览片段 |

## HTTP 接口

22 条路由，前缀 `/dsh-filmcraft-progress/api`：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/state` | 旧版状态文件（只读兼容） |
| GET/POST | `/workspace` | 工作区；`setRoot` / `setCli` / `updateSettings` / `seedLegacy` |
| GET/POST | `/projects` | 工程列表；`add` / `remove` / `rename` / `rescan` |
| GET/POST | `/project` | 工程详情；`activate` / `createSequence` / `deleteSequence` / `renameSequence` / `exportInterchange` |
| GET | `/assets` | 工程素材 |
| GET | `/browse` | 目录浏览 |
| POST | `/presets` | `save` / `remove` / `reset` |
| POST | `/import` | 导入素材；`place:true` 放置 |
| POST | `/sequence` | `create` / `activate` / `delete` / `rename` |
| POST | `/merge` | 合并 |
| POST | `/edit` | 白名单命令 |
| POST | `/grade` | 调色 |
| POST | `/undo` | 撤销 |
| POST | `/export` | 导出任务 |
| GET/POST | `/jobs` | 任务列表；`cancel` / `remove` |
| POST | `/frame` | 单帧 |
| POST | `/proxy` | 短预览 |
| GET | `/media` | 预览产物（支持 Range） |

## 设计要点

- **时间一律整数 tick**（`254016000000` = 1 秒）。浮点秒会在拼接处累积漂移。
- **只用 id 引用，不用下标**。片段、序列、素材全都带 id；「第 N 个片段」这种引用在
  ripple/insert 后会指错人。
- **编辑 = 一条命令数组 = 一个 undo 步**。超 250 条自动分块，每块仍是独立 undo 步。
- **导出永远串行**。并发渲染会写坏同一个输出文件；预览渲染也走单条 Promise 链。
- **ETA 算不出就返回 `null`**，面板显示「进度未知」，不编数字。导出速度靠自校准
  （记录每帧真实耗时，按 `scale²` 归一化）。
- **宿主端不阻塞**。编辑用 `spawnSync`（天然串行），导出和预览用异步 `spawn`。
- **子进程输出必须写真实 fd**。宿主进程里 `spawnSync` 的 piped stdio 会 `EPERM`，
  所以日志走 `openSync(logFile,'w')` 拿到 fd 再传进去。
- **白名单命令必须对着 `filmcraft-cli commands --json` 核过**。0.2.5 的白名单里
  33 条有 14 条是不存在的命令 id（`edit.extract`、`clip.toggleEnabled`、`marker.add`…），
  改之前先跑一遍命令表。

## 重新构建

```bash
npm run build     # = node scripts/build-native.mjs
```

构建把 `src/host/*.js` 和 `src/client/*.js` **按文件名编号顺序**拼成一个函数体，所以模块里：

- 不能有 `import` / `export`
- 不能有重复的顶层名
- 客户端模块顶层**不能碰 `ctx`**（它只在 `apply(ctx)` 里存在）—— 这条踩过一次，
  表现是整个 web 启动失败并弹「应用无法启动或已意外停止」

宿主端能直接用的注入名只有一组 fs / spawn 函数（见 `00-context.js` 顶部注释），
**没有 `node:path`、`node:os`**，路径工具是手写的。

## 排错

| 现象 | 原因 |
|---|---|
| 面板不出现 | `dsh.profile.bundles` 里写成了 `insert.id`，应写包名 |
| 「应用无法启动或已意外停止」 | 客户端模块顶层碰了 `ctx`；`node test-client.mjs` 第一条断言会抓到 |
| 改了宿主端没反应 | 宿主端需要**重启 DSH**，刷网页不够 |
| 所有片段 fps 显示 `?` | 引擎返回的是 `settings.frame_rate:{num,den}`，不是 `settings.fps` |
| 编辑报「命令不存在」 | 命令 id 没对着 `commands --json` 核 |
| 合并出来画面被裁/补边 | 看「合并」页的兼容性预检，尺寸不一致会提前警告 |
| 预览一直转圈 | 预览是串行渲染；等前一个渲完，或调低缩放 |

## 测试

```bash
node test-client.mjs                  # 无浏览器渲染面板，驱动按钮，断言发给宿主的请求
node test/smoke-host.mjs              # 只读：工作区、工程列表、工程详情、目录浏览
node test/smoke-host.mjs --write      # 追加：合并 → 调色 → 导出 → 单帧 → 撤销（会真的渲染，慢）
```

`test-client.mjs` 的第一条断言是「模块能 import 且导出 apply」—— 0.2.5 的启动崩溃
就是因为这条没人测。`smoke-host.mjs` 走的是真实 HTTP 路由，不是直接调内部函数。

## License

MIT
