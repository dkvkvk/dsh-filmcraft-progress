// ── jobs ────────────────────────────────────────────────────────────────────
// Long work — export, and merge-then-export — as records instead of a fire-and-
// forget spawn.
//
// The previous version wrote one contract file at a fixed path, which meant one
// export could exist at a time and nothing survived a restart. A job here is a
// small JSON file under <workspace>/jobs/, so several can coexist, the panel can
// list history, and a crash leaves evidence rather than a silent stall.
//
// Progress is sampled lazily, on read, from the output file's size and the
// child's liveness. Nothing here uses timers: the panel already polls while a job
// is in flight, and a host-side setInterval is a leak waiting to happen.

const CHILDREN = new Map()   // jobId -> ChildProcess (in-memory only)
const JOB_KEEP = 60          // records kept on disk

// Renders are ~0.6-0.8 s/frame at full scale and roughly scale² in time. Guesses
// before the first render are calibrated by the renders that follow, so an ETA
// becomes meaningful after one export of each scale.
function calibrationOf(registry) {
  const stats = registry.stats || {}
  const list = Array.isArray(stats.renders) ? stats.renders : []
  return list.slice(-10)
}
function expectedPerFrame(registry, scale) {
  const list = calibrationOf(registry)
  let seconds = 0
  let bytes = 0
  let count = 0
  for (const entry of list) {
    const entryScale = num(entry.scale, 1) || 1
    // Normalise to full scale so a 0.25 preview does not make the next full
    // render look five times slower than it is.
    seconds += num(entry.secPerFrame, 0) / (entryScale * entryScale)
    bytes += num(entry.bytesPerFrame, 0) / (entryScale * entryScale)
    count += 1
  }
  const baseSec = count > 0 ? seconds / count : 0.72
  const baseBytes = count > 0 ? bytes / count : 0
  const factor = scale * scale
  return { secPerFrame: baseSec * factor, bytesPerFrame: baseBytes * factor }
}
function recordRender(registry, scale, seconds, frames, bytes) {
  if (!registry.stats || typeof registry.stats !== 'object') registry.stats = {}
  if (!Array.isArray(registry.stats.renders)) registry.stats.renders = []
  if (frames <= 0) return
  registry.stats.renders.push({
    scale: scale,
    secPerFrame: Math.round((seconds / frames) * 1000) / 1000,
    bytesPerFrame: Math.round(bytes / frames),
    at: nowIso(),
  })
  while (registry.stats.renders.length > 20) registry.stats.renders.shift()
}

function jobDir(config) {
  const dir = pathsOf(config.root).jobs
  ensureDir(dir)
  return dir
}
function jobFile(config, id) { return joinPath(jobDir(config), id + '.json') }
function jobRead(config, id) {
  const value = readJson(jobFile(config, id), null)
  return value && typeof value === 'object' ? value : null
}
function jobWrite(config, job) { writeJsonAtomic(jobFile(config, job.id), job); return job }

function jobList(config) {
  const dir = jobDir(config)
  const jobs = []
  for (const entry of listDir(dir)) {
    if (!entry.isFile() || !/\.json$/.test(entry.name)) continue
    const job = readJson(joinPath(dir, entry.name), null)
    if (job && typeof job.id === 'string') jobs.push(job)
  }
  jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return jobs
}

function jobPrune(config) {
  const jobs = jobList(config)
  for (const job of jobs.slice(JOB_KEEP)) {
    try { unlinkSync(jobFile(config, job.id)) } catch (_) { }
  }
}

