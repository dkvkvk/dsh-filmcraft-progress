// ── tools ───────────────────────────────────────────────────────────────────
// Editor vocabulary on top of the host modules. Rules every write tool follows:
//
//   · ids, never indices; times in seconds or timecode, snapped to frames
//   · dry_run:true validates and returns the exact engine commands, no write
//   · one cross-process lock + one snapshot per call → one filmcraft_undo
//   · atomic by default: any failed command restores the snapshot
//   · the reply carries a before/after diff, so the agent can verify itself
//
// High-level tools only send parameter shapes that the panel already sends and
// that were exercised against a real engine (trim / move / rippleDelete /
// enable / place / effects.*). For razor, slip, slide, roll, speed, markers and
// the rest, call filmcraft_describe_commands first, then filmcraft_apply.

const MCP_TOOLS = []
const T_TIME = { type: ['number', 'string'], description: '秒（12.5）、"12.5s"、帧（"30f"）、时间码（"00:00:12:12"）或 "1:02.5"' }
const T_PROJECT = { type: 'string', description: '工程 id（filmcraft_list_projects）或 .fcproj 绝对路径' }
const T_DRY = { type: 'boolean', description: 'true = 只校验并返回将执行的引擎命令，不改工程' }
const T_ATOMIC = { type: 'boolean', description: '默认 true：任一命令失败就整体回滚到执行前' }

function mcpTool(name, title, description, properties, required, hints, run) {
  MCP_TOOLS.push({
    name: name,
    write: hints.readOnlyHint !== true,
    spec: {
      name: name,
      title: title,
      description: description,
      inputSchema: { type: 'object', properties: properties, required: required, additionalProperties: false },
      annotations: Object.assign({ title: title, openWorldHint: false }, hints),
    },
    run: run,
  })
}
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const DANGER = { readOnlyHint: false, destructiveHint: true, idempotentHint: false }

function mcpState() {
  const config = mcpConfig()
  return { config: config, registry: loadRegistry(config) }
}
function mcpResolve(config, registry, ref) {
  if (typeof ref === 'string' && (/\.fcproj$/i.test(ref) || ref.indexOf('/') >= 0 || ref.indexOf('\\') >= 0)) {
    mcpGuardPath(config, registry, ref, '工程路径')
  }
  return resolveProject(registry, ref)
}
function mcpDetail(config, file) { return projectDetail(config, file, { force: true }) }
function mcpClip(sequence, id) {
  const n = Number(id)
  for (const clip of sequence.clips) if (clip.clip === n) return clip
  throw new Error('序列里没有片段 ' + String(id) + '（先用 filmcraft_get_timeline 取 id）')
}
function mcpTrack(sequence, ref) {
  for (const kind of ['video', 'audio']) {
    for (const track of sequence.tracks[kind]) {
      if (track.label.toLowerCase() === String(ref).toLowerCase() || track.id === ref) return track
    }
  }
  throw new Error('没有轨道 ' + String(ref) + '（可用 V1/V2/A1…）')
}
function mcpIds(list, what) {
  if (!Array.isArray(list) || list.length === 0) throw new Error((what || 'clips') + ' 不能为空')
  return list.map((value) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n <= 0) throw new Error('无效的片段 id: ' + String(value))
    return n
  })
}

function mcpMutate(args, label, build) {
  const state = mcpState()
  const config = state.config
  const project = mcpResolve(config, state.registry, args.project)
  const plan = () => {
    const before = mcpDetail(config, project.file)
    if (!before.sequence) throw new Error('工程里没有激活的序列')
    const steps = guardCommands(build(before.sequence, before))
    return { before: before, steps: steps }
  }
  if (args.dry_run === true) {
    const planned = plan()
    return {
      ok: true, dryRun: true, action: label, commands: planned.steps.length, planned: planned.steps,
      note: 'FilmCraft 引擎没有预演模式：这里只保证命令合法、片段存在、时间已对齐到帧，不预测结果时间线。',
    }
  }
  return withProjectLock(config, project.file, 'mcp', () => {
    const planned = plan()
    const snapshot = snapshotTake(config, project.file)
    if (args.operation && !snapshot) throw new Error('无法建立撤销快照，尚未修改工程')
    const run = runSteps(config, project.file, planned.steps)
    let rolledBack = false
    if (run.failed.length > 0 && args.atomic !== false && snapshot) {
      rolledBack = snapshotUndo(config, project.file).ok === true
      projectInvalidate(project.file)
    }
    const after = mcpDetail(config, project.file)
    return {
      ok: run.failed.length === 0,
      action: label,
      commands: planned.steps.length,
      failed: run.failed,
      rolledBack: rolledBack,
      undo: rolledBack ? '已自动回滚，工程未改变' : (snapshot ? '可用 filmcraft_undo 撤销这一步' : '未能建立快照，无法撤销'),
      changes: mcpDiff(planned.before.sequence, after.sequence),
    }
  })
}

// Locks for the host helpers that snapshot by themselves (import, grade…).
function mcpLocked(args, fn) {
  const state = mcpState()
  const project = mcpResolve(state.config, state.registry, args.project)
  return withProjectLock(state.config, project.file, 'mcp', () => fn(state.config, state.registry, project))
}

