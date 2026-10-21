// ── engine ──────────────────────────────────────────────────────────────────
// The only place that talks to filmcraft-cli.
//
// Two things about this process boundary are load-bearing and were learned the
// hard way:
//
//   · spawnSync with piped stdio dies with EPERM inside the DSH host process.
//     Output therefore goes to a real file descriptor opened on a log file, and
//     is read back afterwards.
//   · every invocation is a *separate process*: nothing survives between calls
//     unless `--save` was passed. Anything that must persist has to be written
//     into the project file in the same invocation.

const ENGINE_TIMEOUT_MS = 120000
const ENGINE_TIMEOUT_LONG_MS = 600000

function logPathFor(config, label) {
  const paths = pathsOf(config.root)
  ensureDir(paths.logs)
  return joinPath(paths.logs, label + '.log')
}

// Runs the CLI and returns { ok, status, stdout, stderr }.
// stdout and stderr share one fd, so ordering between them is preserved the way
// a terminal would show it.
function spawnCapture(cliPath, args, log, timeoutMs) {
  let fd = -1
  try { fd = openSync(log, 'w') } catch (_) { fd = -1 }
  if (fd < 0) {
    const fallback = spawnSync(cliPath, args, { encoding: 'utf8', timeout: timeoutMs || ENGINE_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, windowsHide: true })
    return {
      ok: fallback.status === 0,
      status: fallback.status === null ? -1 : fallback.status,
      stdout: fallback.stdout || '',
      stderr: fallback.stderr || (fallback.error ? String(fallback.error.message) : ''),
      log: '',
    }
  }
  let result
  try {
    result = spawnSync(cliPath, args, { stdio: ['ignore', fd, fd], timeout: timeoutMs || ENGINE_TIMEOUT_MS, windowsHide: true })
  } finally {
    try { closeSync(fd) } catch (_) { }
  }
  let text = ''
  try { text = readFileSync(log, 'utf8') } catch (_) { }
  // The CLI writes warnings ("offline media", preset fallbacks) to stderr, and
  // both streams land in the same file, so the split is reconstructed rather
  // than trusted: treat the whole capture as stdout and keep it as the message.
  return {
    ok: result && result.status === 0,
    status: result && typeof result.status === 'number' ? result.status : -1,
    stdout: text,
    stderr: '',
    log,
    timedOut: !!(result && result.error && String(result.error.code) === 'ETIMEDOUT'),
  }
}

function parseJsonText(text) {
  const trimmed = String(text || '').trim()
  if (trimmed === '') return null
  try { return JSON.parse(trimmed) } catch (_) { }
  // The CLI occasionally prefixes a banner or a warning before the JSON body.
  const start = trimmed.search(/[[{]/)
  if (start < 0) return null
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
  if (end <= start) return null
  try { return JSON.parse(trimmed.slice(start, end + 1)) } catch (_) { }
  return null
}

function engineError(result, what) {
  const detail = String(result.stdout || '').trim()
  const timedOut = result.timedOut ? '（超时）' : ''
  return new Error(what + '失败' + timedOut + (detail === '' ? '' : ': ' + detail.split('\n').slice(-6).join(' ')))
}

// `filmcraft-cli [--project p] [--save] <args...>` — one shot, JSON out.
function engineJson(config, args, options) {
  const opts = options || {}
  const full = []
  if (opts.project) full.push('--project', opts.project)
  if (opts.empty) full.push('--empty')
  if (opts.save) full.push('--save')
  if (opts.saveAs) full.push('--save-as', opts.saveAs)
  for (const arg of args) full.push(arg)
  const log = logPathFor(config, 'cli-' + (opts.label || 'run'))
  const result = spawnCapture(config.cliPath, full, log, opts.timeoutMs || ENGINE_TIMEOUT_MS)
  if (opts.allowFailure !== true && !result.ok) throw engineError(result, opts.what || '命令')
  return { json: parseJsonText(result.stdout), text: result.stdout, ok: result.ok, status: result.status }
}

function engineExec(config, projectFile, commandId, params, options) {
  const opts = options || {}
  const args = ['exec', commandId]
  if (params && Object.keys(params).length > 0) args.push(JSON.stringify(params))
  return engineJson(config, args, {
    project: projectFile,
    save: opts.save !== false,
    label: 'exec-' + commandId.replace(/[^a-z0-9]+/gi, '-'),
    what: commandId,
    timeoutMs: opts.timeoutMs,
    allowFailure: opts.allowFailure,
  })
}

// A JSONL batch is one process and one undo step per command — the only way to
// do "import, then build a sequence, then grade it" without the project file
// being re-read between steps.
function engineRun(config, projectFile, steps, options) {
  const opts = options || {}
  if (!Array.isArray(steps) || steps.length === 0) return { results: [] }
  const paths = pathsOf(config.root)
  ensureDir(paths.work)
  const scriptFile = joinPath(paths.work, 'run-' + Date.now() + '-' + Math.floor(Math.random() * 1e4) + '.jsonl')
  const lines = steps.map((step) => JSON.stringify({ id: step.id, params: step.params || {} }))
  writeFileSync(scriptFile, lines.join('\n') + '\n', 'utf8')
  const args = ['run', scriptFile, '--save', '--compact']
  if (opts.keepGoing !== false) args.push('--keep-going')
  const result = engineJson(config, args, {
    project: projectFile,
    label: 'run-' + steps[0].id.replace(/[^a-z0-9]+/gi, '-'),
    what: '批处理',
    timeoutMs: opts.timeoutMs || ENGINE_TIMEOUT_LONG_MS,
    allowFailure: true,
  })
  try { unlinkSync(scriptFile) } catch (_) { }
  return { results: collectResults(result.json, result.text), raw: result.json, ok: result.ok, status: result.status }
}

// `run --compact` emits one JSON object per line; a single command emits one
// object. Both shapes are normalised to an array of { ok, result | error }.
function collectResults(json, text) {
  const out = []
  if (Array.isArray(json)) {
    for (const entry of json) out.push(entry)
    return out
  }
  if (json && typeof json === 'object') {
    if (Array.isArray(json.results)) return json.results
    out.push(json)
    return out
  }
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed[0] !== '{') continue
    const parsed = parseJsonText(trimmed)
    if (parsed) out.push(parsed)
  }
  return out
}

