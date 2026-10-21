// ── registry ────────────────────────────────────────────────────────────────
// The project list is *stored*, not re-derived from a directory on every read.
// A scan is only how a project gets into the list the first time; after that the
// list is the user's (renames, tags, removal of projects that sit outside the
// workspace root) and survives the files moving around.
//
// A project is addressed by id everywhere in the UI, but every engine call needs
// the .fcproj path, so `resolveProject` accepts either.

const PROJECT_REF_FIELDS = ['id', 'name', 'file', 'tags', 'note', 'createdAt', 'updatedAt']

function projectById(registry, id) {
  if (!id) return null
  for (const project of registry.projects) if (project.id === id) return project
  return null
}

function projectByFile(registry, file) {
  const target = uniqSlashes(file).toLowerCase()
  for (const project of registry.projects) if (uniqSlashes(project.file).toLowerCase() === target) return project
  return null
}

function resolveProject(registry, ref) {
  if (typeof ref !== 'string' || ref === '') throw new Error('缺少 project 参数（可以是 id 或 .fcproj 路径）')
  if (/\.fcproj$/i.test(ref) || ref.indexOf('/') >= 0 || ref.indexOf('\\') >= 0) {
    const file = uniqSlashes(ref)
    const known = projectByFile(registry, file)
    if (known) return known
    // An unregistered path is still usable — it just has no id yet.
    if (isFile(file)) {
      return { id: '', name: stemOf(file), file: file, tags: [], note: '', createdAt: nowIso(), updatedAt: nowIso() }
    }
    throw new Error('工程文件不存在: ' + winPath(file))
  }
  const found = projectById(registry, ref)
  if (!found) throw new Error('未知的项目: ' + ref)
  return found
}

function projectAdd(config, registry, file, meta) {
  const normalized = uniqSlashes(file)
  if (!isFile(normalized)) throw new Error('工程文件不存在: ' + winPath(normalized))
  const existing = projectByFile(registry, normalized)
  if (existing) {
    if (meta && typeof meta.name === 'string' && meta.name !== '') existing.name = meta.name
    existing.updatedAt = nowIso()
    return { project: existing, added: false }
  }
  const project = {
    id: uid('p'),
    name: (meta && meta.name) || stemOf(normalized),
    file: normalized,
    tags: (meta && Array.isArray(meta.tags)) ? meta.tags : [],
    note: (meta && typeof meta.note === 'string') ? meta.note : '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  registry.projects.push(project)
  return { project: project, added: true }
}

function projectRemove(registry, id) {
  const before = registry.projects.length
  registry.projects = registry.projects.filter((project) => project.id !== id)
  return before !== registry.projects.length
}

// Registration is cheap; this decorates each entry with what the list needs and
// nothing more (a full `projectDetail` per project would be dozens of processes).
function projectSummaries(config, registry) {
  return registry.projects.map((project) => {
    const stat = statOf(project.file)
    return {
      id: project.id,
      name: project.name,
      file: uniqSlashes(project.file),
      display: winPath(project.file),
      tags: Array.isArray(project.tags) ? project.tags : [],
      note: project.note || '',
      exists: !!stat,
      bytes: stat ? stat.size : 0,
      savedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }
  })
}

// First run on this machine: the previous version knew exactly one tree of
// projects (`D:\Myfiles\临时`). Adopt whatever it finds there once, so switching
// to a generic workspace does not look like losing everything.
function seedFromLegacy(config, registry) {
  const report = { scanned: [], added: [] }
  if (!isDir(LEGACY_ROOT)) return report
  const found = scanProjects(LEGACY_ROOT, 3)
  report.scanned = found.map((entry) => entry.file)
  for (const entry of found) {
    if (entry.bytes <= 0) continue
    if (projectByFile(registry, entry.file)) continue
    // `final.fcproj` was the superseded build of the same film; keep the project
    // list honest by skipping obvious rebuild leftovers.
    if (/^final\.fcproj$/i.test(baseOf(entry.file))) continue
    projectAdd(config, registry, entry.file, { name: entry.name })
    report.added.push(entry.file)
  }
  return report
}

// Grade presets. Built-ins ship with the plugin; anything the user saves lands in
// the same list with builtin:false and can be edited or deleted. This is the
// piece that used to be four hard-coded recipes in the client — it is data now,
// because "what a good grade looks like" is project knowledge, not plugin code.
function presetFind(registry, id) {
  for (const preset of registry.presets || []) if (preset.id === id) return preset
  return null
}

function presetList(registry) {
  return (registry.presets || []).map((preset) => ({
    id: preset.id,
    name: preset.name,
    color: preset.color || '#8b949e',
    builtin: preset.builtin === true,
    params: preset.params || {},
    hsl: preset.hsl || { on: false },
  }))
}

function presetSave(registry, input) {
  const id = (input && input.id) || uid('g')
  const existing = presetFind(registry, id)
  const next = {
    id: id,
    name: (input && input.name) || (existing ? existing.name : '未命名'),
    color: (input && input.color) || (existing ? existing.color : '#8b949e'),
    builtin: existing ? existing.builtin === true : false,
    params: Object.assign({}, existing ? existing.params : {}, (input && input.params) || {}),
    hsl: Object.assign({}, existing ? existing.hsl : { on: false }, (input && input.hsl) || {}),
  }
  if (existing) {
    if (existing.builtin === true) throw new Error('内置预设不可修改，请「另存为」新预设')
    Object.assign(existing, next)
    return existing
  }
  registry.presets.push(next)
  return next
}

function presetRemove(registry, id) {
  const preset = presetFind(registry, id)
  if (!preset) return false
  if (preset.builtin === true) throw new Error('内置预设不可删除')
  registry.presets = registry.presets.filter((entry) => entry.id !== id)
  return true
}