// ── discovery ───────────────────────────────────────────────────────────────
mcpTool('filmcraft_status', 'FilmCraft 状态',
  '检查环境：filmcraft-cli 是否可用、工作区、已登记工程数、正在运行的导出、允许访问的目录、是否只读。开始剪辑前先调用。',
  {}, [], READ, () => {
    const { config, registry } = mcpState()
    jobRefresh(config, registry)
    const jobs = jobList(config)
    return {
      ok: isFile(config.cliPath),
      version: PLUGIN_VERSION,
      cli: { path: winPath(config.cliPath), exists: isFile(config.cliPath) },
      workspace: winPath(config.root),
      projects: registry.projects.length,
      runningJobs: jobs.filter((job) => job.state === 'running').map((job) => ({ id: job.id, out: job.display || job.out })),
      allowedRoots: mcpRoots(config, registry).map(winPath),
      readOnly: mcpReadOnly(),
      timebase: { ticksPerSecond: TICKS_PER_SECOND },
      hint: isFile(config.cliPath) ? '' : '找不到 filmcraft-cli：在面板「设置」里指定，或设置环境变量 FILMCRAFT_CLI',
    }
  })

mcpTool('filmcraft_list_projects', '工程列表',
  '列出已登记的 FilmCraft 工程（id、名称、路径、是否存在、保存时间）。rescan=true 会扫描工作区把新 .fcproj 登记进来。',
  { rescan: { type: 'boolean' } }, [], { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, (args) => {
    const { config, registry } = mcpState()
    let added = 0
    if (args.rescan === true) {
      for (const entry of scanProjects(pathsOf(config.root).root, num(config.scanDepth, 4))) {
        if (projectAdd(config, registry, entry.file, { name: entry.name }).added) added += 1
      }
      if (added > 0) saveRegistry(config, registry)
    }
    return { ok: true, added: added, projects: projectSummaries(config, registry).map((p) => ({ id: p.id, name: p.name, path: p.display, exists: p.exists, savedAt: p.savedAt, tags: p.tags })) }
  })

mcpTool('filmcraft_register_project', '登记工程',
  '把一个已有的 .fcproj 登记进工程列表（不改工程内容）。',
  { file: { type: 'string', description: '.fcproj 绝对路径' }, name: { type: 'string' } }, ['file'],
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, (args) => {
    const { config, registry } = mcpState()
    const file = mcpGuardPath(config, registry, args.file, '工程路径')
    const result = projectAdd(config, registry, file, { name: args.name })
    saveRegistry(config, registry)
    return { ok: true, added: result.added, project: { id: result.project.id, name: result.project.name, path: winPath(result.project.file) } }
  })

mcpTool('filmcraft_get_timeline', '读取时间线',
  '读取工程与激活序列的完整时间线：每条轨道上的片段 id、起止（秒/时间码/帧）、源入出点、速度、启用、联动、效果。传 sequence 会先切换激活序列（会保存工程）。所有剪辑都用这里返回的片段 id。',
  { project: T_PROJECT, sequence: { type: 'number', description: '要查看的序列 id（可选）' }, include_assets: { type: 'boolean' }, include_empty_tracks: { type: 'boolean' } },
  ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    let detail = mcpDetail(config, project.file)
    if (typeof args.sequence === 'number' && (!detail.sequence || detail.sequence.id !== args.sequence)) {
      if (mcpReadOnly()) throw new Error('只读模式下不能切换激活序列（切换会保存工程）')
      detail = withProjectLock(config, project.file, 'mcp', () => projectActivateSequence(config, project.file, args.sequence))
    }
    return Object.assign({ ok: true, projectId: project.id }, mcpTimelineView(detail, { assets: args.include_assets === true, includeEmpty: args.include_empty_tracks === true }))
  })

mcpTool('filmcraft_check_timeline', '时间线质检',
  '交片前检查：V1 黑场/空隙、同轨重叠、闪帧（<3 帧）、停用片段、变速、联动音画不同步、离线素材、画幅不符。每次剪辑后可调用确认。',
  { project: T_PROJECT }, ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    return mcpCheckTimeline(mcpDetail(config, project.file))
  })

mcpTool('filmcraft_list_assets', '素材列表',
  '列出工程素材箱：素材 item id、路径、在线/离线、尺寸、帧率、时长、代理。',
  { project: T_PROJECT }, ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    return { ok: true, assets: readAssets(config, project.file).map(mcpAssetView) }
  })

mcpTool('filmcraft_browse_media', '浏览素材目录',
  '列出允许目录中的子目录、媒体文件和 .fcproj。不传 dir 时列工作区根目录。',
  { dir: { type: 'string', description: '绝对路径' } }, [], READ, (args) => {
    const { config, registry } = mcpState()
    const dir = mcpGuardPath(config, registry, args.dir || config.root, '目录')
    if (!isDir(dir)) throw new Error('目录不存在: ' + winPath(dir))
    const dirs = []
    const files = []
    const projects = []
    for (const entry of listDir(dir)) {
      const full = joinPath(dir, entry.name)
      if (entry.isDirectory()) { if (!entry.name.startsWith('.') && !entry.name.startsWith('$')) dirs.push(entry.name) }
      else if (/\.fcproj$/i.test(entry.name)) projects.push(winPath(full))
      else if (MEDIA_EXT.test(entry.name)) { const st = statOf(full); files.push({ path: winPath(full), mb: st ? Math.round(mb(st.size) * 10) / 10 : 0 }) }
    }
    dirs.sort(); files.sort((x, y) => x.path.localeCompare(y.path))
    return { ok: true, dir: winPath(dir), dirs: dirs.slice(0, 300), files: files.slice(0, 500), projects: projects }
  })

