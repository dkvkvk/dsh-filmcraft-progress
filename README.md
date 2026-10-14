# dsh-filmcraft-progress

> A [DeepSeek Harness](https://github.com/anywhere-labs/deepseek-harness-desktop) plugin that shows
> **live FilmCraft video-editing / colour-grading progress** in the GUI — a sidebar entry, a floating
> panel and a settings section. It reads a local status file plus live sampling of the output file,
> so it never touches the encoder process.

DSH 面板插件：**实时查看 FilmCraft 视频剪辑 / 调色的进度**。

侧边栏一个入口 + 浮层面板 + 设置页，显示导出百分比、已用时、预计剩余、写入速度、
输出大小、分镜表、调色参数。数据全部来自本地文件采样，不占用剪辑进程。

```
┌──────────────────────────────────────────────────────┐
│ FilmCraft 剪辑进度                        ● 导出中   │
│ 深圳天文台 · 调色成片 · 3840×2880 · 25fps · 29 个镜头│
├──────────────────────────────────────────────────────┤
│ ████████████████████████░░░░░░░░░░░░░░░░░░░  51.3%   │
│ 按输出文件大小估算                                   │
├──────────────────────────────────────────────────────┤
│ 已用时 54:28 │ 预计剩余 46:40 │ 0.78 MB/s │ 1395/2900 MB │
├──────────────────────────────────────────────────────┤
│ 分镜表 (29)  #1 0310  #2 0313  …  #10 0319[裁]  …     │
│ 成片规格     调色参数     备注                        │
└──────────────────────────────────────────────────────┘
```

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

| 位置 | 内容 |
|---|---|
| **侧边栏底部** | 「剪辑进度」入口，任务运行时直接显示百分比 |
| **点它 → 浮层** | 完整面板（进度条 / 统计 / 分镜 / 调色） |
| **设置 → 剪辑进度** | 同一个面板作为设置分节 |

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

插件同时注册了工具 **`filmcraft_progress`**，Agent 可以直接读同一份状态：

```json
{ "ok": true, "percent": 51.3, "etaText": "46:40", "shots": [ ... ] }
```

## 设计要点

- **单一轮询源**：侧边栏、浮层、设置页共用一个 2 秒轮询，不是三份。
- **不阻塞剪辑**：只做 `readFileSync` / `statSync`，不起子进程。
- **首轮 rate 为空**：速度需要两次采样才能算，第二次轮询后才有值。
- **`running` 判定**：输出文件 30 秒内被写过即视为运行中；完成后自动转「已完成」。
- **主进程/客户端分离**：Host 注册 HTTP 路由 `/dsh-filmcraft-progress/api/state`，
  Client 用 `slots` 挂 UI —— 和 `dsh-agent-ssh-dashboard` 同一套模式。

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
| 面板显示「当前没有进行中的剪辑任务」 | 进度文件不存在，或路径不对（看面板底部显示的路径） |
| 百分比一直 `—` | `expectedBytes` 和 `expectedMs` 都没给，或输出文件还没生成 |
| 速度一直 `—` | 只轮询过一次，等一轮 |
| 任务已完成但显示「导出中」 | 输出文件仍在被写；30 秒无写入会自动转「已完成」 |

## License

[MIT](./LICENSE)
