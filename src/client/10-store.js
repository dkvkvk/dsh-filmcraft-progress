// ── store ───────────────────────────────────────────────────────────────────
// One store for the whole client half: the panel, the footer status and the
// fallback drawer all read it. It holds no React state, so every action below is
// testable without a renderer — `fcEmit()` is the only bridge to the views.
//
// The server is the source of truth. Nothing here caches a project or a job:
// each mutation returns the fresh detail (the host re-reads it), and the store
// just adopts it. That is what keeps the panel honest after an edit — there is
// no second copy of the timeline to drift out of date.

const TICKS = 254016000000
const PROXY_MAX = 20

const store = {
  booted: false,
  mounted: false,
  workspace: null,
  projects: [],
  detail: null,
  projectId: '',
  jobs: [],
  legacy: null,
  tab: 'projects',
  clipId: null,
  scrub: 0,
  frameUrl: '',
  frameError: '',
  frameBusy: false,
  frameQueued: null,
  proxyUrl: '',
  proxyError: '',
  proxyBusy: false,
  proxySeconds: 3,
  prevOpen: true,
  out: '',
  format: 'h264',
  scale: 1,
  busy: '',
  error: '',
  notice: '',
  version: 0,
  listeners: new Set(),
  pollTimer: null,
  scrubTimer: null,
  noticeTimer: null,
}

function fcEmit() {
  store.version += 1
  const list = Array.from(store.listeners)
  for (const listener of list) {
    try { listener() } catch (_) { }
  }
}

function fcErr(error) {
  return error && error.message ? error.message : String(error)
}

function fcNotice(text) {
  store.notice = String(text || '')
  if (store.noticeTimer !== null) clearTimeout(store.noticeTimer)
  store.noticeTimer = setTimeout(function () {
    store.noticeTimer = null
    store.notice = ''
    fcEmit()
  }, 2600)
  fcEmit()
}

// ── formatting ──────────────────────────────────────────────────────────────
function fcPad(n) { return String(n).padStart(2, '0') }
function fcTime(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—'
  const total = Math.round(sec * 10) / 10
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(1)
}
function fcSeconds(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—'
  return sec.toFixed(1) + 's'
}
function fcBytes(bytes) {
  const value = Number(bytes) || 0
  if (value <= 0) return '0 B'
  if (value < 1024) return value + ' B'
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB'
  return (value / 1073741824).toFixed(2) + ' GB'
}
function fcDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (total < 60) return total + 's'
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return minutes + 'm' + fcPad(rest) + 's'
  return Math.floor(minutes / 60) + 'h' + fcPad(minutes % 60) + 'm'
}
function fcAgo(iso) {
  const ms = Date.parse(iso)
  if (!isFinite(ms)) return ''
  const delta = Math.max(0, Date.now() - ms)
  if (delta < 60000) return Math.round(delta / 1000) + ' 秒前'
  if (delta < 3600000) return Math.round(delta / 60000) + ' 分钟前'
  if (delta < 86400000) return Math.round(delta / 3600000) + ' 小时前'
  return Math.round(delta / 86400000) + ' 天前'
}
// File names are the only thing that identifies two takes of the same shot, and
// the panel column is ~30 characters wide, so keep the head and the tail.
function fcShort(name, limit) {
  const text = String(name || '')
  const max = limit || 34
  if (text.length <= max) return text
  const keep = Math.floor((max - 1) / 2)
  return text.slice(0, keep) + '…' + text.slice(text.length - (max - keep - 1))
}

// ── lookups ─────────────────────────────────────────────────────────────────
function fcProjectRef() {
  if (store.projectId) return store.projectId
  return store.detail ? store.detail.path : ''
}
function fcSequence() {
  return store.detail && store.detail.sequence ? store.detail.sequence : null
}
function fcClips() {
  const sequence = fcSequence()
  if (!sequence) return []
  return sequence.clips.filter(function (clip) { return clip.kind === 'video' })
}
function fcSelectedClip() {
  const clips = fcClips()
  for (const clip of clips) if (clip.clip === store.clipId) return clip
  return null
}
function fcPreset(id) {
  const presets = store.workspace && Array.isArray(store.workspace.presets) ? store.workspace.presets : []
  for (const preset of presets) if (preset.id === id) return preset
  return null
}
// The engine's colour effect is called `lumetri`; the presets are only parameter
// values on it. "Has a grade" therefore means "carries that effect", not "carries
// one of our four recipes".
function fcHasGrade(clip) {
  if (!clip || !Array.isArray(clip.effects)) return false
  for (const effect of clip.effects) {
    if (String(effect.effect).toLowerCase() === 'lumetri') return true
  }
  return false
}
function fcRunningJobs() {
  return store.jobs.filter(function (job) { return job.state === 'running' })
}