mcpTool('filmcraft_describe_commands', '查询引擎命令',
  '从本机 filmcraft-cli（commands --json）读取命令的参数说明，只返回允许通过 filmcraft_apply 执行的白名单命令。用 timeline.razor / slip / slide / roll / clip.speedDuration / markers.* 之前先查参数，不要猜。',
  { prefix: { type: 'string', description: '如 "timeline." 或 "timeline.razor"' } }, [], READ, (args) => {
    const { config } = mcpState()
    if (!MCP_COMMAND_CACHE.value) {
      const result = engineJson(config, ['commands', '--json'], { what: '读取命令表', label: 'commands' })
      MCP_COMMAND_CACHE.value = result.json
    }
    const all = MCP_COMMAND_CACHE.value
    const list = Array.isArray(all) ? all
      : (all && Array.isArray(all.commands) ? all.commands
        : (all && typeof all === 'object' ? Object.keys(all).map((id) => Object.assign({ id: id }, typeof all[id] === 'object' ? all[id] : { info: all[id] })) : []))
    const prefix = String(args.prefix || '')
    const allowed = list.filter((entry) => entry && EDIT_COMMANDS[entry.id] === true && String(entry.id).startsWith(prefix))
    return {
      ok: true,
      engineCommands: list.length,
      whitelisted: Object.keys(EDIT_COMMANDS).filter((id) => id.startsWith(prefix)),
      missingFromEngine: Object.keys(EDIT_COMMANDS).filter((id) => id.startsWith(prefix) && !list.some((entry) => entry && entry.id === id)),
      commands: allowed,
    }
  })
const MCP_COMMAND_CACHE = { value: null }

// ── previews ────────────────────────────────────────────────────────────────
function mcpImage(file) {
  const st = statOf(file)
  if (!st || st.size > 4 * 1048576) return null
  return { data: readFileSync(file).toString('base64'), mimeType: 'image/png' }
}

mcpTool('filmcraft_preview_frame', '渲染一帧',
  '渲染激活序列某一时刻的成片画面（PNG），并把图片直接返回给你看。可给 seconds，或给 clip（+offset 秒）看某个片段内的画面。剪辑/调色后用它确认效果。',
  { project: T_PROJECT, seconds: T_TIME, clip: { type: 'number' }, offset: T_TIME, scale: { type: 'number', description: '0.05–1，默认 0.25' }, include_image: { type: 'boolean', description: '默认 true' } },
  ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    const detail = mcpDetail(config, project.file)
    const fps = detail.sequence ? detail.sequence.fps : 0
    let seconds = args.seconds === undefined ? 0 : mcpParseTime(args.seconds, fps, 'seconds')
    if (args.clip !== undefined) {
      if (!detail.sequence) throw new Error('工程里没有激活的序列')
      const clip = mcpClip(detail.sequence, args.clip)
      const offset = args.offset === undefined ? Math.min(clip.dur / 2, clip.dur) : mcpParseTime(args.offset, fps, 'offset')
      seconds = clip.start + clamp(offset, 0, Math.max(0, clip.dur - (fps > 0 ? 1 / fps : 0.04)))
    }
    return Promise.resolve(previewFrame(config, { project: project.file, seconds: seconds, scale: args.scale === undefined ? 0.25 : args.scale })).then((frame) => {
      const file = joinPath(previewDir(config), frame.name)
      const out = { ok: true, seconds: mcpRound(frame.seconds), timecode: mcpTimecode(frame.seconds, fps), file: winPath(file), cached: frame.cached, bytes: frame.bytes }
      if (args.include_image !== false) { const image = mcpImage(file); if (image) out.__images = [image] }
      return out
    })
  })

mcpTool('filmcraft_storyboard', '故事板',
  '为某条视频轨的每个片段各渲染一张中间帧（最多 max 张，默认 8，缩放默认 0.15），一次看清整条片子的镜头顺序与调色是否统一。比逐帧调用省事，但仍是串行渲染，片段多时会慢。',
  { project: T_PROJECT, track: { type: 'string', description: '默认 V1' }, max: { type: 'number' }, scale: { type: 'number' } },
  ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    const detail = mcpDetail(config, project.file)
    if (!detail.sequence) throw new Error('工程里没有激活的序列')
    const track = mcpTrack(detail.sequence, args.track || 'V1')
    const max = clamp(Math.round(num(args.max, 8)), 1, 24)
    const scale = clamp(num(args.scale, 0.15), 0.05, 0.5)
    const clips = track.items.slice().sort((x, y) => x.start - y.start).slice(0, max)
    const fps = detail.sequence.fps
    const frames = []
    let chain = Promise.resolve()
    for (const clip of clips) {
      chain = chain.then(() => Promise.resolve(previewFrame(config, { project: project.file, seconds: clip.start + clip.dur / 2, scale: scale }))
        .then((frame) => frames.push({ clip: clip.clip, name: clip.name, at: mcpTimecode(clip.start + clip.dur / 2, fps), file: joinPath(previewDir(config), frame.name) }))
        .catch((error) => frames.push({ clip: clip.clip, name: clip.name, error: String(error && error.message || error) })))
    }
    return chain.then(() => {
      const images = []
      for (const frame of frames) if (frame.file) { const image = mcpImage(frame.file); if (image) images.push(image); frame.file = winPath(frame.file) }
      return { ok: true, track: track.label, shown: frames.length, total: track.items.length, frames: frames, __images: images }
    })
  })

