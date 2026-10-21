// ── actions: projects, media, merge, presets, settings ──────────────────────
// Second layer of the store. 10-store.js covers "one open project, one selected
// clip"; this module covers everything that needs to look across projects or
// create one — which is what makes the panel usable for more than the single
// project it was originally written for.
//
// Every action follows the fcRun convention: one busy label, one error slot, and
// a notice on success, so the views never manage their own loading state.

Object.assign(store, {
  // A directory listing for the media picker. Kept separate from `assets`
  // because browsing is a filesystem view and assets is a project view.
  browse: { path: '', parent: '', dirs: [], files: [], projects: [] },
  browseOpen: false,
  // Media currently staged for merge or import (absolute paths, in chosen order).
  staging: [],
  multi: [],
  merge: {
    name: '',
    createName: '',
    createDir: '',
    exportAfter: false,
    settings: null,
    compat: null,
    result: null,
    tabs: 'staging',
  },
  settings: { root: '', cliPath: '', scanDepth: 4, open: false },
  assets: [],
  presets: [],
})

// fcErr() only formats a thrown value; it does not touch the store. Validation
// failures need the error slot filled, so they go through this instead.
function fcFail(text) {
  store.error = String(text || '')
  fcEmit()
}

function fcStagingIndex(path) {
  for (let i = 0; i < store.staging.length; i += 1) if (store.staging[i] === path) return i
  return -1
}

function fcStage(path) {
  if (!path) return
  if (fcStagingIndex(path) >= 0) { fcNotice('已经在待合并列表里'); return }
  store.staging.push(path)
  fcEmit()
}

function fcUnstage(path) {
  store.staging = store.staging.filter(function (entry) { return entry !== path })
  fcEmit()
}

function fcUnstageAll() {
  store.staging = []
  fcEmit()
}

// Reordering is the whole point of a merge UI, so both directions are explicit
// rather than a drag handle — the panel is too narrow for reliable dragging.
function fcStageMove(path, dir) {
  const index = fcStagingIndex(path)
  const next = index + (dir < 0 ? -1 : 1)
  if (index < 0 || next < 0 || next >= store.staging.length) return
  const list = store.staging.slice()
  const swapped = list[index]
  list[index] = list[next]
  list[next] = swapped
  store.staging = list
  fcEmit()
}

// ── browse ──────────────────────────────────────────────────────────────────
async function fcBrowse(path) {
  const result = await fcRun('读取目录', function () {
    return host.call('browse.read', { path: path || store.browse.path || '' })
  })
  if (!result) return
  store.browse = {
    path: result.path || '',
    parent: result.parent || '',
    dirs: Array.isArray(result.dirs) ? result.dirs : [],
    files: Array.isArray(result.files) ? result.files : [],
    projects: Array.isArray(result.projects) ? result.projects : [],
  }
  store.browseOpen = true
  fcEmit()
}

function fcBrowseUp() {
  if (store.browse.parent) fcBrowse(store.browse.parent)
}

// ── project registry (multi-project) ────────────────────────────────────────
async function fcProjectAdd(file, name) {
  const body = { action: 'add', file: file }
  if (name) body.name = name
  const result = await fcRun('登记工程', function () {
    return host.call('projects.write', body)
  })
  if (!result) return null
  store.projects = result.projects || store.projects
  fcNotice('已登记 ' + (result.project ? result.project.name : file))
  if (result.project) await fcOpenProject(result.project.id)
  return result
}

async function fcProjectRemove(id) {
  const result = await fcRun('移除工程', function () {
    return host.call('projects.write', { action: 'remove', project: id })
  })
  if (!result) return
  store.projects = result.projects || []
  if (store.detail && store.projectId === id) fcSetDetail(null)
  fcNotice('已从列表移除（文件本身没动）')
}

async function fcProjectRename(id, name) {
  if (!name) return
  const result = await fcRun('重命名工程', function () {
    return host.call('projects.write', { action: 'rename', project: id, name: name })
  })
  if (!result) return
  store.projects = result.projects || []
  fcNotice('已重命名')
}

async function fcRescan() {
  const result = await fcRun('重新扫描', function () {
    return host.call('projects.write', { action: 'rescan' })
  })
  if (!result) return
  store.projects = result.projects || []
  const found = Array.isArray(result.scanned) ? result.scanned.length : 0
  fcNotice('扫描到 ' + found + ' 个 .fcproj')
}

async function fcProjectCreate(file, name) {
  // A project cannot be created out of nothing by this engine: the CLI refuses a
  // path that does not exist yet. `--empty import … --save-as` is the documented
  // way to make one, so creating a project is always "create + import".
  const result = await fcRun('新建工程', function () {
    return host.call('projects.write', { action: 'add', file: file, name: name, create: true })
  })
  if (!result) return null
  store.projects = result.projects || store.projects
  if (result.project) await fcOpenProject(result.project.id)
  return result
}