// ── request helper ──────────────────────────────────────────────────────────
// Every write goes through here so there is exactly one place that clears the
// previous error, one place that formats a failure, and one busy flag the views
// can disable buttons with.
async function fcRun(label, fn) {
  store.busy = label || ''
  store.error = ''
  fcEmit()
  try {
    return await fn()
  } catch (error) {
    store.error = (label ? label + '：' : '') + fcErr(error)
    return null
  } finally {
    store.busy = ''
    fcEmit()
  }
}

// ── data ────────────────────────────────────────────────────────────────────
async function fcRefreshJobs() {
  const result = await host.call('jobs.read', {})
  store.jobs = result && Array.isArray(result.jobs) ? result.jobs : []
  fcEmit()
}

async function fcBoot() {
  if (store.booted) return
  store.booted = true
  await fcRun('加载工作区', async function () {
    store.workspace = await host.call('workspace.read', {})
    const list = await host.call('projects.list', {})
    store.projects = list && Array.isArray(list.projects) ? list.projects : []
  })
  try { store.legacy = await host.call('state.read', {}) } catch (_) { store.legacy = null }
  try { await fcRefreshJobs() } catch (_) { }
  fcEmit()
}

function fcDropUrls() {
  if (store.frameUrl) { try { URL.revokeObjectURL(store.frameUrl) } catch (_) { } }
  if (store.proxyUrl) { try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { } }
  store.frameUrl = ''
  store.proxyUrl = ''
}

function fcSetDetail(detail, options) {
  const keep = !!(options && options.keep)
  fcDropUrls()
  store.detail = detail || null
  store.projectId = detail && detail.projectId ? detail.projectId : ''
  if (!keep) store.scrub = 0
  // Clip ids are only meaningful inside one project, so a multi-select carried
  // across a project switch would silently point at the wrong clips.
  store.multi = []
  const clips = fcClips()
  let found = false
  for (const clip of clips) if (clip.clip === store.clipId) found = true
  if (!found) store.clipId = clips.length > 0 ? clips[0].clip : null
  fcEmit()
  // Every detail read is a chance that the picture changed (an edit, a sequence
  // switch, a different project). Refreshing it here keeps the preview honest
  // without the views needing to watch mtimes.
  if (store.prevOpen) {
    const clip = fcSelectedClip()
    if (clip && store.detail && store.detail.sequence) fcFrame(clip.start + store.scrub)
  }
}

async function fcOpenProject(id) {
  if (!id) return
  const detail = await fcRun('打开工程', function () {
    return host.call('project.read', { project: id })
  })
  if (detail) {
    fcSetDetail(detail)
    fcNotice('已打开「' + (detail.name || detail.projectName || '') + '」')
    fcRefreshAssets().catch(function () { })
  }
}

async function fcRefreshProject() {
  if (!store.detail) return
  const detail = await fcRun('刷新工程', function () {
    return host.call('project.read', { project: store.detail.path, force: true })
  })
  if (detail) fcSetDetail(detail, { keep: true })
}

async function fcScan() {
  const result = await fcRun('扫描工程', function () {
    return host.call('projects.list', { rescan: true })
  })
  if (!result) return
  store.projects = result.projects || []
  const found = Array.isArray(result.scanned) ? result.scanned.length : 0
  fcNotice('扫描到 ' + found + ' 个工程文件，列表里 ' + store.projects.length + ' 个')
}

