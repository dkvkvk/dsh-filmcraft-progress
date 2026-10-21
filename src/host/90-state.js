// ── state: the handlers, and the two agent tools ─────────────────────────────
// Everything the panel and the tools can do enters through here. Each handler
// loads config and registry fresh, because both can change at runtime (the user
// moves the workspace, adds a preset) and a cached copy would silently diverge.

const PLUGIN_VERSION = '0.3.0'

// The report file the *old* pipeline wrote. Kept readable so existing scripts
// keep working; nothing new is written in this format.
function statusPathOf(config, registry) {
  const settings = (registry && registry.settings) || {}
  if (typeof settings.statusFile === 'string' && settings.statusFile !== '') return uniqSlashes(settings.statusFile)
  const legacy = joinPath(LEGACY_ROOT, 'film-status.json')
  if (isFile(legacy)) return legacy
  return joinPath(pathsOf(config.root).work, 'film-status.json')
}

function readLegacyState(config, registry) {
  const statusPath = statusPathOf(config, registry)
  const stat = statOf(statusPath)
  if (!stat) {
    return { ok: true, now: nowIso(), statusPath: statusPath, display: winPath(statusPath), present: false, state: null, error: null }
  }
  const state = readJson(statusPath, null)
  const ageMs = Date.now() - stat.mtimeMs
  // A report that stopped updating is a report from a dead or paused job. Do not
  // show a stale "导出中 43%" as if it were live.
  const alive = ageMs < 30000
  return {
    ok: true,
    now: nowIso(),
    statusPath: statusPath,
    display: winPath(statusPath),
    present: true,
    alive: alive,
    ageMs: ageMs,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    state: state && typeof state === 'object' ? state : null,
    error: null,
  }
}

function withState(fn) {
  return (body) => {
    const config = loadConfig()
    const registry = loadRegistry(config)
    return Promise.resolve(fn(config, registry, body || {}))
  }
}

function workspacePayload(config, registry) {
  const paths = pathsOf(config.root)
  const summaries = projectSummaries(config, registry)
  return {
    ok: true,
    version: PLUGIN_VERSION,
    root: paths.root,
    rootDisplay: winPath(paths.root),
    paths: {
      registry: winPath(paths.registry),
      projects: winPath(paths.projects),
      exports: winPath(paths.exports),
      work: winPath(paths.work),
      jobs: winPath(paths.jobs),
      previews: winPath(paths.previews),
    },
    cli: { path: winPath(config.cliPath), exists: isFile(config.cliPath) },
    settings: registry.settings || {},
    presets: presetList(registry),
    counts: {
      projects: summaries.length,
      missing: summaries.filter((project) => !project.exists).length,
      jobs: jobList(config).length,
      running: jobList(config).filter((job) => job.state === 'running').length,
    },
    legacyRoot: isDir(LEGACY_ROOT) ? winPath(LEGACY_ROOT) : '',
  }
}

// ── media serving ───────────────────────────────────────────────────────────
const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
}
function mediaServe(config, req, res) {
  const query = new URLSearchParams((req.url || '').split('?')[1] || '')
  const name = query.get('name') || ''
  const full = previewResolve(config, name)
  if (!full) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '文件不存在' }))
  }
  const stat = statOf(full)
  if (!stat) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '文件不存在' }))
  }
  const dot = baseOf(full).lastIndexOf('.')
  const ext = dot < 0 ? '' : baseOf(full).slice(dot).toLowerCase()
  const type = MEDIA_TYPES[ext] || 'application/octet-stream'
  const size = stat.size
  const range = req.headers.range
  // Video needs range support or the <video> element refuses to seek.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      let from = match[1] === '' ? null : Number(match[1])
      let to = match[2] === '' ? null : Number(match[2])
      if (from === null && to !== null) { from = Math.max(0, size - to); to = size - 1 }
      if (from === null) from = 0
      if (to === null || to >= size) to = size - 1
      if (from > to || from >= size) {
        res.writeHead(416, { 'content-range': 'bytes */' + size })
        return res.end()
      }
      const buf = readFileSync(full).subarray(from, to + 1)
      res.writeHead(206, {
        'content-type': type,
        'content-length': String(buf.length),
        'content-range': 'bytes ' + from + '-' + to + '/' + size,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=600',
      })
      return res.end(buf)
    }
  }
  const buf = readFileSync(full)
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(buf.length),
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=600',
  })
  res.end(buf)
}