mcpTool('filmcraft_preview_clip', '预览短片',
  '把激活序列的一小段（≤20 秒）低质量导出成 mp4，用来检查节奏、转场和运动。返回文件路径。',
  { project: T_PROJECT, start: T_TIME, seconds: { type: 'number', description: '长度，0.4–20，默认 3' }, scale: { type: 'number' }, quality: { type: 'number' } },
  ['project'], READ, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    const detail = mcpDetail(config, project.file)
    const fps = detail.sequence ? detail.sequence.fps : 0
    const start = args.start === undefined ? 0 : mcpParseTime(args.start, fps, 'start')
    return Promise.resolve(previewProxy(config, { project: project.file, start: start, seconds: args.seconds, scale: args.scale, quality: args.quality })).then((proxy) => ({
      ok: true, file: winPath(joinPath(previewDir(config), proxy.name)), start: mcpRound(proxy.start), seconds: proxy.seconds, cached: proxy.cached, bytes: proxy.bytes,
    }))
  })

// ── editing ─────────────────────────────────────────────────────────────────
mcpTool('filmcraft_edit_timeline', '精剪、字幕与转场',
  '与面板共用的剪辑操作。operation: trim（clip/edge/delta）、split（clip/time，序列绝对时间）、reorder（clip/target/after，同轨插入排序）、caption（track可省略、caption修改时填写、text/start/end，remove删除）、transition（clip/effect/edge/duration，transition修改时填写，remove删除）。时间接受秒/帧/时间码。sequence 必须是当前序列 id。字幕使用序列绝对时间，排序后需复核。',
  { project: T_PROJECT, sequence: { type: 'number' }, operation: { type: 'string', enum: ['trim', 'split', 'reorder', 'caption', 'transition'] },
    clip: { type: 'number' }, target: { type: 'number' }, after: { type: 'boolean' }, edge: { type: 'string', enum: ['in', 'out'] }, delta: T_TIME, time: T_TIME,
    track: { type: 'number' }, caption: { type: 'number' }, text: { type: 'string' }, start: T_TIME, end: T_TIME, remove: { type: 'boolean' },
    effect: { type: 'string', enum: ['cross_dissolve', 'dip_to_black'] }, duration: T_TIME, transition: { type: 'number' }, dry_run: T_DRY },
  ['project', 'sequence', 'operation'], EDIT, (args) => mcpMutate(args, args.operation, (sequence, detail) => {
    return editWorkflowCommands(mcpConfig(), detail.path, args)
  }))

mcpTool('filmcraft_trim', '裁剪片段',
  '修剪片段入点或出点。delta 为正 = 片段变短（裁掉），为负 = 变长（需要源素材有余量）。默认 ripple：后面的片段跟着移动，不留空隙。时间自动对齐到帧。',
  { project: T_PROJECT, clip: { type: 'number' }, edge: { type: 'string', enum: ['in', 'out'] }, delta: T_TIME, mode: { type: 'string', description: '默认 ripple（已验证）。其他模式值请先用 filmcraft_describe_commands 查 timeline.trim' }, dry_run: T_DRY, atomic: T_ATOMIC },
  ['project', 'clip', 'edge', 'delta'], EDIT, (args) => mcpMutate(args, 'trim', (sequence) => {
    const clip = mcpClip(sequence, args.clip)
    if (args.edge !== 'in' && args.edge !== 'out') throw new Error('edge 必须是 in 或 out')
    const delta = mcpParseTime(args.delta, sequence.fps, 'delta')
    const ticks = mcpToTicks(delta, sequence.fps)
    if (ticks === 0) throw new Error('delta 不足一帧，未做任何修改')
    if (delta >= clip.dur - (sequence.fps > 0 ? 0.5 / sequence.fps : 0)) throw new Error('裁掉 ' + delta + 's 会让片段 ' + clip.clip + '（' + mcpRound(clip.dur) + 's）消失；要删除请用 filmcraft_delete_clips')
    return [{ id: 'timeline.trim', params: { clip: clip.clip, edge: args.edge, mode: args.mode || 'ripple', delta: args.edge === 'out' ? -ticks : ticks } }]
  }))

mcpTool('filmcraft_move_clips', '移动片段',
  '把一个或多个片段移动到新的时间（和可选的新轨道），一次一个撤销步。time 是片段新的起点。',
  {
    project: T_PROJECT,
    moves: { type: 'array', items: { type: 'object', properties: { clip: { type: 'number' }, time: T_TIME, track: { type: 'string', description: '如 V2；不填保持原轨道' } }, required: ['clip', 'time'], additionalProperties: false } },
    dry_run: T_DRY, atomic: T_ATOMIC,
  },
  ['project', 'moves'], EDIT, (args) => mcpMutate(args, 'move', (sequence) => {
    if (!Array.isArray(args.moves) || args.moves.length === 0) throw new Error('moves 不能为空')
    const moves = args.moves.map((move) => {
      const clip = mcpClip(sequence, move.clip)
      const time = mcpParseTime(move.time, sequence.fps, 'time')
      if (time < 0) throw new Error('time 不能为负')
      const track = move.track ? mcpTrack(sequence, move.track) : null
      if (track && track.kind !== clip.kind) throw new Error('不能把' + (clip.kind === 'video' ? '视频' : '音频') + '片段移到 ' + track.label)
      return { clip: clip.clip, track: track ? track.id : clip.track, time: mcpToTicks(time, sequence.fps) }
    })
    return [{ id: 'timeline.move', params: { moves: moves } }]
  }))