// Rewrites a running job's progress fields in place and returns whether it moved.
function jobSample(config, job, registry) {
  if (!job) return job
  if (job.state !== 'running') return job
  const now = Date.now()
  const started = job.startedAt ? Date.parse(job.startedAt) : now
  const elapsedMs = Math.max(0, now - started)
  const stat = statOf(job.out)
  const bytes = stat ? stat.size : 0
  const frames = num(job.expected && job.expected.frames, 0)
  const perFrame = job.expected && job.expected.secPerFrame ? job.expected.secPerFrame : 0

  // A file that has not grown for a while and whose child is gone is finished —
  // but the child is authoritative, so only use this for display.
  job.progress = {
    bytes: bytes,
    elapsedMs: elapsedMs,
    bytesPerSecond: elapsedMs > 1000 ? Math.round(bytes / (elapsedMs / 1000)) : 0,
    framesExpected: frames,
    ratio: perFrame > 0 && frames > 0
      ? clamp(elapsedMs / (perFrame * frames * 1000), 0, 0.999)
      : null,
  }
  if (job.progress.ratio !== null && job.progress.ratio > 0.02) {
    const total = elapsedMs / job.progress.ratio
    job.progress.etaMs = Math.max(0, Math.round(total - elapsedMs))
  } else if (bytes > 0 && num(job.expected && job.expected.bytes, 0) > 0) {
    job.progress.ratio = clamp(bytes / job.expected.bytes, 0, 0.999)
    job.progress.etaMs = Math.max(0, Math.round((elapsedMs / job.progress.ratio) - elapsedMs))
  } else {
    job.progress.etaMs = null
  }
  job.updatedAt = nowIso()
  jobWrite(config, job)
  return job
}