// ── handler table ───────────────────────────────────────────────────────────
function buildHandlers(harness) {
  const H = {}

  // legacy progress contract
  H['state.read'] = withState((config, registry) => readLegacyState(config, registry))

  // workspace
  H['workspace.read'] = withState((config, registry) => {
    const payload = workspacePayload(config, registry)
    if (registry.projects.length === 0) {
      const seed = seedFromLegacy(config, registry)
      if (seed.added.length > 0) {
        saveRegistry(config, registry)
        payload.seeded = seed
        payload.counts = workspacePayload(config, registry).counts
        payload.projects = projectSummaries(config, registry)
      }
    }
    return payload
  })

  H['workspace.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'setRoot') {
      const next = uniqSlashes(body.root || '')
      if (next === '') throw new Error('工作区路径不能为空')
      ensureDir(next)
      config.root = next
      saveConfig(config)
      const fresh = loadRegistry(config)
      const seeded = seedFromLegacy(config, fresh)
      saveRegistry(config, fresh)
      return { ok: true, seeded: seeded, workspace: workspacePayload(config, fresh) }
    }
    if (action === 'setCli') {
      const next = uniqSlashes(body.cliPath || '')
      if (!isFile(next)) throw new Error('找不到 filmcraft-cli: ' + winPath(next))
      config.cliPath = next
      saveConfig(config)
      return { ok: true, workspace: workspacePayload(config, registry) }
    }
    if (action === 'updateSettings') {
      registry.settings = Object.assign({}, registry.settings, body.settings || {})
      saveRegistry(config, registry)
      return { ok: true, workspace: workspacePayload(config, registry) }
    }
    if (action === 'seedLegacy') {
      const seeded = seedFromLegacy(config, registry)
      saveRegistry(config, registry)
      return { ok: true, seeded: seeded, projects: projectSummaries(config, registry) }
    }
    throw new Error('未知的 workspace action: ' + String(action))
  })

  // projects
  H['projects.list'] = withState((config, registry, body) => {
    let scanned = null
    if (body.rescan === '1' || body.rescan === true) {
      const found = scanProjects(pathsOf(config.root).root, num(config.scanDepth, 4))
      scanned = found
      let added = 0
      for (const entry of found) {
        const result = projectAdd(config, registry, entry.file, { name: entry.name })
        if (result.added) added += 1
      }
      if (added > 0) saveRegistry(config, registry)
    }
    return { ok: true, projects: projectSummaries(config, registry), scanned: scanned }
  })

  H['projects.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'add') {
      const result = projectAdd(config, registry, body.file, { name: body.name })
      saveRegistry(config, registry)
      return { ok: true, added: result.added, project: projectSummaries(config, registry).filter((project) => project.id === result.project.id)[0], projects: projectSummaries(config, registry) }
    }
    if (action === 'remove') {
      const removed = projectRemove(registry, String(body.id || ''))
      if (removed) saveRegistry(config, registry)
      return { ok: true, removed: removed, projects: projectSummaries(config, registry) }
    }
    if (action === 'rename') {
      const project = projectById(registry, String(body.id || ''))
      if (!project) throw new Error('未知的项目')
      const name = String(body.name || '').trim()
      if (name === '') throw new Error('项目名不能为空')
      project.name = name
      project.updatedAt = nowIso()
      saveRegistry(config, registry)
      return { ok: true, projects: projectSummaries(config, registry) }
    }
    if (action === 'rescan') {
      const found = scanProjects(pathsOf(config.root).root, num(body.depth, num(config.scanDepth, 4)))
      let added = 0
      for (const entry of found) {
        const result = projectAdd(config, registry, entry.file, { name: entry.name })
        if (result.added) added += 1
      }
      if (added > 0) saveRegistry(config, registry)
      return { ok: true, found: found, added: added, projects: projectSummaries(config, registry) }
    }
    throw new Error('未知的 projects action: ' + String(action))
  })

  // one project
  H['project.read'] = withState((config, registry, body) => {
    const project = resolveProject(registry, body.project || body.path || body.file)
    return Object.assign({ ok: true, projectId: project.id, projectName: project.name }, projectDetail(config, project.file, {
      force: body.force === '1' || body.force === true,
      withAssets: body.withAssets !== '0' && body.withAssets !== false,
    }))
  })

  H['project.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'activate') {
      const project = resolveProject(registry, body.project)
      const detail = projectActivateSequence(config, project.file, num(body.sequence, 0))
      return { ok: true, detail: detail }
    }
    if (action === 'createSequence') {
      const result = projectCreateSequence(config, registry, body)
      return Object.assign({ ok: true }, result)
    }
    if (action === 'deleteSequence') {
      const result = projectDeleteSequence(config, registry, body)
      return Object.assign({ ok: true }, result)
    }
    if (action === 'renameSequence') {
      const result = projectRenameSequence(config, registry, body)
      return Object.assign({ ok: true }, result)
    }
    if (action === 'sequenceSettings') {
      const project = resolveProject(registry, body.project)
      if (typeof body.sequence === 'number') projectActivateSequence(config, project.file, body.sequence)
      snapshotTake(config, project.file)
      const params = {}
      for (const key of ['width', 'height', 'fps', 'name', 'sampleRate']) {
        if (body[key] !== undefined && body[key] !== null && body[key] !== '') params[key] = num(body[key], 0)
      }
      engineExec(config, project.file, 'sequence.settings', params, { save: true })
      projectInvalidate(project.file)
      return { ok: true, detail: projectDetail(config, project.file, { force: true }) }
    }
    if (action === 'exportInterchange') {
      // The engine can write the timeline itself as EDL / FCP7 XML / FCPXML /
      // OTIO / AAF. That is the only honest way to hand a merged timeline to
      // another NLE with its edit points intact — a rendered mp4 has no cuts in it.
      const project = resolveProject(registry, body.project)
      const formats = { edl: 'edl', xml: 'xml', fcpxml: 'fcpxml', otio: 'otio', aaf: 'aaf', omf: 'omf' }
      const format = formats[String(body.format || 'fcpxml').toLowerCase()] || 'fcpxml'
      const paths = pathsOf(config.root)
      ensureDir(paths.exports)
      const out = uniqSlashes(body.out || joinPath(paths.exports, (project.name || 'timeline') + '.' + format))
      ensureDir(dirOf(out))
      if (isFile(out) && body.overwrite !== true) throw new Error('文件已存在: ' + winPath(out))
      const params = { format: format, path: out }
      if (typeof body.sequence === 'number') params.sequence = body.sequence
      engineExec(config, project.file, 'file.exportInterchange', params, { save: false })
      return { ok: true, format: format, out: winPath(out), bytes: (statOf(out) || { size: 0 }).size }
    }
    throw new Error('未知的 project action: ' + String(action))
  })

  H['assets.read'] = withState((config, registry, body) => {
    const project = resolveProject(registry, body.project)
    const assets = readAssets(config, project.file)
    return { ok: true, project: { id: project.id, name: project.name, file: winPath(project.file) }, assets: assets }
  })

  H['browse.read'] = withState((config, registry, body) => {
    let dir = uniqSlashes(body.path || '')
    if (dir === '') dir = pathsOf(config.root).root
    if (!isDir(dir)) {
      const up = dirOf(dir)
      if (isDir(up)) dir = up
      else throw new Error('目录不存在: ' + winPath(dir))
    }
    const dirs = []
    const files = []
    for (const entry of listDir(dir)) {
      const full = joinPath(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('$') || entry.name.startsWith('.')) continue
        dirs.push({ name: entry.name, path: winPath(full) })
      } else if (entry.isFile()) {
        if (!MEDIA_EXT.test(entry.name)) continue
        const stat = statOf(full)
        files.push({
          name: entry.name,
          path: winPath(full),
          bytes: stat ? stat.size : 0,
          savedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
        })
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    files.sort((a, b) => a.name.localeCompare(b.name))
    const parent = dirOf(dir)
    return {
      ok: true,
      path: winPath(dir),
      parent: parent === dir ? '' : winPath(parent),
      dirs: dirs,
      files: files,
      projects: listDir(dir).filter((entry) => entry.isFile() && /\.fcproj$/i.test(entry.name)).map((entry) => winPath(joinPath(dir, entry.name))),
    }
  })

  H['presets.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'save') {
      const preset = presetSave(registry, body.preset || body)
      saveRegistry(config, registry)
      return { ok: true, preset: preset, presets: presetList(registry) }
    }
    if (action === 'remove') {
      const removed = presetRemove(registry, String(body.id || ''))
      if (removed) saveRegistry(config, registry)
      return { ok: true, removed: removed, presets: presetList(registry) }
    }
    if (action === 'reset') {
      registry.presets = DEFAULT_PRESETS.map((preset) => ({ ...preset }))
      saveRegistry(config, registry)
      return { ok: true, presets: presetList(registry) }
    }
    throw new Error('未知的 presets action: ' + String(action))
  })

  // editing
  H['import.write'] = withState((config, registry, body) => {
    if (body.place === true || body.place === '1') {
      const result = projectPasteMedia(config, registry, body)
      return Object.assign({ ok: true }, result)
    }
    const result = projectImport(config, registry, body)
    return Object.assign({ ok: true }, result)
  })

  H['sequence.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'create') return Object.assign({ ok: true }, projectCreateSequence(config, registry, body))
    if (action === 'activate') {
      const project = resolveProject(registry, body.project)
      return { ok: true, detail: projectActivateSequence(config, project.file, num(body.sequence, 0)) }
    }
    if (action === 'delete') return Object.assign({ ok: true }, projectDeleteSequence(config, registry, body))
    if (action === 'rename') return Object.assign({ ok: true }, projectRenameSequence(config, registry, body))
    throw new Error('未知的 sequence action: ' + String(action))
  })

  H['merge.write'] = withState((config, registry, body) => {
    const result = projectMerge(config, registry, body)
    saveRegistry(config, registry)
    if (body.export === true || body.export === '1' || (body.export && typeof body.export === 'object')) {
      const exportOptions = typeof body.export === 'object' ? body.export : {}
      const job = jobStart(config, registry, Object.assign({
        project: result.project.file,
        sequence: result.sequence.id,
      }, exportOptions))
      saveRegistry(config, registry)
      return Object.assign({ ok: true }, result, { job: job })
    }
    saveRegistry(config, registry)
    return Object.assign({ ok: true }, result, { job: null })
  })

  H['edit.write'] = withState((config, registry, body) => projectApply(config, registry, body))
  H['grade.write'] = withState((config, registry, body) => {
    const result = body.clear === true || body.clear === '1'
      ? gradeClearClips(config, registry, body)
      : gradeClips(config, registry, body)
    return Object.assign({ ok: true }, result)
  })
  H['undo.write'] = withState((config, registry, body) => projectUndo(config, registry, body))

  // jobs
  H['export.write'] = withState((config, registry, body) => {
    const job = jobStart(config, registry, body)
    saveRegistry(config, registry)
    return { ok: true, job: job }
  })
  H['jobs.read'] = withState((config, registry) => {
    jobRefresh(config, registry)
    return { ok: true, jobs: jobList(config), calibration: calibrationOf(registry) }
  })
  H['jobs.write'] = withState((config, registry, body) => {
    const action = body.action
    if (action === 'cancel') {
      const result = jobCancel(config, registry, String(body.id || ''))
      return { ok: true, job: result.job, cancelled: result.cancelled }
    }
    if (action === 'remove') {
      const removed = jobRemove(config, String(body.id || ''))
      return { ok: true, removed: removed, jobs: jobList(config) }
    }
    throw new Error('未知的 jobs action: ' + String(action))
  })

  // preview
  H['frame.read'] = withState((config, registry, body) => previewFrame(config, Object.assign({}, body, {
    project: resolveProject(registry, body.project).file,
  })))
  H['proxy.write'] = withState((config, registry, body) => previewProxy(config, Object.assign({}, body, {
    project: resolveProject(registry, body.project).file,
  })))

  // raw
  H['media.read'] = (req, res) => mediaServe(loadConfig(), req, res)

  for (const key of Object.keys(H)) {
    if (H[key] === undefined) throw new Error('handler not implemented: ' + key)
    if (key !== 'media.read') harness.handle(key, H[key])
  }
  harness.handle('media.read', H['media.read'])
  return H
}