mcpTool('filmcraft_reorder', '重排镜头',
  '按给定顺序把一条轨道上的片段首尾相接重新排列（从该轨第一个片段的起点开始，不留空隙）。order 必须包含该轨所有片段 id。完成后建议 filmcraft_check_timeline 核对联动音频。',
  { project: T_PROJECT, track: { type: 'string', description: '默认 V1' }, order: { type: 'array', items: { type: 'number' } }, dry_run: T_DRY, atomic: T_ATOMIC },
  ['project', 'order'], EDIT, (args) => mcpMutate(args, 'reorder', (sequence) => {
    const track = mcpTrack(sequence, args.track || 'V1')
    const order = mcpIds(args.order, 'order')
    const onTrack = track.items.map((clip) => clip.clip)
    const missing = onTrack.filter((id) => order.indexOf(id) < 0)
    const foreign = order.filter((id) => onTrack.indexOf(id) < 0)
    if (missing.length > 0 || foreign.length > 0 || new Set(order).size !== order.length) {
      throw new Error('order 必须恰好是 ' + track.label + ' 上全部片段的一个排列。缺: [' + missing.join(',') + '] 多: [' + foreign.join(',') + ']')
    }
    const byId = new Map(track.items.map((clip) => [clip.clip, clip]))
    let cursor = Math.min.apply(null, track.items.map((clip) => clip.ticks.start))
    const moves = []
    for (const id of order) {
      const clip = byId.get(id)
      if (clip.ticks.start !== cursor) moves.push({ clip: id, track: track.id, time: cursor })
      cursor += clip.ticks.duration
    }
    if (moves.length === 0) throw new Error('顺序没有变化')
    return [{ id: 'timeline.move', params: { moves: moves } }]
  }))

mcpTool('filmcraft_delete_clips', '删除片段',
  '波纹删除片段：删掉后后面的内容前移补齐，不留黑场。可撤销。',
  { project: T_PROJECT, clips: { type: 'array', items: { type: 'number' } }, dry_run: T_DRY, atomic: T_ATOMIC },
  ['project', 'clips'], DANGER, (args) => mcpMutate(args, 'rippleDelete', (sequence) => {
    const ids = mcpIds(args.clips)
    for (const id of ids) mcpClip(sequence, id)
    return [{ id: 'edit.rippleDelete', params: { clips: ids } }]
  }))

mcpTool('filmcraft_set_enabled', '启用/停用片段',
  '把片段设为启用或停用（停用的片段留在时间线上但不出画面/声音）。只切换状态与目标不同的片段。',
  { project: T_PROJECT, clips: { type: 'array', items: { type: 'number' } }, enabled: { type: 'boolean' }, dry_run: T_DRY, atomic: T_ATOMIC },
  ['project', 'clips', 'enabled'], EDIT, (args) => mcpMutate(args, 'setEnabled', (sequence) => {
    const ids = mcpIds(args.clips)
    const flip = ids.filter((id) => mcpClip(sequence, id).enabled !== (args.enabled === true))
    if (flip.length === 0) throw new Error('这些片段已经是' + (args.enabled ? '启用' : '停用') + '状态')
    // clip.enable toggles (the panel uses the same call for both directions).
    return [{ id: 'clip.enable', params: { clips: flip } }]
  }))

mcpTool('filmcraft_grade', '调色',
  '把调色预设（filmcraft_presets 列出）套到片段上：没有 lumetri 效果的先加，再逐项设参数。clips 可省略 = 激活序列全部视频片段。clear=true 清除这些片段的 lumetri。',
  { project: T_PROJECT, preset: { type: 'string' }, clips: { type: 'array', items: { type: 'number' } }, clear: { type: 'boolean' }, dry_run: T_DRY },
  ['project'], EDIT, (args) => {
    const state = mcpState()
    const project = mcpResolve(state.config, state.registry, args.project)
    const detail = mcpDetail(state.config, project.file)
    if (!detail.sequence) throw new Error('工程里没有激活的序列')
    const ids = Array.isArray(args.clips) && args.clips.length > 0 ? mcpIds(args.clips) : detail.sequence.clips.filter((clip) => clip.kind === 'video').map((clip) => clip.clip)
    for (const id of ids) mcpClip(detail.sequence, id)
    if (args.clear !== true) {
      const preset = presetFind(state.registry, args.preset)
      if (!preset) throw new Error('未知的调色预设: ' + String(args.preset) + '，可用: ' + presetList(state.registry).map((p) => p.id).join(', '))
      if (args.dry_run === true) return { ok: true, dryRun: true, preset: preset.id, clips: ids, params: gradeParamsOf(preset) }
    } else if (args.dry_run === true) return { ok: true, dryRun: true, clear: true, clips: ids }
    return withProjectLock(state.config, project.file, 'mcp', () => {
      const result = args.clear === true
        ? gradeClearClips(state.config, state.registry, { project: project.file, clips: ids })
        : gradeClips(state.config, state.registry, { project: project.file, clips: ids, preset: args.preset })
      return { ok: !(result.failed && result.failed.length), clips: ids.length, commands: result.commands, failed: result.failed || [], undo: '可用 filmcraft_undo 撤销', changes: mcpDiff(detail.sequence, result.detail.sequence) }
    })
  })