async function fcNewSequence() {
  if (!store.detail) return
  const sequence = fcSequence()
  const body = {
    action: 'create',
    project: fcProjectRef(),
    name: '序列 ' + (store.detail.sequences ? store.detail.sequences.length + 1 : 1),
    width: sequence && sequence.width ? sequence.width : 1920,
    height: sequence && sequence.height ? sequence.height : 1080,
    fps: sequence && sequence.fps ? sequence.fps : 23.976,
  }
  const result = await fcRun('新建序列', function () {
    return host.call('sequence.write', body)
  })
  if (result && result.detail) fcSetDetail(result.detail)
  if (result) fcNotice('已新建序列')
}

async function fcActivateSequence(id) {
  if (!store.detail) return
  const result = await fcRun('切换序列', function () {
    return host.call('project.write', { action: 'activate', project: fcProjectRef(), sequence: id })
  })
  if (result && result.detail) fcSetDetail(result.detail)
}

// ── editing ─────────────────────────────────────────────────────────────────
async function fcEdit(commands, label) {
  const result = await fcRun(label, function () {
    return host.call('edit.write', { project: fcProjectRef(), commands: commands })
  })
  if (!result) return null
  if (result.detail) fcSetDetail(result.detail, { keep: true })
  const failed = Array.isArray(result.failed) ? result.failed : []
  if (failed.length > 0) {
    store.error = label + '失败：' + failed[0].error
    fcEmit()
  } else {
    fcNotice(label + '完成')
  }
  return result
}

function fcTrim(edge, deltaSec) {
  const clip = fcSelectedClip()
  if (!clip) return
  const delta = Math.round(deltaSec * TICKS)
  fcEdit([{ id: 'timeline.trim', params: { clip: clip.clip, edge: edge, mode: 'ripple', delta: delta } }],
    (edge === 'in' ? '裁头 ' : '裁尾 ') + (deltaSec > 0 ? '+' : '') + deltaSec + 's ')
}

function fcDeleteClip() {
  const clip = fcSelectedClip()
  if (!clip) return
  fcEdit([{ id: 'edit.rippleDelete', params: { clips: [clip.clip] } }], '删除片段 ')
}

function fcMoveClip(dir) {
  const clip = fcSelectedClip()
  if (!clip) return
  const clips = fcClips()
  const index = clips.indexOf(clip)
  const next = clips[dir < 0 ? index - 1 : index + 1]
  if (!next) return
  // Swap by moving each clip to the other's start time. Two commands, one
  // snapshot: the host treats the batch as a single undo step.
  fcEdit([
    { id: 'timeline.move', params: { moves: [{ clip: clip.clip, track: clip.track, time: Math.round(next.start * TICKS) }] } },
    { id: 'timeline.move', params: { moves: [{ clip: next.clip, track: next.track, time: Math.round(clip.start * TICKS) }] } },
  ], dir < 0 ? '上移 ' : '下移 ')
}

function fcToggleClip() {
  const clip = fcSelectedClip()
  if (!clip) return
  fcEdit([{ id: 'clip.enable', params: { clips: [clip.clip] } }], clip.enabled ? '停用片段 ' : '启用片段 ')
}

async function fcApplyGrade(presetId) {
  const clip = fcSelectedClip()
  if (!clip || !presetId) return
  const preset = fcPreset(presetId)
  const result = await fcRun('套用调色', function () {
    return host.call('grade.write', { project: fcProjectRef(), clips: [clip.clip], preset: presetId })
  })
  if (!result) return
  if (result.detail) fcSetDetail(result.detail, { keep: true })
  const failed = Array.isArray(result.failed) ? result.failed : []
  if (failed.length > 0) {
    store.error = '套用调色失败：' + failed[0].error
    fcEmit()
    return
  }
  fcNotice('已套用「' + (preset ? preset.name : presetId) + '」')
}

async function fcClearGrade() {
  const clip = fcSelectedClip()
  if (!clip) return
  const result = await fcRun('清空调色', function () {
    return host.call('grade.write', { project: fcProjectRef(), clips: [clip.clip], clear: true })
  })
  if (result && result.detail) fcSetDetail(result.detail, { keep: true })
  if (result) fcNotice('已清空调色')
}

async function fcUndo() {
  if (!store.detail) return
  const result = await fcRun('撤销', function () {
    return host.call('undo.write', { project: fcProjectRef() })
  })
  if (result && result.detail) {
    fcSetDetail(result.detail, { keep: true })
    fcNotice('已撤销一步')
  }
}

