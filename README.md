# dsh-filmcraft-progress

> A [DeepSeek Harness](https://github.com/anywhere-labs/deepseek-harness-desktop) plugin that shows
> **live FilmCraft video-editing / colour-grading progress** in the GUI — and lets you do
> **basic cutting without leaving DSH**: trim, delete, reorder, grade, export.

DSH 面板插件：**实时查看 FilmCraft 视频剪辑 / 调色的进度，并直接做基础剪辑**。

右侧栏一个常驻标签，两页：

- **进度** —— 导出百分比、已用时、预计剩余、写入速度、输出大小、片段表、调色参数。
  数据来自本地文件采样，不占用剪辑进程。
- **剪辑** —— 打开 `.fcproj` 工程，**看画面**（单帧预览 / 缩略图 / 预览片段），
  裁头/裁尾、删除、上下移、套调色、撤销、导出。

```
┌──────────────────────────────────────────────────────┐
│ [ 进度 ] [ 剪辑 ]                                    │
│ FilmCraft 剪辑进度                        ● 导出中   │
│ 逐段调色 · 3840×2880 · 33 段素材                     │
├──────────────────────────────────────────────────────┤
│ ████████████████████████░░░░░░░░░░░░░░░░░░░  51.3%   │
│ 按输出文件大小估算                                   │
├──────────────────────────────────────────────────────┤
│ 已用时 54:28 │ 预计剩余 46:40 │ 0.78 MB/s │ 1395/2900 MB │
├──────────────────────────────────────────────────────┤
│ 片段表 (33)  #1 0310 山路 7.6s 已完成                 │
│              #2 0319 海景 8.0s 导出中                 │
│              #3 0322 海景 8.0s 待处理   …             │
└──────────────────────────────────────────────────────┘
```

## 两种模式

任务分两类，面板按 `mode` 字段换版式 —— 它们不是同一件事：

| 模式 | 是什么 | 面板怎么显示 |
|---|---|---|
| `batch` | **逐段调色**：每条素材各自调色、各自导出一个文件 | 「片段表」+ 每段自己的状态（待处理/导出中/已完成/失败）、时长、帧率 |
| `film` | **成片剪辑**：多段剪成一条时间线 | 「分镜表」+ 成片时间码、裁剪标记 |

## 剪辑页

右侧栏面板的第二个标签，用来处理「基本问题」：

### 预览画面

盲剪没有意义，所以剪辑页会显示**调色之后**的画面：

| 位置 | 内容 |
|---|---|
| **主预览** | 选中片段后自动渲染该片段中点的一帧，`4:3` 画框（源片就是 3840×2880） |
| **时间轴** | 滑块拖到片段内任意位置看那一帧（420 ms 防抖），`◀ ▶` 每次 0.5 秒 |
| **缩略图** | 片段列表每行一张，后台**一次渲染一张**慢慢补，不阻塞面板 |
| **预览片段** | 导出 2/3/5/10 秒的真实视频，`<video controls loop>` 播放，可拖进度条 |

渲染走 `filmcraft-cli render`（单帧）和 `export --format h264 --no-audio`（片段），
结果按**工程 mtime** 缓存到磁盘：同一帧第二次是毫秒级，改了工程则自动失效。

> **代价**：单帧是解码+调色决定的，和 `--scale` 几乎无关（实测 0.3–1.8 秒/帧，
> 取决于源文件是否还在系统缓存里）；预览片段约 0.13 秒/帧。所以缩略图必须排队慢慢来 ——
> 33 段一起发就是 45 秒的突发。拖动时间轴时新请求会**合并成只保留最新**，
> 否则每个中间位置都要排一次 1 秒多的渲染。

> **为什么串行**：`filmcraft-cli` 一次调用一个进程，而并发跑同一工程之前产出过损坏
> 文件。host 侧对预览工作加了锁。

### 剪辑操作

| 操作 | 说明 |
|---|---|
| **扫描 / 打开工程** | 扫描配置目录下的 `.fcproj`（默认 `D:\Myfiles\临时`） |
| **裁头 / 裁尾** | ±0.5s / +1s / +3s，波纹模式（自动合拢，不留空隙） |
| **删除** | 波纹删除选中片段 |
| **上移 / 下移** | 与相邻片段交换位置 |
| **套调色** | 海景 / 山路 / 猫 / 中性 / 清空 —— 与批处理流水线同一套参数 |
| **停用 / 启用** | 保留片段但不参与输出 |
| **撤销** | 还原到上一次编辑前的工程快照 |
| **导出** | 选中片段或整条序列，后台跑，回「进度」页看百分比 |

> **为什么撤销用快照**：`filmcraft-cli` 每次调用都是独立进程，撤销栈随进程结束消失，
> `--save` 存的是结果不是历史。所以每次编辑前把工程复制一份到 `snapshots/`
> （保留最近 20 份），撤销即还原最新快照。这比 CLI 自带的 undo 可靠。

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

## 在哪里看

主界面是**右侧栏的一个常驻标签**——它和 DSH 自带的右侧面板并排，**不遮挡主界面**，
用侧栏自己的按钮开关。

| 位置 | 内容 |
|---|---|
| **右侧栏标签**「剪辑进度」 | 完整面板：**进度**页 + **剪辑**页 |
| **左侧栏底部入口** | 点一下打开上面的右侧栏标签；任务运行时直接显示百分比 |
| **设置 → 剪辑进度** | 同一个面板，宽屏版式 |

> 只有当宿主的右侧栏服务（`sidebarRightTabs` / `sidebarRight`）不可用时，才降级为
> **右侧停靠的抽屉**：窄条、**没有全屏遮罩**，`Esc` 或 `×` 关闭。正常情况下面板
> 在 `shell.overlay` 座位上渲染 `null`，不会画任何东西盖住主界面。

## 数据从哪来

面板**不**去问 FilmCraft 要进度（它没有进度接口）。它读一个「进度契约文件」，
再自己从输出文件实时采样算百分比和速度：

```
进度文件 → 项目名 / 阶段 / 镜头表 / 调色参数 / 期望时长
    +
输出 mp4 → 当前字节数、修改时间（推 速度、ETA、是否还在跑）
```

默认路径 `D:\Myfiles\临时\film-status.json`，可用环境变量覆盖：

```
FILMCRAFT_PROGRESS_FILE=D:\别的\地方\film-status.json
```

### 进度契约字段

```jsonc
{
  "mode": "batch",                // batch=逐段调色 | film=成片剪辑（缺省按 film 处理）
  "project": "深圳天文台 · 调色成片",
  "phase": "export",              // idle|plan|import|build|grade|crop|export|done|error
  "phaseLabel": "导出中",
  "message": "软件 H.264 编码",
  "startedAt": "2026-10-14T10:17:19.000Z",
  "expectedMs": 6067000,          // 期望总耗时，用于时间法 ETA
  "export": {
    "path": "D:\\...\\成片.mp4",
    "expectedBytes": 3040870400   // 期望文件大小，用于字节法百分比
  },
  "video":   { "width": 3840, "height": 2880, "fps": 25, "codec": "H.264 High" },
  "timeline":{ "width": 3840, "height": 2880, "fps": 25, "durationSeconds": 224.72, "shotCount": 29 },
  "stats":   { "trail": 9, "sea": 19, "cat": 1 },
  "grades":  { "sea": { "contrast": 30, "...": 0 }, "trail": { "...": 0 } },
  "shots":   [ { "n": 1, "tag": "0310", "cat": "trail", "start": 0, "dur": 6, "crop": false } ],
  "notes":   ["帧率统一 25fps"]
}
```

只有 `project` 和 `export.path` 是必需的。百分比优先用
`bytes / expectedBytes`，没有就退回 `elapsed / expectedMs`。

`mode: "batch"` 时，`shots[]` 每项建议带 `status`（`pending` / `exporting` / `done` / `failed`）
与 `fps`，面板据此画每段自己的状态徽标。

## 怎么写入进度

用自带工具 `tools/publish.cjs`：

```bash
# 开工：从剪辑方案生成完整进度
node tools/publish.cjs start --project "深圳天文台" \
  --out "D:\Myfiles\临时\成片\成片.mp4" \
  --plan "D:\Myfiles\临时\build\plan.json" \
  --width 3840 --height 2880 --fps 25 \
  --expected-bytes 3040870400 --realtime 27

# 阶段流转
node tools/publish.cjs phase grade "正在调色"
node tools/publish.cjs phase export
node tools/publish.cjs done
node tools/publish.cjs error "磁盘空间不足"

# 其它
node tools/publish.cjs note  "0319 已裁剪"
node tools/publish.cjs patch '{"notes":["..."]}'
node tools/publish.cjs show
```

`--plan` 指向剪辑方案 JSON（数组，每项含 `tag` `cat` `tlStart` `dur` `srcIn` `crop`），
`start` 会据此自动生成 `shots` / `stats` / `timeline.durationSeconds`。

## Agent 工具

插件注册了两个工具，Agent 可以直接用：

**`filmcraft_progress`** —— 读同一份进度状态：

```json
{ "ok": true, "percent": 51.3, "etaText": "46:40", "mode": "batch", "shots": [ ... ] }
```

**`filmcraft_edit`** —— 基础剪辑，`action` 取 `projects` / `open` / `apply` / `undo` / `export` / `frame` / `proxy`：

```jsonc
// 看有哪些工程
{ "action": "projects" }

// 打开并列出片段
{ "action": "open", "project": "D:\\...\\final.fcproj" }

// 把第 1 段头部裁掉 1 秒（254016000000 ticks = 1 秒）
{ "action": "apply", "project": "D:\\...\\final.fcproj",
  "commands": [{ "id": "timeline.trim",
                 "params": { "clip": 69, "edge": "in", "mode": "ripple", "delta": 254016000000 } }] }

// 撤销 / 导出
{ "action": "undo", "project": "D:\\...\\final.fcproj" }
{ "action": "export", "project": "D:\\...\\final.fcproj", "out": "D:\\out.mp4", "start": 0, "end": 12 }

// 看画面：渲染第 3 秒的一帧（返回 name，用 /media?name= 取二进制）
{ "action": "frame", "project": "D:\\...\\final.fcproj", "seconds": 3, "scale": 0.25 }

// 导出一段 3 秒预览视频
{ "action": "proxy", "project": "D:\\...\\final.fcproj", "start": 10, "end": 13, "quality": 60 }
```

`apply` 只接受白名单内的命令（剪辑与调色相关），不是 700 条命令的遥控器。

## HTTP 接口

Host 注册了这些路由（面板走同一批）：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/dsh-filmcraft-progress/api/state` | 进度状态 |
| GET | `/dsh-filmcraft-progress/api/projects` | 扫描工程文件 |
| POST | `/dsh-filmcraft-progress/api/open` | 打开工程并列出片段 |
| POST | `/dsh-filmcraft-progress/api/apply` | 执行编辑（白名单） |
| POST | `/dsh-filmcraft-progress/api/undo` | 还原工程快照 |
| POST | `/dsh-filmcraft-progress/api/export` | 后台导出 |
| POST | `/dsh-filmcraft-progress/api/frame` | 渲染一帧画面（PNG） |
| POST | `/dsh-filmcraft-progress/api/proxy` | 导出短预览片段（MP4） |
| GET | `/dsh-filmcraft-progress/api/media?name=<文件>` | 二进制回读画面/视频，支持 Range |

`/media` 只接受**纯文件名**（`^[A-Za-z0-9_.-]{1,80}$`，不含分隔符），从预览目录里读；
路径穿越、绝对路径一律 400，文件不存在 404。`<video>` 拖动进度条依赖它返回 206。

可用环境变量覆盖：`FILMCRAFT_CLI`（CLI 路径）、`FILMCRAFT_ROOTS`（扫描根目录，`;` 分隔）、
`FILMCRAFT_EXPORT_DIR`、`FILMCRAFT_LOG_DIR`、`FILMCRAFT_PROGRESS_FILE`、
`FILMCRAFT_PREVIEW_DIR`（预览缓存目录，默认 `<LOG_DIR>\preview`，保留最近 120 个文件）。

## 设计要点

- **两个界面、一个降级**：优先注册官方右侧栏标签（`sidebar.right.pane.tab`），
  拿不到服务时退回非模态抽屉。座位回调里要**短轮询** `ctx.get('sidebarRightTabs')` /
  `ctx.get('sidebarRight')`——座位声明早于服务就绪，启动竞态下直接取会拿到 `undefined`。
- **单一轮询源**：侧栏入口、右侧栏标签、抽屉、设置页共用一个 2 秒轮询，不是四份。
- **不阻塞剪辑**：只做 `readFileSync` / `statSync`，不起子进程。
- **首轮 rate 为空**：速度需要两次采样才能算，第二次轮询后才有值。
- **`running` 判定**：输出文件 30 秒内被写过即视为运行中；完成后自动转「已完成」。
- **主进程/客户端分离**：Host 注册 HTTP 路由 `/dsh-filmcraft-progress/api/state`，
  Client 用 `slots` 挂 UI —— 和 `dsh-agent-ssh-dashboard` 同一套模式。
- **二进制走 `raw` 路由**：画面/视频以二进制从 `/media` 返回，不是 base64 塞进 JSON。
  `scripts/build-native.mjs` 的 `ROUTES` 表每项是 `[key, method, path, kind]`，
  `kind` 取 `json` 或 `raw`；`raw` 路由原样拿到 `(req, res)` 自己写响应。
  注意 `harness.handle` 不能把 raw 路由也包成 `(body) => handler(body || {})` ——
  那样 `res` 会是 `undefined`（0.2.2 踩过，`/media` 直接 500）。
- **预览缓存的键是「工程 mtime + 时间点 + 缩放」**：不引入文件监听，
  改了工程 mtime 自然变化，旧帧自动不可达，再由 `prunePreview()` 保留最近 120 个。

## 重新构建

```bash
node scripts/build-native.mjs
```

把 `src/dynamic/{host,client}.js` 打包成 `dist/native/{index.js,client.js}`。
Host 侧由构建脚本注入 `node:fs` 导入和 HTTP 路由外壳；Client 侧包成
`window.__ModuleLoader__.load({...})`。

## 排错

| 现象 | 原因 |
|---|---|
| 侧边栏没有入口 | profile bundles 未登记 / 未 `pnpm install` / 刷新页面 |
| 右侧栏找不到「剪辑进度」标签 | 宿主的右侧栏服务不可用，此时走抽屉降级（点左侧栏底部入口） |
| 面板显示「当前没有进行中的剪辑任务」 | 进度文件不存在，或路径不对（看面板底部显示的路径） |
| 百分比一直 `—` | `expectedBytes` 和 `expectedMs` 都没给，或输出文件还没生成 |
| 速度一直 `—` | 只轮询过一次，等一轮 |
| 任务已完成但显示「导出中」 | 输出文件仍在被写；30 秒无写入会自动转「已完成」 |
| **分镜表是空的/只剩细横条** | `.fc-shot` 缺 `flex-shrink: 0`，被纵向 flex 容器压扁（0.2.0 已修） |
| **预览区一直「渲染中…」** | 源文件不在系统缓存里时单帧要 1–2 秒；连续失败看是不是 `FILMCRAFT_CLI` 路径不对 |
| **缩略图显示 `×`** | 该帧渲染失败，鼠标悬停片段行看 title；多半是源文件被移动或删除 |
| **预览视频拖不动进度条** | `/media` 的 Range 支持被破坏（0.2.2 起支持 206） |
| **预览画面占满整屏** | 预览框曾按面板宽度撑高（0.2.3 改为定高 + 4:3 反推宽度）；也可点「收起画面」 |
| **面板底部的内容够不着** | 宿主的面板体不滚，面板自己按视口剩余高度滚动（0.2.4）。若仍不行，说明取不到 `window.innerHeight` |
| **「剪辑」页报「unsupported call」或 404** | Host 侧改了路由，**必须重启 DSH**（宿主进程内加载，刷新页面不够） |
| **编辑后画面还是旧的** | 缓存键含工程 mtime，若工程被外部程序改写而 mtime 未变，等 1 秒再刷新 |

> **改了 `src/dynamic/host.js` 之后要重启 DSH**：host 插件在宿主进程内被 import，
> 没有热重载 API，`patchReload: live` 也不会重新 import 模块。改 client 侧刷新页面即可。

## License

[MIT](./LICENSE)