mcpTool('filmcraft_presets', '调色预设',
  'list 列出预设；save 新建/修改自定义预设（params: sharpen, contrast, highlights, whites, shadows, blacks, tint, temperature, saturation, vibrance；hsl: on, hue, hueRange, sat, hueShift, temp, tint）；remove 删除自定义预设。内置预设不可改。',
  { action: { type: 'string', enum: ['list', 'save', 'remove'] }, preset: { type: 'object', additionalProperties: true }, id: { type: 'string' } },
  ['action'], { readOnlyHint: false, destructiveHint: false, idempotentHint: true }, (args) => {
    const { config, registry } = mcpState()
    if (args.action === 'list') return { ok: true, presets: presetList(registry) }
    if (mcpReadOnly()) throw new Error('只读模式下不能修改预设')
    if (args.action === 'save') { const preset = presetSave(registry, args.preset || {}); saveRegistry(config, registry); return { ok: true, preset: preset } }
    if (args.action === 'remove') { const removed = presetRemove(registry, String(args.id || '')); if (removed) saveRegistry(config, registry); return { ok: true, removed: removed } }
    throw new Error('action 必须是 list|save|remove')
  })

mcpTool('filmcraft_apply', '执行引擎命令',
  '执行白名单内的 FilmCraft 引擎命令批（[{id, params}]，时间参数是整数 tick，254016000000/秒）。用于高阶工具没覆盖的操作：timeline.razor/slip/slide/roll、clip.speedDuration、clip.rename、markers.*、effects.* 等。先用 filmcraft_describe_commands 查参数，并建议先 dry_run。默认原子执行。',
  { project: T_PROJECT, commands: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, params: { type: 'object', additionalProperties: true } }, required: ['id'], additionalProperties: false } }, dry_run: T_DRY, atomic: T_ATOMIC },
  ['project', 'commands'], DANGER, (args) => mcpMutate(args, 'apply', () => {
    if (!Array.isArray(args.commands)) throw new Error('commands 必须是数组')
    if (args.commands.some((command) => command && command.id === 'project.delete')) throw new Error('删除工程条目请用 filmcraft_sequence action=delete')
    return args.commands
  }))

mcpTool('filmcraft_undo', '撤销',
  '把工程恢复到上一次编辑前的快照（每个写工具调用 = 一步，最多保留 20 步）。没有重做。',
  { project: T_PROJECT }, ['project'], DANGER, (args) => mcpLocked(args, (config, registry, project) => {
    const before = mcpDetail(config, project.file)
    const result = projectUndo(config, registry, { project: project.file })
    return { ok: true, restored: result.restored, remaining: result.remaining, changes: mcpDiff(before.sequence, result.detail.sequence) }
  }))

// ── media & sequences ───────────────────────────────────────────────────────
mcpTool('filmcraft_import_media', '导入素材',
  '把媒体文件导入工程素材箱；place=true 时同时放到激活序列（insert=true 为插入，否则覆盖放置）。',
  { project: T_PROJECT, files: { type: 'array', items: { type: 'string' } }, place: { type: 'boolean' }, insert: { type: 'boolean' } },
  ['project', 'files'], EDIT, (args) => {
    const { config, registry } = mcpState()
    const files = (Array.isArray(args.files) ? args.files : []).map((file) => mcpGuardPath(config, registry, file, '素材路径'))
    return mcpLocked(args, (config2, registry2, project) => {
      const before = mcpDetail(config2, project.file)
      const result = args.place === true
        ? projectPasteMedia(config2, registry2, { project: project.file, files: files, insert: args.insert === true, place: true })
        : projectImport(config2, registry2, { project: project.file, files: files })
      return { ok: !(result.errors && result.errors.length), items: result.items, errors: result.errors || [], undo: '可用 filmcraft_undo 撤销', changes: mcpDiff(before.sequence, result.detail.sequence) }
    })
  })