// ── preview ─────────────────────────────────────────────────────────────────
async function fcFrame(seconds) {
  if (!store.detail || !fcSequence()) return
  if (store.frameBusy) { store.frameQueued = seconds; return }
  store.frameBusy = true
  store.frameError = ''
  fcEmit()
  try {
    const result = await host.call('frame.read', { project: fcProjectRef(), seconds: seconds, scale: 0.25 })
    const blob = await host.blob('media.read', { name: result.name })
    const url = URL.createObjectURL(blob)
    if (store.frameUrl) { try { URL.revokeObjectURL(store.frameUrl) } catch (_) { } }
    store.frameUrl = url
  } catch (error) {
    store.frameError = fcErr(error)
  } finally {
    store.frameBusy = false
    fcEmit()
    if (store.frameQueued !== null) {
      const next = store.frameQueued
      store.frameQueued = null
      fcFrame(next)
    }
  }
}

// Scrubbing should not spawn one render process per pixel. 400 ms after the last
// move is slow enough to coalesce a drag and fast enough to feel immediate.
function fcScrub(seconds) {
  store.scrub = Math.max(0, Number(seconds) || 0)
  fcEmit()
  if (!store.prevOpen) return
  if (store.scrubTimer !== null) clearTimeout(store.scrubTimer)
  store.scrubTimer = setTimeout(function () {
    store.scrubTimer = null
    const clip = fcSelectedClip()
    if (clip) fcFrame(clip.start + store.scrub)
  }, 400)
}

async function fcProxy() {
  const clip = fcSelectedClip()
  if (!clip || store.proxyBusy) return
  const span = Math.max(0.5, Math.min(store.proxySeconds, PROXY_MAX, clip.dur - store.scrub))
  store.proxyBusy = true
  store.proxyError = ''
  fcEmit()
  try {
    const result = await host.call('proxy.write', {
      project: fcProjectRef(),
      start: clip.start + store.scrub,
      seconds: span,
      scale: 0.5,
      quality: 60,
    })
    const blob = await host.blob('media.read', { name: result.name })
    const url = URL.createObjectURL(blob)
    if (store.proxyUrl) { try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { } }
    store.proxyUrl = url
    fcNotice('预览片段已生成（' + span.toFixed(1) + 's）')
  } catch (error) {
    store.proxyError = fcErr(error)
  } finally {
    store.proxyBusy = false
    fcEmit()
  }
}

function fcWholeClip() {
  const clip = fcSelectedClip()
  if (!clip) return
  store.proxySeconds = Math.max(0.5, Math.min(clip.dur, PROXY_MAX))
  fcScrub(0)
  fcEmit()
}

// ── export ──────────────────────────────────────────────────────────────────
async function fcExport() {
  if (!store.detail) return
  const body = { project: fcProjectRef(), format: store.format, scale: store.scale }
  if (store.detail.activeSequence !== null && store.detail.activeSequence !== undefined) body.sequence = store.detail.activeSequence
  if (store.out) body.out = store.out
  const result = await fcRun('开始导出', function () {
    return host.call('export.write', body)
  })
  if (!result || !result.job) return
  store.tab = 'jobs'
  fcNotice('导出已开始')
  try { await fcRefreshJobs() } catch (_) { }
  fcEmit()
}

async function fcJobAction(action, id) {
  const result = await fcRun(action === 'cancel' ? '取消任务' : '移除任务', function () {
    return host.call('jobs.write', { action: action, id: id })
  })
  if (!result) return
  try { await fcRefreshJobs() } catch (_) { }
}

// Polling exists only while a job is in flight: the host samples the output file
// on read, so there is nothing to gain from asking when nothing is running.
function fcEnsurePolling() {
  if (store.pollTimer !== null) return
  store.pollTimer = setInterval(function () {
    if (!store.mounted) return
    if (fcRunningJobs().length === 0) return
    fcRefreshJobs().catch(function () { })
  }, 1500)
}

function fcSet(patch) {
  for (const key of Object.keys(patch)) store[key] = patch[key]
  fcEmit()
}
