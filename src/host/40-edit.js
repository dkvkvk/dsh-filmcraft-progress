// ── edit ────────────────────────────────────────────────────────────────────
// The operations the panel exposes, each of which is: take a copy of the project,
// run one or more engine commands against it, and hand back the fresh state.
//
// Snapshot-before-edit is not defensive decoration. `filmcraft-cli` is a
// one-shot process and `--save` overwrites in place, so a command that fails
// halfway (or one that succeeds at something nobody wanted) has no undo unless
// the bytes were copied first.

const GRADE_EFFECT = 'lumetri'
const STEP_CHUNK = 250

function runSteps(config, projectFile, steps, options) {
  const opts = options || {}
  const out = { ran: 0, failed: [], results: [] }
  for (let index = 0; index < steps.length; index += STEP_CHUNK) {
    const chunk = steps.slice(index, index + STEP_CHUNK)
    const run = engineRun(config, projectFile, chunk, { timeoutMs: opts.timeoutMs })
    out.ran += chunk.length
    for (let i = 0; i < run.results.length; i += 1) {
      const result = run.results[i] || {}
      out.results.push(result)
      if (result.ok === false) {
        out.failed.push({
          id: result.id || (chunk[i] ? chunk[i].id : '?'),
          line: result.line || 0,
          error: String(result.error || '失败'),
        })
      }
    }
  }
  projectInvalidate(projectFile)
  return out
}

// The HSL block is stored as an object but the engine wants flat parameters.
function gradeParamsOf(preset) {
  const flat = Object.assign({}, preset.params || {})
  const hsl = preset.hsl || {}
  flat.hsl_on = hsl.on === true
  if (hsl.on === true) {
    if (hsl.hue !== undefined) flat.hsl_hue = hsl.hue
    if (hsl.hueRange !== undefined) flat.hsl_hue_range = hsl.hueRange
    if (hsl.sat !== undefined) flat.hsl_sat = hsl.sat
    if (hsl.hueShift !== undefined) flat.hsl_hue_shift = hsl.hueShift
    if (hsl.temp !== undefined) flat.hsl_temp = hsl.temp
    if (hsl.tint !== undefined) flat.hsl_tint = hsl.tint
  }
  return flat
}

function clipHasEffect(clip, effectName) {
  for (const effect of clip.effects || []) {
    if (String(effect.effect).toLowerCase() === effectName.toLowerCase()) return true
  }
  return false
}

// A grade is one applied effect plus one setParam per parameter. Applied to 33
// clips that is ~430 commands, which is why they are chunked: past a few hundred
// lines the CLI's own output buffers get unwieldy and one bad parameter name
// would otherwise take the whole batch with it (--keep-going keeps the rest).
function gradeClips(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const preset = presetFind(registry, request.preset)
  if (!preset) throw new Error('未知的调色预设: ' + String(request.preset))
  const clips = Array.isArray(request.clips) ? request.clips.map((id) => num(id, 0)).filter((id) => id > 0) : []
  if (clips.length === 0) throw new Error('没有选中任何片段')

  const detail = projectDetail(config, project.file, { force: true })
  if (!detail.sequence) throw new Error('工程里没有激活的序列')
  const byId = new Map()
  for (const clip of detail.sequence.clips) byId.set(clip.clip, clip)

  const flat = gradeParamsOf(preset)
  const params = Object.keys(flat)
  const steps = []
  for (const clipId of clips) {
    const clip = byId.get(clipId)
    if (!clip) continue
    if (!clipHasEffect(clip, GRADE_EFFECT)) {
      steps.push({ id: 'effects.apply', params: { clips: [clipId], effect: GRADE_EFFECT } })
    }
    for (const key of params) {
      steps.push({ id: 'effects.setParam', params: { clip: clipId, effect: GRADE_EFFECT, param: key, value: flat[key] } })
    }
  }
  if (steps.length === 0) throw new Error('没有可套用的片段')

  snapshotTake(config, project.file)
  const run = runSteps(config, project.file, steps)
  return {
    applied: clips.length,
    preset: { id: preset.id, name: preset.name },
    commands: steps.length,
    failed: run.failed,
    detail: projectDetail(config, project.file, { force: true }),
  }
}