// ── media ───────────────────────────────────────────────────────────────────
async function fcRefreshAssets() {
  if (!store.detail) return
  const result = await fcRun('读取素材', function () {
    return host.call('assets.read', { project: fcProjectRef() })
  })
  if (!result) return
  store.assets = Array.isArray(result.assets) ? result.assets : []
  fcEmit()
}

// Importing adds files to the project bin without touching the timeline. Placing
// them is a separate intent, so it stays a separate button.
async function fcImport(files) {
  const list = (files || store.staging).slice()
  if (list.length === 0) { fcFail('请先选素材'); return null }
  if (!store.detail) { fcFail('先打开一个工程'); return null }
  const result = await fcRun('导入素材 ' + list.length + ' 个', function () {
    return host.call('import.write', { project: fcProjectRef(), files: list })
  })
  if (!result) return null
  if (result.detail) fcSetDetail(result.detail, { keep: true })
  else await fcRefreshAssets()
  const errors = Array.isArray(result.errors) ? result.errors : []
  if (errors.length > 0) {
    store.error = '部分导入失败：' + (errors[0].error || errors[0])
    fcEmit()
  } else {
    fcNotice('已导入 ' + list.length + ' 个素材')
  }
  return result
}

async function fcPlaceStaging(options) {
  const list = (options && options.files ? options.files : store.staging).slice()
  if (list.length === 0) { fcFail('请先选素材'); return null }
  if (!store.detail) { fcFail('先打开一个工程'); return null }
  const sequence = fcSequence()
  const body = {
    project: fcProjectRef(),
    files: list,
    place: true,
    insert: options && options.insert === true,
    name: (options && options.name) || '序列 ' + ((store.detail.sequences || []).length + 1),
    width: sequence && sequence.width ? sequence.width : 1920,
    height: sequence && sequence.height ? sequence.height : 1080,
    fps: sequence && sequence.fps ? sequence.fps : 25,
  }
  const result = await fcRun('放置 ' + list.length + ' 段', function () {
    return host.call('import.write', body)
  })
  if (!result) return null
  if (result.detail) fcSetDetail(result.detail)
  fcNotice('已按顺序放到时间线')
  return result
}

// ── merge ───────────────────────────────────────────────────────────────────
async function fcMergeRun(options) {
  const request = options || {}
  const sources = store.staging.map(function (file) { return { file: file } })
  if (sources.length === 0) { fcFail('待合并列表是空的'); return null }
  const body = {
    sources: sources,
    name: request.name || store.merge.name || '合并序列',
  }
  if (request.createName) {
    body.create = { name: request.createName, dir: store.merge.createDir || undefined, overwrite: request.overwrite === true }
  } else if (store.merge.createName) {
    body.create = { name: store.merge.createName, dir: store.merge.createDir || undefined, overwrite: request.overwrite === true }
  } else {
    if (!store.detail) { fcFail('要么打开一个工程，要么填一个新工程名'); return null }
    body.project = fcProjectRef()
  }
  if (store.merge.settings) body.settings = store.merge.settings
  if (store.merge.exportAfter) {
    body.export = { scale: store.scale }
  }
  const result = await fcRun('合并 ' + sources.length + ' 段素材', function () {
    return host.call('merge.write', body)
  })
  if (!result) return null
  store.merge.result = result
  store.merge.compat = result.compat || null
  const list = await host.call('projects.list', {})
  store.projects = list && Array.isArray(list.projects) ? list.projects : store.projects
  if (result.detail) fcSetDetail(result.detail)
  if (result.job) {
    store.tab = 'jobs'
    fcNotice('合并完成，已开始导出')
    fcRefreshJobs().catch(function () { })
  } else {
    fcNotice('合并完成：' + (result.sequence ? result.sequence.name : '新序列') + ' · ' + sources.length + ' 段')
  }
  fcEmit()
  return result
}

// Merging into a brand-new project is the common case when the sources are not
// already part of anything, so the default name comes from the first file.
function fcMergeDefaultName() {
  if (store.staging.length === 0) return ''
  const first = store.staging[0].split(/[\\/]/).pop() || ''
  const stem = first.replace(/\.[^.]+$/, '')
  return store.staging.length === 1 ? stem : stem + ' 等 ' + store.staging.length + ' 段'
}

// ── export extras ───────────────────────────────────────────────────────────
async function fcInterchange(format) {
  if (!store.detail) return
  const result = await fcRun('导出 ' + String(format).toUpperCase(), function () {
    return host.call('project.write', {
      action: 'exportInterchange',
      project: fcProjectRef(),
      format: format,
      sequence: store.detail.activeSequence,
    })
  })
  if (!result) return
  fcNotice('已导出 ' + result.format + '：' + result.out.split(/[\\/]/).pop())
}