mcpTool('filmcraft_sequence', '序列',
  'create 新建序列（name,width,height,fps,sample_rate,video_tracks,audio_tracks）；activate 切换激活序列；rename 重命名；settings 修改尺寸/帧率；delete 删除序列（需 confirm=true）。',
  {
    project: T_PROJECT, action: { type: 'string', enum: ['create', 'activate', 'rename', 'settings', 'delete'] }, sequence: { type: 'number' },
    name: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, fps: { type: 'number' }, sample_rate: { type: 'number' },
    video_tracks: { type: 'number' }, audio_tracks: { type: 'number' }, confirm: { type: 'boolean' },
  },
  ['project', 'action'], DANGER, (args) => mcpLocked(args, (config, registry, project) => {
    const ref = project.file
    if (args.action === 'create') {
      const result = projectCreateSequence(config, registry, { project: ref, name: args.name, width: args.width, height: args.height, fps: args.fps, sampleRate: args.sample_rate, video: args.video_tracks, audio: args.audio_tracks })
      return Object.assign({ ok: true, sequence: result.sequence }, mcpTimelineView(result.detail))
    }
    if (args.action === 'activate') return Object.assign({ ok: true }, mcpTimelineView(projectActivateSequence(config, ref, num(args.sequence, 0))))
    if (args.action === 'rename') return Object.assign({ ok: true }, mcpTimelineView(projectRenameSequence(config, registry, { project: ref, sequence: args.sequence, name: args.name }).detail))
    if (args.action === 'settings') {
      if (typeof args.sequence === 'number') projectActivateSequence(config, ref, args.sequence)
      const params = {}
      for (const [key, value] of [['width', args.width], ['height', args.height], ['fps', args.fps], ['sampleRate', args.sample_rate]]) if (typeof value === 'number') params[key] = value
      if (typeof args.name === 'string' && args.name !== '') params.name = args.name
      if (Object.keys(params).length === 0) throw new Error('settings 至少要改一项')
      snapshotTake(config, ref)
      engineExec(config, ref, 'sequence.settings', params, { save: true })
      projectInvalidate(ref)
      return Object.assign({ ok: true }, mcpTimelineView(mcpDetail(config, ref)))
    }
    if (args.action === 'delete') {
      if (args.confirm !== true) throw new Error('删除序列需要 confirm=true（可用 filmcraft_undo 恢复）')
      return Object.assign({ ok: true }, mcpTimelineView(projectDeleteSequence(config, registry, { project: ref, sequence: args.sequence }).detail))
    }
    throw new Error('未知的 action')
  }))

mcpTool('filmcraft_assemble', '按顺序拼接（粗剪）',
  '把多段素材按数组顺序首尾相接放进一条新序列（V1/A1），保持可剪辑；可放进已有工程或新建工程。序列尺寸/帧率默认取第一段素材，并返回尺寸/帧率不一致的警告。这是“合并”的非破坏性做法，之后可继续裁剪、调色、导出。',
  {
    project: T_PROJECT,
    create: { type: 'object', properties: { name: { type: 'string' }, dir: { type: 'string' }, overwrite: { type: 'boolean' } }, additionalProperties: false },
    sources: { type: 'array', items: { type: 'object', properties: { item: { type: 'number' }, file: { type: 'string' } }, additionalProperties: false } },
    name: { type: 'string', description: '新序列名' },
    settings: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, fps: { type: 'number' }, sampleRate: { type: 'number' } }, additionalProperties: false },
  },
  ['sources'], EDIT, (args) => {
    const { config, registry } = mcpState()
    const sources = (Array.isArray(args.sources) ? args.sources : []).map((source) => source && source.file ? { file: mcpGuardPath(config, registry, source.file, '素材路径') } : source)
    const request = { sources: sources, name: args.name, settings: args.settings }
    if (args.create && args.create.name) {
      const dir = args.create.dir ? mcpGuardPath(config, registry, args.create.dir, '工程目录') : pathsOf(config.root).projects
      request.create = { name: args.create.name, dir: dir, overwrite: args.create.overwrite === true }
      const result = projectMerge(config, registry, request)
      saveRegistry(config, registry)
      return { ok: true, project: result.project, sequence: result.sequence, settings: result.settings, compat: result.compat, timeline: mcpTimelineView(result.detail) }
    }
    if (!args.project) throw new Error('需要 project（放进已有工程）或 create.name（新建工程）')
    return mcpLocked(args, (config2, registry2, project) => {
      request.project = project.file
      const result = projectMerge(config2, registry2, request)
      saveRegistry(config2, registry2)
      return { ok: true, project: result.project, sequence: result.sequence, settings: result.settings, compat: result.compat, undo: '可用 filmcraft_undo 撤销', timeline: mcpTimelineView(result.detail) }
    })
  })

// ── delivery ────────────────────────────────────────────────────────────────
mcpTool('filmcraft_export', '导出成片',
  '后台导出激活序列（或指定 sequence）为视频文件，立即返回任务；用 filmcraft_jobs 查看进度。导出串行：已有导出在跑时会拒绝。start/end 可只导出一段。',
  {
    project: T_PROJECT, sequence: { type: 'number' }, out: { type: 'string', description: '输出绝对路径，默认工作区 exports/' },
    preset: { type: 'string', description: '引擎导出预设名' }, format: { type: 'string', description: 'h264|hevc|prores…（没给 preset 时）' },
    start: T_TIME, end: T_TIME, scale: { type: 'number' }, quality: { type: 'number' }, no_audio: { type: 'boolean' },
  },
  ['project'], EDIT, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    const out = args.out ? mcpGuardPath(config, registry, args.out, '输出路径') : undefined
    const detail = mcpDetail(config, project.file)
    const fps = detail.sequence ? detail.sequence.fps : 0
    const request = {
      project: project.file, sequence: args.sequence, out: out, preset: args.preset, format: args.format,
      start: args.start === undefined ? null : mcpParseTime(args.start, fps, 'start'),
      end: args.end === undefined ? null : mcpParseTime(args.end, fps, 'end'),
      scale: args.scale, quality: args.quality, noAudio: args.no_audio === true,
    }
    const job = typeof args.sequence === 'number'
      ? withProjectLock(config, project.file, 'mcp', () => jobStart(config, registry, request))
      : jobStart(config, registry, request)
    saveRegistry(config, registry)
    return { ok: true, job: mcpJobView(job), next: '用 filmcraft_jobs action=get id=' + job.id + ' 查看进度' }
  })