function gradeClearClips(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const clips = Array.isArray(request.clips) ? request.clips.map((id) => num(id, 0)).filter((id) => id > 0) : []
  if (clips.length === 0) throw new Error('没有选中任何片段')
  const detail = projectDetail(config, project.file, { force: true })
  if (!detail.sequence) throw new Error('工程里没有激活的序列')
  const steps = []
  for (const clip of detail.sequence.clips) {
    if (clips.indexOf(clip.clip) < 0) continue
    for (let index = clip.effects.length - 1; index >= 0; index -= 1) {
      if (String(clip.effects[index].effect).toLowerCase() !== GRADE_EFFECT) continue
      steps.push({ id: 'effects.reset', params: { clip: clip.clip, index: index } })
    }
  }
  if (steps.length === 0) return { cleared: 0, detail: detail }
  snapshotTake(config, project.file)
  const run = runSteps(config, project.file, steps)
  return { cleared: steps.length, failed: run.failed, detail: projectDetail(config, project.file, { force: true }) }
}

// Generic escape hatch: the panel sends whitelisted commands the same way an
// agent would, and gets the per-command outcome back rather than a bare ok.
function projectApply(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const commands = guardCommands(request.commands)
  // dry-run answers "what would this do" without touching the file. The engine
  // has no plan mode of its own (every command just runs), so what can be
  // promised honestly is the exact command list plus which of the referenced
  // clips exist right now — not a predicted timeline.
  if (request.dryRun === true) {
    const detail = projectDetail(config, project.file, { force: false })
    const known = new Set()
    if (detail.sequence) for (const clip of detail.sequence.clips) known.add(clip.clip)
    const referenced = []
    for (const command of commands) {
      const params = command.params || {}
      if (typeof params.clip === 'number') referenced.push(params.clip)
      for (const key of ['clips', 'items']) {
        if (Array.isArray(params[key])) for (const value of params[key]) if (typeof value === 'number') referenced.push(value)
      }
      if (Array.isArray(params.moves)) for (const move of params.moves) if (move && typeof move.clip === 'number') referenced.push(move.clip)
    }
    return {
      ok: true,
      dryRun: true,
      commands: commands.length,
      planned: commands,
      missingClips: referenced.filter((id) => !known.has(id)),
      activeSequence: detail.sequence ? { id: detail.sequence.id, clips: known.size, duration: detail.sequence.duration } : null,
    }
  }
  const snapshot = snapshotTake(config, project.file)
  const run = runSteps(config, project.file, commands)
  return {
    ok: run.failed.length === 0,
    ran: run.ran,
    failed: run.failed,
    snapshot: snapshot ? baseOf(snapshot) : null,
    detail: projectDetail(config, project.file, { force: true }),
  }
}

function projectUndo(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const result = snapshotUndo(config, project.file)
  if (!result.ok) throw new Error(result.error || '没有可撤销的操作')
  projectInvalidate(project.file)
  return Object.assign(result, { detail: projectDetail(config, project.file, { force: true }) })
}

// ── import ──────────────────────────────────────────────────────────────────
const MEDIA_EXT = /\.(mp4|mov|mxf|avi|mkv|m4v|wav|mp3|flac|aiff|aif|ogg|png|jpe?g|tiff?|bmp|exr|dpx)$/i
function guardMediaFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('没有选择素材文件')
  if (files.length > 200) throw new Error('一次最多导入 200 个文件')
  const checked = []
  for (const file of files) {
    const path = uniqSlashes(file)
    if (!MEDIA_EXT.test(path)) throw new Error('不支持的素材类型: ' + baseOf(path))
    if (!isFile(path)) throw new Error('文件不存在: ' + winPath(path))
    checked.push(path)
  }
  return checked
}

function projectImport(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const files = guardMediaFiles(request.files)
  snapshotTake(config, project.file)
  const result = engineExec(config, project.file, 'file.import', { paths: files }, { save: true })
  const items = result.json && Array.isArray(result.json.items) ? result.json.items : []
  const errors = result.json && Array.isArray(result.json.errors) ? result.json.errors : []
  projectInvalidate(project.file)
  return {
    items: items,
    files: files,
    errors: errors,
    detail: projectDetail(config, project.file, { force: true }),
  }
}

// Import + place in one command, for "add this to the timeline I am looking at".
function projectPasteMedia(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const files = guardMediaFiles(request.files)
  snapshotTake(config, project.file)
  const result = engineExec(config, project.file, 'edit.pasteMedia', {
    paths: files,
    insert: request.insert === true,
    place: request.place !== false,
  }, { save: true })
  projectInvalidate(project.file)
  return { result: result.json, detail: projectDetail(config, project.file, { force: true }) }
}

// ── sequences ───────────────────────────────────────────────────────────────
function projectCreateSequence(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const params = {
    name: request.name || '序列 ' + new Date().toISOString().slice(11, 19),
    width: num(request.width, 1920),
    height: num(request.height, 1080),
    fps: num(request.fps, 23.976),
    sampleRate: num(request.sampleRate, 48000),
    video: num(request.video, 3),
    audio: num(request.audio, 3),
  }
  snapshotTake(config, project.file)
  const result = engineExec(config, project.file, 'file.newSequence', params, { save: true })
  const sequenceId = result.json ? result.json.sequence : null
  if (typeof sequenceId !== 'number') throw new Error('创建序列失败')
  // A new sequence becomes active, but that is project state written by --save,
  // so re-read rather than assume.
  projectInvalidate(project.file)
  return { sequence: sequenceId, detail: projectDetail(config, project.file, { force: true }) }
}