// ── sequences ───────────────────────────────────────────────────────────────
async function fcCreateSequence(options) {
  if (!store.detail) return null
  const sequence = fcSequence()
  const body = {
    action: 'create',
    project: fcProjectRef(),
    name: (options && options.name) || '序列 ' + ((store.detail.sequences || []).length + 1),
    width: (options && options.width) || (sequence && sequence.width) || 1920,
    height: (options && options.height) || (sequence && sequence.height) || 1080,
    fps: (options && options.fps) || (sequence && sequence.fps) || 25,
  }
  const result = await fcRun('新建序列', function () {
    return host.call('sequence.write', body)
  })
  if (result && result.detail) fcSetDetail(result.detail)
  if (result) fcNotice('已新建序列')
  return result
}

async function fcDeleteSequence(id) {
  const result = await fcRun('删除序列', function () {
    return host.call('sequence.write', { action: 'delete', project: fcProjectRef(), sequence: id })
  })
  if (result && result.detail) fcSetDetail(result.detail)
  if (result) fcNotice('已删除序列')
}

async function fcRenameSequence(id, name) {
  if (!name) return
  const result = await fcRun('重命名序列', function () {
    return host.call('sequence.write', { action: 'rename', project: fcProjectRef(), sequence: id, name: name })
  })
  if (result && result.detail) fcSetDetail(result.detail)
  if (result) fcNotice('已重命名')
}

// ── presets ─────────────────────────────────────────────────────────────────
async function fcPresetSave(preset) {
  const result = await fcRun('保存预设', function () {
    return host.call('presets.write', { action: 'save', preset: preset })
  })
  if (!result) return null
  store.workspace = Object.assign({}, store.workspace, { presets: result.presets })
  fcNotice('已保存预设「' + (result.preset ? result.preset.name : '') + '」')
  return result
}

async function fcPresetRemove(id) {
  const result = await fcRun('删除预设', function () {
    return host.call('presets.write', { action: 'remove', id: id })
  })
  if (!result) return
  store.workspace = Object.assign({}, store.workspace, { presets: result.presets })
  fcNotice('已删除预设')
}

// ── settings ────────────────────────────────────────────────────────────────
async function fcSetRoot(root) {
  const result = await fcRun('切换工作区', function () {
    return host.call('workspace.write', { action: 'setRoot', root: root })
  })
  if (!result) return
  store.workspace = result.workspace || store.workspace
  store.projects = result.projects || []
  fcSetDetail(null)
  fcNotice('工作区已切换到 ' + (result.workspace ? result.workspace.rootDisplay : root))
}

async function fcSetCli(cliPath) {
  const result = await fcRun('设置 CLI 路径', function () {
    return host.call('workspace.write', { action: 'setCli', cliPath: cliPath })
  })
  if (!result) return
  store.workspace = result.workspace || store.workspace
  fcNotice(result.workspace && result.workspace.cli && result.workspace.cli.exists ? 'CLI 可达' : '这个路径下找不到 filmcraft-cli')
}

// ── multi-select + batch grade ──────────────────────────────────────────────
// Batch operations are what "对不同的视频做处理" means in practice: pick several
// clips, apply one recipe to all of them, in one undo step.
function fcMultiToggle(clipId) {
  const list = store.multi.slice()
  const at = list.indexOf(clipId)
  if (at >= 0) list.splice(at, 1)
  else list.push(clipId)
  store.multi = list
  fcEmit()
}

function fcMultiSet(clipIds) {
  store.multi = (clipIds || []).slice()
  fcEmit()
}

function fcMultiAll() {
  const all = fcClips().map(function (clip) { return clip.clip })
  store.multi = store.multi.length === all.length ? [] : all
  fcEmit()
}

function fcMultiIds() {
  return store.multi.slice()
}

async function fcGradeMany(clipIds, presetId) {
  const ids = (clipIds && clipIds.length > 0 ? clipIds : store.multi).slice()
  if (ids.length === 0) { fcFail('先选片段'); return null }
  const preset = fcPreset(presetId)
  const result = await fcRun('批量调色 ' + ids.length + ' 段', function () {
    return host.call('grade.write', { project: fcProjectRef(), clips: ids, preset: presetId })
  })
  if (!result) return null
  if (result.detail) fcSetDetail(result.detail, { keep: true })
  const failed = Array.isArray(result.failed) ? result.failed : []
  if (failed.length > 0) {
    store.error = '有 ' + failed.length + ' 段失败：' + (failed[0].error || '')
  } else {
    fcNotice('已对 ' + ids.length + ' 段套用「' + (preset ? preset.name : presetId) + '」')
  }
  fcEmit()
  return result
}

async function fcGradeClearMany(clipIds) {
  const ids = (clipIds && clipIds.length > 0 ? clipIds : store.multi).slice()
  if (ids.length === 0) return null
  const result = await fcRun('清空调色 ' + ids.length + ' 段', function () {
    return host.call('grade.write', { project: fcProjectRef(), clips: ids, clear: true })
  })
  if (result && result.detail) fcSetDetail(result.detail, { keep: true })
  if (result) fcNotice('已清空 ' + ids.length + ' 段调色')
  return result
}