function inspectProject(config, projectFile) {
  const result = engineJson(config, ['inspect', 'project'], { project: projectFile, what: '读取工程' })
  return result.json || {}
}

function inspectSequence(config, projectFile) {
  const r = engineJson(config, ['inspect', 'sequence'], { project: projectFile, what: '读取序列', allowFailure: true })
  return r.json || null
}

function probeMedia(config, file) {
  const r = engineJson(config, ['probe', file], { what: '读取素材', allowFailure: true })
  const json = r.json
  if (!json || typeof json !== 'object') return null
  const video = json.video || null
  const frameRate = video && video.frame_rate ? video.frame_rate : null
  return {
    duration: ticksToSec(json.duration),
    width: video ? num(video.width, 0) : 0,
    height: video ? num(video.height, 0) : 0,
    fps: frameRate && num(frameRate.den, 0) > 0 ? num(frameRate.num, 0) / num(frameRate.den, 1) : 0,
    codec: video ? video.codec || '' : '',
    hasAudio: Array.isArray(json.audio_streams) && json.audio_streams.length > 0,
    bytes: num(json.file_size, 0),
  }
}

// ── snapshots ───────────────────────────────────────────────────────────────
// `filmcraft-cli` keeps no undo history across processes and `--save` writes the
// result, not the path to it. Every edit therefore copies the project aside
// first; undo restores the newest copy. 20 deep is enough for a hand-cut session
// and small because .fcproj holds references, not media.
const SNAPSHOT_KEEP = 20
function snapshotTake(config, projectFile) {
  const paths = pathsOf(config.root)
  const folder = joinPath(paths.snapshots, String(stemOf(projectFile)).replace(/[^A-Za-z0-9_.-]+/g, '_'))
  ensureDir(folder)
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.floor(Math.random() * 1000) + '.fcproj'
  const target = joinPath(folder, name)
  try { copyFileSync(projectFile, target) } catch (_) { return null }
  const files = listDir(folder).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  while (files.length > SNAPSHOT_KEEP) {
    const drop = files.shift()
    try { unlinkSync(joinPath(folder, drop)) } catch (_) { }
  }
  return target
}
function snapshotNewest(config, projectFile) {
  const paths = pathsOf(config.root)
  const folder = joinPath(paths.snapshots, String(stemOf(projectFile)).replace(/[^A-Za-z0-9_.-]+/g, '_'))
  const files = listDir(folder).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  if (files.length === 0) return null
  return joinPath(folder, files[files.length - 1])
}
function snapshotUndo(config, projectFile) {
  const newest = snapshotNewest(config, projectFile)
  if (!newest) return { ok: false, error: '没有可撤销的快照' }
  copyFileSync(newest, projectFile)
  try { unlinkSync(newest) } catch (_) { }
  const remaining = listDir(dirOf(newest)).filter((entry) => entry.isFile()).length
  return { ok: true, restored: baseOf(newest), remaining }
}

// ── command whitelist ───────────────────────────────────────────────────────
// The panel must not become a remote shell for 700 engine commands: these are
// the ones with a UI affordance, everything else stays agent-only.
// Every id here was checked against `filmcraft-cli commands --json` (700 commands
// in this build). The previous version shipped a whitelist written from memory
// and 14 of its 33 entries did not exist — `edit.extract`, `clip.toggleEnabled`,
// `marker.add` and friends all failed at runtime with "unknown command". Do not
// add an id to this table without checking it the same way.
const EDIT_COMMANDS = {
  'timeline.trim': true,
  'timeline.razor': true,
  'timeline.move': true,
  'timeline.slip': true,
  'timeline.slide': true,
  'timeline.roll': true,
  'timeline.place': true,
  'timeline.setTrack': true,
  'edit.rippleDelete': true,
  'edit.clear': true,
  'edit.cut': true,
  'edit.copy': true,
  'edit.paste': true,
  'edit.pasteInsert': true,
  'edit.pasteMedia': true,
  'clip.enable': true,
  'clip.rename': true,
  'clip.speedDuration': true,
  'clip.link': true,
  'effects.apply': true,
  'effects.remove': true,
  'effects.setParam': true,
  'effects.reset': true,
  'effects.resetParam': true,
  'effects.toggleEnabled': true,
  'file.import': true,
  'file.newSequence': true,
  'file.exportInterchange': true,
  'sequence.open': true,
  'sequence.settings': true,
  'markers.add': true,
  'markers.addRange': true,
  'markers.clearAll': true,
  'project.delete': true,
}
function guardCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('commands 不能为空')
  if (commands.length > 400) throw new Error('一次最多 400 条命令')
  return commands.map((command) => {
    const id = command && command.id
    if (typeof id !== 'string' || EDIT_COMMANDS[id] !== true) {
      throw new Error('不允许的命令: ' + String(id))
    }
    return { id: id, params: command.params || {} }
  })
}