function projectDeleteSequence(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const sequenceId = num(request.sequence, 0)
  if (sequenceId <= 0) throw new Error('缺少 sequence')
  snapshotTake(config, project.file)
  engineExec(config, project.file, 'project.delete', { items: [sequenceId] }, { save: true })
  projectInvalidate(project.file)
  return { deleted: sequenceId, detail: projectDetail(config, project.file, { force: true }) }
}

function projectRenameSequence(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const name = String(request.name || '').trim()
  if (name === '') throw new Error('序列名不能为空')
  // sequence.settings only ever applies to the active sequence.
  if (typeof request.sequence === 'number') projectActivateSequence(config, project.file, request.sequence)
  snapshotTake(config, project.file)
  engineExec(config, project.file, 'sequence.settings', { name: name }, { save: true })
  projectInvalidate(project.file)
  return { detail: projectDetail(config, project.file, { force: true }) }
}

// ── merge ───────────────────────────────────────────────────────────────────
// There is no concat/append/join command in the engine (700 commands, none of
// them), and no ffmpeg on this machine, so "合并" cannot mean byte concatenation
// — a raw `copy /b` of two MP4s produces a file whose moov atom points at the
// wrong offsets and will not play. What it means here is: put N sources on one
// timeline back-to-back and render that. `timeline.place` takes an `items` array
// and places them end to end in one undo step, which is exactly that.
const MERGE_DEFAULT = { width: 1920, height: 1080, fps: 23.976, sampleRate: 48000, video: 3, audio: 3 }

function mergeSettingsFrom(config, sources, explicit) {
  const settings = Object.assign({}, MERGE_DEFAULT)
  for (const source of sources) {
    if (typeof source.item !== 'number') continue
    // Nothing in the project tree carries frame size, so probe the file the item
    // points at. Only the first hit matters: mixing 4K drone footage with 1080p
    // is a decision for the user, not an average.
    if (source.path && isFile(source.path)) {
      const probe = probeMedia(config, source.path)
      if (probe && probe.width > 0 && probe.height > 0) {
        settings.width = probe.width
        settings.height = probe.height
        if (probe.fps > 0) settings.fps = Math.round(probe.fps * 1000) / 1000
        break
      }
    }
  }
  for (const key of Object.keys(MERGE_DEFAULT)) {
    if (explicit && explicit[key] !== undefined && explicit[key] !== null && explicit[key] !== '') {
      settings[key] = num(explicit[key], settings[key])
    }
  }
  return settings
}

// Mixed footage is the normal case (a 4K drone clip next to a 1080p phone clip),
// and the engine will happily scale it into whatever sequence settings it was
// given — silently letterboxing or cropping. Checking before the render means the
// panel can say "this will be padded / this will be scaled 2:1" instead of the
// user discovering it in the exported file.
function mergeCompat(config, sources, settings) {
  const rows = []
  const probeLimit = 12
  for (let i = 0; i < sources.length && i < probeLimit; i += 1) {
    const source = sources[i] || {}
    if (!source.path || !isFile(source.path)) continue
    const probe = probeMedia(config, source.path)
    if (!probe || probe.width <= 0) continue
    const sameSize = probe.width === settings.width && probe.height === settings.height
    const fpsMatch = Math.abs(probe.fps - settings.fps) < 0.01
    rows.push({
      index: i,
      name: baseOf(source.path),
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      sameSize: sameSize,
      fpsMatch: fpsMatch,
    })
  }
  const mixedSize = rows.filter((row) => !row.sameSize)
  const mixedFps = rows.filter((row) => !row.fpsMatch)
  const warnings = []
  if (mixedSize.length > 0) {
    warnings.push(mixedSize.length + ' 段素材与序列尺寸不同，导出时会被缩放或补边')
  }
  if (mixedFps.length > 0) {
    warnings.push(mixedFps.length + ' 段素材帧率不同，将被重采样到 ' + settings.fps + ' fps')
  }
  return {
    checked: rows.length,
    rows: rows,
    mixedSize: mixedSize.length,
    mixedFps: mixedFps.length,
    warnings: warnings,
  }
}