function jobRefresh(config, registry, id) {
  const target = id ? [jobRead(config, id)].filter(Boolean) : jobList(config)
  let changed = false
  for (const job of target) {
    if (job.state !== 'running') continue
    const child = CHILDREN.get(job.id)
    if (child === undefined) {
      // The record says running but this process is not the one that started it
      // (a host restart). There is no handle to wait on, so report what the disk
      // says and do not pretend to make progress.
      job.progress = job.progress || {}
      job.progress.orphan = true
      continue
    }
    if (child.exitCode === null && child.signalCode === null) {
      jobSample(config, job, registry)
      changed = true
      continue
    }
    // Settled.
    const log = readLogTail(job.log, 4000)
    const parsed = parseJsonText(log)
    const failed = child.exitCode !== 0 || (parsed && Array.isArray(parsed.offlineMedia) && parsed.offlineMedia.length > 0 && child.exitCode !== 0)
    job.state = child.exitCode === 0 ? 'done' : 'failed'
    job.endedAt = nowIso()
    job.pid = null
    job.error = job.state === 'failed'
      ? (parsed && parsed.error ? String(parsed.error) : tailText(log, 400) || ('导出进程退出码 ' + child.exitCode))
      : null
    if (parsed && parsed.result) {
      job.result = {
        frames: num(parsed.result.frames, 0),
        seconds: num(parsed.result.seconds, 0),
        renderFps: num(parsed.result.render_fps, 0),
        bytes: num(parsed.result.bytes, 0),
        path: parsed.result.path ? uniqSlashes(parsed.result.path) : job.out,
      }
      const elapsed = job.startedAt ? (Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 1000 : 0
      if (job.state === 'done' && elapsed > 0) recordRender(registry, num(job.scale, 1), elapsed, job.result.frames, job.result.bytes)
    } else if (job.state === 'done') {
      const statOut = statOf(job.out)
      job.result = { frames: num(job.expected && job.expected.frames, 0), seconds: 0, renderFps: 0, bytes: statOut ? statOut.size : 0, path: job.out }
    }
    job.progress = Object.assign({}, job.progress || {}, { ratio: job.state === 'done' ? 1 : job.progress && job.progress.ratio })
    jobWrite(config, job)
    CHILDREN.delete(job.id)
    changed = true
  }
  if (changed) saveRegistry(config, registry)
  return { jobs: target.map((job) => job), changed }
}

function readLogTail(path, limit) {
  if (!path) return ''
  try {
    const text = readFileSync(path, 'utf8')
    return text.length > limit ? text.slice(text.length - limit) : text
  } catch (_) { return '' }
}
function tailText(text, limit) {
  const trimmed = String(text || '').trim()
  if (trimmed === '') return ''
  const lines = trimmed.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return lines.slice(-4).join(' | ').slice(0, limit)
}

function jobStart(config, registry, request) {
  const project = resolveProject(registry, request.project)
  const detail = projectDetail(config, project.file, { force: true })
  let sequence = detail.sequence

  // `export` always renders the active sequence, so ask for another one by
  // activating it first (a separate process, hence --save there).
  const wanted = num(request.sequence, 0)
  if (wanted > 0 && (!sequence || sequence.id !== wanted)) {
    projectActivateSequence(config, project.file, wanted)
    sequence = projectDetail(config, project.file, { force: true }).sequence
  }
  if (!sequence) throw new Error('工程里没有可导出的序列')

  const paths = pathsOf(config.root)
  ensureDir(paths.exports)
  let out = request.out ? uniqSlashes(request.out) : ''
  if (out === '') {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    out = joinPath(paths.exports, (project.name || 'export') + '-' + stamp + '.mp4')
  }
  if (!/\.(mp4|mov|mxf|mkv|wav|aiff|png|tiff|bmp|gif)$/i.test(out)) out += '.mp4'
  ensureDir(dirOf(out))

  const scale = clamp(num(request.scale, 1), 0.05, 1)
  const startSec = request.start === undefined || request.start === null ? null : num(request.start, 0)
  const endSec = request.end === undefined || request.end === null ? null : num(request.end, 0)
  const seconds = startSec !== null && endSec !== null && endSec > startSec
    ? (endSec - startSec)
    : sequence.duration - (startSec === null ? 0 : startSec)
  const fps = sequence.fps > 0 ? sequence.fps : 24
  const frames = Math.max(1, Math.round(seconds * fps))
  const perf = expectedPerFrame(registry, scale)

  const args = ['--project', project.file, 'export', out]
  if (request.preset) args.push('--preset', String(request.preset))
  else if (request.format) args.push('--format', String(request.format))
  if (startSec !== null && endSec !== null && endSec > startSec) args.push('--start', String(startSec), '--end', String(endSec))
  if (scale < 1) args.push('--scale', String(scale))
  if (request.quality !== undefined && request.quality !== null) args.push('--quality', String(clamp(num(request.quality, 60), 0, 100)))
  if (request.noAudio === true) args.push('--no-audio')

  const job = {
    id: uid('j'),
    kind: 'export',
    state: 'running',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: nowIso(),
    endedAt: null,
    pid: null,
    error: null,
    project: { id: project.id, name: project.name, file: uniqSlashes(project.file) },
    sequence: { id: sequence.id, name: sequence.name, duration: sequence.duration, fps: fps },
    out: out,
    display: winPath(out),
    preset: request.preset || '',
    format: request.format || '',
    scale: scale,
    quality: request.quality === undefined ? null : num(request.quality, 0),
    noAudio: request.noAudio === true,
    range: startSec !== null ? { start: startSec, end: endSec } : null,
    expected: {
      frames: frames,
      seconds: seconds,
      secPerFrame: Math.round(perf.secPerFrame * 1000) / 1000,
      bytes: perf.bytesPerFrame > 0 ? Math.round(perf.bytesPerFrame * frames) : 0,
    },
    progress: { bytes: 0, elapsedMs: 0, ratio: 0, etaMs: null },
  }
  job.log = logPathFor(config, 'job-' + job.id)

  let fd = -1
  try { fd = openSync(job.log, 'w') } catch (_) { fd = -1 }
  const child = spawn(config.cliPath, args, {
    stdio: fd >= 0 ? ['ignore', fd, fd] : 'ignore',
    windowsHide: true,
    detached: false,
  })
  if (fd >= 0) { try { closeSync(fd) } catch (_) { } }
  child.on('error', (error) => {
    job.state = 'failed'
    job.error = String(error && error.message ? error.message : error)
    job.endedAt = nowIso()
    jobWrite(config, job)
    CHILDREN.delete(job.id)
  })
  CHILDREN.set(job.id, child)
  job.pid = child.pid || null
  jobWrite(config, job)
  jobPrune(config)
  return job
}

function jobCancel(config, registry, id) {
  const job = jobRead(config, id)
  if (!job) throw new Error('未知的任务: ' + id)
  if (job.state !== 'running') return { job: job, cancelled: false }
  const child = CHILDREN.get(id)
  if (child) {
    try { child.kill() } catch (_) { }
    CHILDREN.delete(id)
  } else if (job.pid) {
    // Started by a host process that is gone: kill by pid as a best effort.
    try { spawnSync('taskkill', ['/PID', String(job.pid), '/T', '/F'], { windowsHide: true }) } catch (_) { }
  }
  job.state = 'cancelled'
  job.endedAt = nowIso()
  job.error = '已取消'
  job.pid = null
  jobWrite(config, job)
  return { job: job, cancelled: true }
}

function jobRemove(config, id) {
  const job = jobRead(config, id)
  if (!job) return false
  if (job.state === 'running') jobCancel(config, {}, id)
  try { unlinkSync(jobFile(config, id)) } catch (_) { return false }
  return true
}
