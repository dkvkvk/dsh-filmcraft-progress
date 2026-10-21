// ── preview ─────────────────────────────────────────────────────────────────
// Stills and short proxy clips, rendered through the engine and cached on disk.
//
// Two hard rules here:
//
//   · renders are serialised. Two `render` processes on the same project at once
//     produce truncated PNGs — the engine writes in place and there is no lock.
//   · the host must stay responsive. `spawnSync` would block the whole harness for
//     a second per frame, so previews use async spawn behind a promise chain.
//
// The cache key includes the project's mtime, so any edit invalidates every
// cached frame of that project without any explicit bookkeeping.

const PREVIEW_CACHE = new Map()
const PREVIEW_KEEP = 240
let previewChain = Promise.resolve()

function hashKey(text) {
  // FNV-1a, 32 bit, hex. Short, stable, and no crypto import.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function previewDir(config) {
  const dir = pathsOf(config.root).previews
  ensureDir(dir)
  return dir
}

function previewEnqueue(task) {
  const next = previewChain.then(task, task)
  // Swallow the tail so one failed render does not poison the chain.
  previewChain = next.then(() => { }, () => { })
  return next
}

function runAsync(config, args, label, timeoutMs) {
  return new Promise((resolve) => {
    const log = logPathFor(config, label)
    let fd = -1
    try { fd = openSync(log, 'w') } catch (_) { fd = -1 }
    let child
    try {
      child = spawn(config.cliPath, args, {
        stdio: fd >= 0 ? ['ignore', fd, fd] : 'ignore',
        windowsHide: true,
      })
    } catch (error) {
      if (fd >= 0) { try { closeSync(fd) } catch (_) { } }
      return resolve({ code: -1, text: String(error && error.message ? error.message : error) })
    }
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (fd >= 0) { try { closeSync(fd) } catch (_) { } }
      let text = ''
      try { text = readFileSync(log, 'utf8') } catch (_) { }
      resolve({ code: code, text: text })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch (_) { }
      finish(-2)
    }, timeoutMs || 120000)
    child.on('close', (code) => finish(code))
    child.on('error', () => finish(-1))
  })
}

function prunePreviews(dir) {
  const files = []
  for (const entry of listDir(dir)) {
    if (!entry.isFile()) continue
    const full = joinPath(dir, entry.name)
    const stat = statOf(full)
    files.push({ file: full, at: stat ? stat.mtimeMs : 0 })
  }
  if (files.length <= PREVIEW_KEEP) return
  files.sort((a, b) => a.at - b.at)
  for (const item of files.slice(0, files.length - PREVIEW_KEEP)) {
    try { unlinkSync(item.file) } catch (_) { }
  }
}

function previewStamp(projectFile) {
  const stat = statOf(projectFile)
  return stat ? String(stat.mtimeMs) : '0'
}

// One Program frame as PNG. Returns { name, cached, seconds } where `name` is the
// cache file's basename, which the client then fetches through /media.
function previewFrame(config, request) {
  const projectFile = uniqSlashes(request.project)
  if (!isFile(projectFile)) throw new Error('工程文件不存在: ' + winPath(projectFile))
  const seconds = clamp(num(request.seconds, 0), 0, 24 * 3600)
  const scale = clamp(num(request.scale, 0.25), 0.05, 1)
  const key = hashKey(projectFile + '|' + previewStamp(projectFile) + '|' + seconds.toFixed(3) + '|' + scale.toFixed(2))
  const name = 'frame-' + key + '.png'
  const dir = previewDir(config)
  const target = joinPath(dir, name)
  const cached = PREVIEW_CACHE.has(key) || isFile(target)
  if (cached) {
    const stat = statOf(target)
    return { name: name, cached: true, seconds: seconds, scale: scale, bytes: stat ? stat.size : 0 }
  }
  return previewEnqueue(() => {
    if (isFile(target)) {
      const stat = statOf(target)
      PREVIEW_CACHE.set(key, true)
      return { name: name, cached: true, seconds: seconds, scale: scale, bytes: stat ? stat.size : 0 }
    }
    const started = Date.now()
    return runAsync(config, [
      '--project', projectFile, 'render',
      '--seconds', String(seconds),
      '--out', target,
      '--scale', String(scale),
    ], 'render-' + key, 90000).then((result) => {
      if (!isFile(target)) {
        throw new Error('渲染失败: ' + (tailText(result.text, 300) || ('退出码 ' + result.code)))
      }
      PREVIEW_CACHE.set(key, true)
      prunePreviews(dir)
      const stat = statOf(target)
      return {
        name: name, cached: false, seconds: seconds, scale: scale,
        bytes: stat ? stat.size : 0, ms: Date.now() - started,
      }
    })
  })
}

// A few seconds of the sequence at reduced quality, for checking motion and
// grade without paying for a full render.
function previewProxy(config, request) {
  const projectFile = uniqSlashes(request.project)
  if (!isFile(projectFile)) throw new Error('工程文件不存在: ' + winPath(projectFile))
  const start = clamp(num(request.start, 0), 0, 24 * 3600)
  const length = clamp(num(request.seconds, 3), 0.4, 20)
  const scale = clamp(num(request.scale, 0.5), 0.1, 1)
  const quality = clamp(num(request.quality, 60), 20, 90)
  const key = hashKey(projectFile + '|' + previewStamp(projectFile) + '|proxy|'
    + start.toFixed(2) + '|' + length.toFixed(2) + '|' + scale.toFixed(2) + '|' + quality)
  const name = 'proxy-' + key + '.mp4'
  const dir = previewDir(config)
  const target = joinPath(dir, name)
  if (isFile(target)) {
    const stat = statOf(target)
    return Promise.resolve({ name: name, cached: true, start: start, seconds: length, bytes: stat ? stat.size : 0 })
  }
  return previewEnqueue(() => {
    if (isFile(target)) {
      const stat = statOf(target)
      return { name: name, cached: true, start: start, seconds: length, bytes: stat ? stat.size : 0 }
    }
    const started = Date.now()
    return runAsync(config, [
      '--project', projectFile, 'export', target,
      '--format', 'h264',
      '--start', String(start),
      '--end', String(start + length),
      '--scale', String(scale),
      '--quality', String(quality),
    ], 'proxy-' + key, 300000).then((result) => {
      if (!isFile(target)) {
        throw new Error('生成预览片段失败: ' + (tailText(result.text, 300) || ('退出码 ' + result.code)))
      }
      prunePreviews(dir)
      const stat = statOf(target)
      return {
        name: name, cached: false, start: start, seconds: length,
        bytes: stat ? stat.size : 0, ms: Date.now() - started,
      }
    })
  })
}

// Serves a cached file. The name is a basename by construction, but it is
// re-checked against the served directory: path traversal here would expose
// arbitrary files through the panel's HTTP surface.
function previewResolve(config, name) {
  const base = String(name || '')
  if (base === '' || base.indexOf('/') >= 0 || base.indexOf('\\') >= 0 || base.indexOf('..') >= 0) return null
  const dir = previewDir(config)
  const full = joinPath(dir, base)
  if (!isFile(full)) return null
  return full
}