function projectMerge(config, registry, request) {
  const sources = Array.isArray(request.sources) ? request.sources : []
  if (sources.length === 0) throw new Error('合并至少要有一个素材')
  if (sources.length > 200) throw new Error('一次最多合并 200 个素材')

  // 1. target project: an existing one, or a brand new file
  let projectFile
  let created = false
  if (request.create && request.create.name) {
    const dir = uniqSlashes(request.create.dir || pathsOf(config.root).projects || pathsOf(config.root).work)
    ensureDir(dir)
    const safe = String(request.create.name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'merge'
    projectFile = joinPath(dir, safe + '.fcproj')
    if (isFile(projectFile) && request.create.overwrite !== true) {
      throw new Error('工程已存在: ' + winPath(projectFile))
    }
    if (isFile(projectFile)) { copyFileSync(projectFile, projectFile + '.bak-' + Date.now()) }
    created = true
  } else {
    projectFile = resolveProject(registry, request.project || request.target).file
  }

  // 2. import whatever is not an existing item yet, keeping the caller's order
  const files = []
  const fileIndex = []
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i] || {}
    if (typeof source.item === 'number' && source.item > 0) continue
    if (typeof source.file !== 'string' || source.file === '') throw new Error('第 ' + (i + 1) + ' 个素材既没有 item 也没有 file')
    fileIndex.push(i)
    files.push(uniqSlashes(source.file))
  }
  let importedItems = []
  if (files.length > 0) {
    const checked = guardMediaFiles(files)
    if (created) {
      // A brand new project has nothing to snapshot; `--empty import --save-as`
      // creates the file and imports in one process.
      const result = engineJson(config, ['import', ...checked, '--save-as', projectFile], { empty: true, what: '创建工程并导入' })
      importedItems = result.json && Array.isArray(result.json.items) ? result.json.items : []
    } else {
      snapshotTake(config, projectFile)
      const result = engineExec(config, projectFile, 'file.import', { paths: checked }, { save: true })
      importedItems = result.json && Array.isArray(result.json.items) ? result.json.items : []
    }
  }
  const itemIds = []
  let cursor = 0
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i] || {}
    if (typeof source.item === 'number' && source.item > 0) { itemIds.push(source.item); continue }
    itemIds.push(importedItems[cursor]); cursor += 1
  }
  if (itemIds.some((id) => typeof id !== 'number' || id <= 0)) throw new Error('导入素材失败，未能拿到素材 id')

  // 3. what will the new sequence look like?
  const existing = created ? null : projectDetail(config, projectFile, { force: true })
  const assets = existing ? existing.assets : []
  const byItem = new Map()
  for (const asset of assets) byItem.set(asset.item, asset)
  const enriched = itemIds.map((item) => ({ item: item, path: byItem.has(item) ? byItem.get(item).path : '' }))
  // Imported files are not in the (cached) asset list yet — the paths are known.
  for (let i = 0; i < enriched.length; i += 1) {
    if (enriched[i].path === '' && importedItems.indexOf(enriched[i].item) >= 0) {
      enriched[i].path = uniqSlashes(files[importedItems.indexOf(enriched[i].item)])
    }
  }
  const settings = mergeSettingsFrom(config, enriched, request.settings)
  const compat = request.checkCompat === false ? null : mergeCompat(config, enriched, settings)

  // 4. empty sequence, then place everything back to back
  if (!created) snapshotTake(config, projectFile)
  const name = request.name || ('合并 ' + new Date().toISOString().slice(5, 16).replace(/[:T]/g, '-'))
  const sequenceResult = engineExec(config, projectFile, 'file.newSequence', {
    name: name,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    sampleRate: settings.sampleRate,
    video: settings.video,
    audio: settings.audio,
  }, { save: true })
  const sequenceId = sequenceResult.json ? sequenceResult.json.sequence : null
  if (typeof sequenceId !== 'number') throw new Error('创建序列失败')

  const placeResult = engineExec(config, projectFile, 'timeline.place', {
    items: itemIds,
    track: 'V1',
    audioTrack: 'A1',
    time: 0,
  }, { save: true })
  if (!placeResult.ok) throw engineError({ stdout: placeResult.text, timedOut: false, status: placeResult.status }, '放置素材')

  // 5. register the project so it shows up in the list even when it was created
  //    outside the workspace root.
  const added = projectAdd(config, registry, projectFile, { name: request.create ? request.create.name : undefined })

  projectInvalidate(projectFile)
  return {
    project: { id: added.project.id, name: added.project.name, file: uniqSlashes(projectFile), created: created },
    sequence: { id: sequenceId, name: name },
    itemIds: itemIds,
    placed: placeResult.json ? placeResult.json.placed : null,
    settings: settings,
    compat: compat,
    detail: projectDetail(config, projectFile, { force: true }),
  }
}