// ── agent tools ─────────────────────────────────────────────────────────────
function registerTools(harness, ctx) {
  harness.registerTool(ctx, harness.defineTool({
    name: 'filmcraft_progress',
    description: '查看 FilmCraft 导出/渲染的实时进度：插件自己派生的任务队列（导出百分比、已用时、预计剩余、输出文件大小与速度）以及旧版状态文件（如果有）。数据来自任务记录与输出文件的实时采样。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    },
    async execute() {
      const config = loadConfig()
      const registry = loadRegistry(config)
      jobRefresh(config, registry)
      const jobs = jobList(config)
      const legacy = readLegacyState(config, registry)
      return {
        ok: true,
        workspace: winPath(pathsOf(config.root).root),
        jobs: jobs.map((job) => ({
          id: job.id,
          state: job.state,
          project: job.project ? job.project.name : '',
          sequence: job.sequence ? job.sequence.name : '',
          out: job.display || job.out,
          bytes: job.progress ? job.progress.bytes : 0,
          expectedBytes: job.expected ? job.expected.bytes : 0,
          percent: job.progress && job.progress.ratio !== null && job.progress.ratio !== undefined
            ? Math.round(job.progress.ratio * 1000) / 10 : null,
          elapsedMs: job.progress ? job.progress.elapsedMs : 0,
          etaMs: job.progress ? job.progress.etaMs : null,
          bytesPerSecond: job.progress ? job.progress.bytesPerSecond : 0,
          error: job.error,
        })),
        legacy: legacy.present ? { path: legacy.display, alive: legacy.alive, ageMs: legacy.ageMs, phase: legacy.state ? legacy.state.phase : null, percent: legacy.state ? legacy.state.percent : null, message: legacy.state ? legacy.state.message : '' } : null,
      }
    },
  }))

  harness.registerTool(ctx, harness.defineTool({
    name: 'filmcraft_edit',
    description: '通用 FilmCraft 剪辑：多工程管理、素材导入、序列（含合并多段视频）、逐段剪辑与调色、导出与任务管理。action=workspace|projects|open|assets|browse|import|sequence|merge|apply|grade|undo|export|jobs|cancel|frame|proxy。',
    parameters: {
      action: { type: 'string', description: 'workspace=工作区与预设 | projects=工程列表 | open=打开并查看工程 | assets=工程素材 | browse=浏览目录 | import=导入素材 | sequence=序列操作 | merge=合并成新序列 | apply=执行白名单命令 | grade=套调色预设 | undo=撤销 | export=导出 | jobs=任务列表 | cancel=取消任务 | frame=渲染一帧 | proxy=短预览片段', required: true },
      project: { type: 'string', description: '工程 id 或 .fcproj 路径' },
      sequence: { type: 'number', description: '序列 id' },
      name: { type: 'string', description: '序列/工程名' },
      files: { type: 'array', description: 'import：绝对路径数组', items: { type: 'string' } },
      path: { type: 'string', description: 'browse：要列出的目录' },
      sources: { type: 'array', description: 'merge：[{item:素材id} 或 {file:路径}]，按数组顺序拼接', items: { type: 'object', additionalProperties: true } },
      create: { type: 'object', description: 'merge：{name,dir,overwrite} 新建工程；不传则用 project', additionalProperties: true },
      settings: { type: 'object', description: 'merge：{width,height,fps,sampleRate}', additionalProperties: true },
      clips: { type: 'array', description: 'grade：片段 id 数组', items: { type: 'number' } },
      preset: { type: 'string', description: 'grade：预设 id；export：导出预设名' },
      clear: { type: 'boolean', description: 'grade：清空调色' },
      commands: { type: 'array', description: 'apply：[{id,params}]，仅白名单命令', items: { type: 'object', additionalProperties: true } },
      out: { type: 'string', description: 'export：输出路径' },
      start: { type: 'number', description: 'export：起始秒' },
      end: { type: 'number', description: 'export：结束秒' },
      scale: { type: 'number', description: 'export/frame/proxy：缩放 0.05–1' },
      quality: { type: 'number', description: 'export/proxy：质量 0-100' },
      noAudio: { type: 'boolean', description: 'export：不要声音' },
      seconds: { type: 'number', description: 'frame：渲染哪一秒' },
      jobId: { type: 'string', description: 'cancel：任务 id' },
      format: { type: 'string', description: 'export：h264|hevc|prores 等' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    },
    async execute(args) {
      const config = loadConfig()
      const registry = loadRegistry(config)
      const action = args && args.action
      if (action === 'workspace') return workspacePayload(config, registry)
      if (action === 'projects') return { ok: true, projects: projectSummaries(config, registry) }
      if (action === 'open') {
        const project = resolveProject(registry, args.project)
        return projectDetail(config, project.file, { force: true })
      }
      if (action === 'assets') {
        const project = resolveProject(registry, args.project)
        return { ok: true, assets: readAssets(config, project.file) }
      }
      if (action === 'browse') {
        const dir = uniqSlashes(args.path || pathsOf(config.root).root)
        return { ok: true, dir: winPath(dir), entries: listDir(dir).map((entry) => entry.name).slice(0, 500) }
      }
      if (action === 'import') return Object.assign({ ok: true }, projectImport(config, registry, args))
      if (action === 'sequence') {
        if (args.create) return Object.assign({ ok: true }, projectCreateSequence(config, registry, args))
        throw new Error('sequence 需要 create:true（新建）或改用 project/merge')
      }
      if (action === 'merge') {
        const result = projectMerge(config, registry, args)
        saveRegistry(config, registry)
        if (args.export) {
          const job = jobStart(config, registry, Object.assign({ project: result.project.file, sequence: result.sequence.id }, args.export === true ? {} : args.export))
          return Object.assign({ ok: true }, result, { job: job })
        }
        return Object.assign({ ok: true }, result)
      }
      if (action === 'apply') return projectApply(config, registry, args)
      if (action === 'grade') {
        return args.clear ? gradeClearClips(config, registry, args) : gradeClips(config, registry, args)
      }
      if (action === 'undo') return projectUndo(config, registry, args)
      if (action === 'export') {
        const job = jobStart(config, registry, args)
        saveRegistry(config, registry)
        return { ok: true, job: job }
      }
      if (action === 'jobs') {
        jobRefresh(config, registry)
        return { ok: true, jobs: jobList(config) }
      }
      if (action === 'cancel') return jobCancel(config, registry, String(args.jobId || ''))
      if (action === 'frame') return previewFrame(config, Object.assign({}, args, { project: resolveProject(registry, args.project).file }))
      if (action === 'proxy') return previewProxy(config, Object.assign({}, args, { project: resolveProject(registry, args.project).file }))
      throw new Error('action 必须是 workspace|projects|open|assets|browse|import|sequence|merge|apply|grade|undo|export|jobs|cancel|frame|proxy')
    },
  }))
}