function mcpJobView(job) {
  const progress = job.progress || {}
  return {
    id: job.id, state: job.state, project: job.project ? job.project.name : '', sequence: job.sequence ? job.sequence.name : '',
    out: job.display || winPath(job.out || ''),
    percent: progress.ratio === null || progress.ratio === undefined ? null : Math.round(progress.ratio * 1000) / 10,
    elapsed: hhmmss((progress.elapsedMs || 0) / 1000), eta: progress.etaMs === null || progress.etaMs === undefined ? null : hhmmss(progress.etaMs / 1000),
    mb: Math.round(mb(progress.bytes || 0) * 10) / 10, orphan: progress.orphan === true, error: job.error || null, result: job.result || null,
    createdAt: job.createdAt, endedAt: job.endedAt,
  }
}

mcpTool('filmcraft_jobs', '导出任务',
  'list 列出任务（含百分比、已用时、预计剩余；ETA 未知时为 null）；get 查看一个；cancel 取消；remove 删除记录。',
  { action: { type: 'string', enum: ['list', 'get', 'cancel', 'remove'] }, id: { type: 'string' } },
  ['action'], { readOnlyHint: false, destructiveHint: true, idempotentHint: false }, (args) => {
    const { config, registry } = mcpState()
    if (args.action === 'list') { jobRefresh(config, registry); return { ok: true, jobs: jobList(config).slice(0, 30).map(mcpJobView) } }
    if (!args.id) throw new Error('需要 id')
    if (args.action === 'get') {
      jobRefresh(config, registry, args.id)
      const job = jobRead(config, args.id)
      if (!job) throw new Error('未知的任务: ' + args.id)
      if (job.state === 'running' && job.progress && job.progress.orphan) Object.assign(job, { progress: Object.assign(jobSampleView(job), { orphan: true }) })
      return { ok: true, job: mcpJobView(job) }
    }
    if (mcpReadOnly()) throw new Error('只读模式下不能修改任务')
    if (args.action === 'cancel') { const result = jobCancel(config, registry, args.id); return { ok: true, cancelled: result.cancelled, job: mcpJobView(result.job) } }
    if (args.action === 'remove') return { ok: true, removed: jobRemove(config, args.id) }
    throw new Error('action 必须是 list|get|cancel|remove')
  })

mcpTool('filmcraft_export_interchange', '导出时间线交换文件',
  '把时间线导出为 EDL / FCP7 XML / FCPXML / OTIO / AAF / OMF，交给 Premiere、Resolve、Final Cut 等继续精剪（保留剪辑点）。',
  { project: T_PROJECT, format: { type: 'string', enum: ['edl', 'xml', 'fcpxml', 'otio', 'aaf', 'omf'] }, out: { type: 'string' }, sequence: { type: 'number' }, overwrite: { type: 'boolean' } },
  ['project'], EDIT, (args) => {
    const { config, registry } = mcpState()
    const project = mcpResolve(config, registry, args.project)
    const format = args.format || 'fcpxml'
    ensureDir(pathsOf(config.root).exports)
    const out = args.out ? mcpGuardPath(config, registry, args.out, '输出路径') : joinPath(pathsOf(config.root).exports, (project.name || 'timeline') + '.' + format)
    if (isFile(out) && args.overwrite !== true) throw new Error('文件已存在: ' + winPath(out) + '（overwrite=true 覆盖）')
    ensureDir(dirOf(out))
    const params = { format: format, path: out }
    if (typeof args.sequence === 'number') params.sequence = args.sequence
    engineExec(config, project.file, 'file.exportInterchange', params, { save: false })
    return { ok: isFile(out), format: format, out: winPath(out), bytes: (statOf(out) || { size: 0 }).size }
  })

const MCP_INSTRUCTIONS = [
  'FilmCraft 剪辑 MCP。推荐流程：',
  '1) filmcraft_status 确认 CLI 可用 → filmcraft_list_projects（rescan=true 发现新工程）。',
  '2) filmcraft_get_timeline 读取片段 id 与时间；永远用 id，不要用序号。',
  '3) 粗剪：filmcraft_assemble 按顺序拼接；精剪：filmcraft_trim / move_clips / reorder / delete_clips / set_enabled。',
  '   不确定时先 dry_run=true。每次写操作是一个撤销步，失败自动回滚；filmcraft_undo 撤销上一步。',
  '4) 每次修改后看返回的 changes，再用 filmcraft_check_timeline 查黑场、重叠、闪帧、音画不同步。',
  '5) filmcraft_preview_frame / filmcraft_storyboard 直接看画面；filmcraft_grade 套调色预设。',
  '6) filmcraft_export 后台导出，filmcraft_jobs 轮询；需要交给其他剪辑软件用 filmcraft_export_interchange。',
  '时间可写 12.5、"30f"、"00:00:12:12"；会自动对齐到帧。高阶工具没覆盖的操作（分割、slip、变速、标记）先 filmcraft_describe_commands 查参数，再 filmcraft_apply。',
].join('\n')
