import { readFileSync, statSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, copyFileSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { spawnSync, spawn } from 'node:child_process'

function defineTool(options) {
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(options.parameters)) {
    const { required: isRequired, ...schema } = value
    properties[key] = schema
    if (isRequired) required.push(key)
  }
  return {
    ...options,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  }
}

function createPlugin(harness) {
  // ── 00-context.js ────────────────────────────────────────────────────
  // ── context ─────────────────────────────────────────────────────────────────
  // Everything the plugin needs to know about *where things live*, resolved once.
  //
  // There are two layers on purpose:
  //
  //   config   (machine)  ~/.dsh/filmcraft-progress/config.json
  //            where the workspace is, which filmcraft-cli to run. Belongs to this
  //            machine, not to the work.
  //   workspace (data)    <root>/workspace.json, <root>/jobs/*.json
  //            projects, grade presets, job records. Belongs to the work and can be
  //            copied/backed up with it.
  //
  // Hard-coding a project path is what made the previous version single-purpose;
  // nothing below may name a directory, drive or project.

  const HOME = (typeof process !== 'undefined' && process.env
    && (process.env.USERPROFILE || process.env.HOME)) || '.'
  const CONFIG_DIR = joinPath(HOME, '.dsh', 'filmcraft-progress')
  const CONFIG_FILE = joinPath(CONFIG_DIR, 'config.json')

  const TICKS_PER_SECOND = 254016000000

  // ── path helpers ────────────────────────────────────────────────────────────
  // node:path is not injected into this module scope (see scripts/build-native.mjs),
  // so these are hand-rolled. They always speak forward slashes: Windows accepts
  // them everywhere (fs, spawn, and filmcraft-cli all do), and it stops the
  // mixed-separator bugs that a naive `a + '\\' + b` produces once a value came
  // back from the engine as "D:/x/y".
  function slash(p) { return String(p === undefined || p === null ? '' : p).replace(/\\/g, '/') }
  function uniqSlashes(p) { return slash(p).replace(/\/{2,}/g, '/') }
  function joinPath() {
    const parts = []
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i]
      if (value === undefined || value === null || value === '') continue
      const text = String(value)
      parts.push(i === 0 ? text.replace(/\/+$/, '') : text.replace(/^\/+/, '').replace(/\/+$/, ''))
    }
    return uniqSlashes(parts.join('/'))
  }
  function dirOf(p) {
    const s = uniqSlashes(p).replace(/\/+$/, '')
    const cut = s.lastIndexOf('/')
    if (cut < 0) return '.'
    if (cut === 2 && /^[A-Za-z]:/.test(s)) return s.slice(0, 3)
    return s.slice(0, cut)
  }
  function baseOf(p) {
    const s = uniqSlashes(p).replace(/\/+$/, '')
    const cut = s.lastIndexOf('/')
    return cut < 0 ? s : s.slice(cut + 1)
  }
  function extOf(p) {
    const name = baseOf(p)
    const dot = name.lastIndexOf('.')
    return dot <= 0 ? '' : name.slice(dot).toLowerCase()
  }
  function stemOf(p) {
    const name = baseOf(p)
    const dot = name.lastIndexOf('.')
    return dot <= 0 ? name : name.slice(0, dot)
  }
  // Windows spelling, for anything a human reads.
  function winPath(p) { return uniqSlashes(p).replace(/\//g, '\\') }

  // ── tiny fs layer ───────────────────────────────────────────────────────────
  function ensureDir(p) {
    if (existsSync(p)) return p
    ensureDir(dirOf(p))
    try { mkdirSync(p) } catch (error) { if (!existsSync(p)) throw error }
    return p
  }
  function readJson(p, fallback) {
    try {
      const text = readFileSync(p, 'utf8')
      if (text === '') return fallback
      return JSON.parse(text)
    } catch (_) { return fallback }
  }
  // Written to a sibling then renamed: a crash mid-write must never leave the
  // registry truncated, because that would lose the project list itself.
  function writeJsonAtomic(p, value) {
    ensureDir(dirOf(p))
    const temp = p + '.tmp-' + Date.now()
    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8')
    try { renameSync(temp, p) } catch (error) { writeFileSync(p, JSON.stringify(value, null, 2), 'utf8'); try { unlinkSync(temp) } catch (_) { } }
    return p
  }
  function statOf(p) {
    try { return statSync(p) } catch (_) { return null }
  }
  function isFile(p) { const s = statOf(p); return !!(s && s.isFile()) }
  function isDir(p) { const s = statOf(p); return !!(s && s.isDirectory()) }
  function listDir(p) {
    try { return readdirSync(p, { withFileTypes: true }) } catch (_) { return [] }
  }

  // ── numbers & time ──────────────────────────────────────────────────────────
  function num(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  function clamp(value, low, high) { return value < low ? low : (value > high ? high : value) }
  function pad2(n) { return String(n).padStart(2, '0') }
  function hhmmss(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--:--'
    const total = Math.round(sec)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    return (hours > 0 ? hours + ':' : '') + pad2(minutes) + ':' + pad2(seconds(total))
  }
  function seconds(total) { return total % 60 }
  function mb(bytes) { return bytes / 1048576 }
  function ticksToSec(ticks) { return num(ticks, 0) / TICKS_PER_SECOND }
  function nowIso() { return new Date().toISOString() }
  let idCounter = 0
  function uid(prefix) {
    idCounter += 1
    return prefix + '_' + Date.now().toString(36) + idCounter.toString(36).padStart(2, '0')
  }

  // ── config ──────────────────────────────────────────────────────────────────
  const DEFAULT_CLI = 'C:\\Program Files\\FilmCraft\\filmcraft-cli.exe'
  // The workspace default is deliberately *not* a project: it is a parent folder
  // that projects are registered under. D: is this machine's data disk; the
  // USERPROFILE fallback keeps the plugin usable on any other machine.
  const DEFAULT_ROOT = isDir('D:/Myfiles') ? 'D:/Myfiles/FilmCraft' : joinPath(HOME, 'FilmCraft')
  // Where the version that hard-coded one project looked for projects. Read once,
  // only to seed a fresh registry, never written to.
  const LEGACY_ROOT = 'D:/Myfiles/临时'

  const DEFAULT_PRESETS = [
    {
      id: 'neutral', name: '中性', color: '#8b949e', builtin: true,
      params: { sharpen: 14, contrast: 20, highlights: -34, whites: 0, shadows: 18, blacks: -10, tint: 0, temperature: -2, saturation: 108, vibrance: 26 },
      hsl: { on: false },
    },
    {
      id: 'sea', name: '海景', color: '#2f81f7', builtin: true,
      params: { sharpen: 18, contrast: 26, highlights: -85, whites: -10, shadows: 22, blacks: -16, tint: -4, temperature: -32, saturation: 110, vibrance: 38 },
      hsl: { on: true, hue: 205, hueRange: 70, sat: 160, hueShift: 20, temp: -35, tint: -5 },
    },
    {
      id: 'trail', name: '山路', color: '#3fb950', builtin: true,
      params: { sharpen: 20, contrast: 27, highlights: -58, whites: -6, shadows: 24, blacks: -14, tint: -4, temperature: -14, saturation: 115, vibrance: 42 },
      hsl: { on: true, hue: 112, hueRange: 80, sat: 110, hueShift: 12, temp: -8, tint: -10 },
    },
    {
      id: 'warm', name: '暖调', color: '#d29922', builtin: true,
      params: { sharpen: 16, contrast: 24, highlights: -40, whites: 0, shadows: 22, blacks: -12, tint: 6, temperature: 14, saturation: 112, vibrance: 32 },
      hsl: { on: false },
    },
  ]

  function loadConfig() {
    const stored = readJson(CONFIG_FILE, null) || {}
    const config = {
      root: typeof stored.root === 'string' && stored.root !== '' ? uniqSlashes(stored.root) : DEFAULT_ROOT,
      cliPath: typeof stored.cliPath === 'string' && stored.cliPath !== '' ? uniqSlashes(stored.cliPath) : DEFAULT_CLI,
      scanDepth: num(stored.scanDepth, 4),
    }
    if (!isDir(config.cliPath)) {
      // A moved install should degrade to "some other copy of the CLI", not to
      // "every action fails with ENOENT".
      for (const candidate of [DEFAULT_CLI, 'C:/Program Files/FilmCraft/filmcraft-cli.exe']) {
        if (isFile(candidate)) { config.cliPath = candidate; break }
      }
    }
    return config
  }
  function saveConfig(config) {
    writeJsonAtomic(CONFIG_FILE, { root: config.root, cliPath: config.cliPath, scanDepth: config.scanDepth })
    return config
  }

  // ── workspace ───────────────────────────────────────────────────────────────
  // paths() is derived, never stored: moving the root moves everything with it.
  function pathsOf(root) {
    const base = uniqSlashes(root)
    return {
      root: base,
      registry: joinPath(base, 'workspace.json'),
      jobs: joinPath(base, 'jobs'),
      projects: joinPath(base, 'projects'),
      exports: joinPath(base, 'exports'),
      work: joinPath(base, 'work'),
      snapshots: joinPath(base, 'work', 'snapshots'),
      previews: joinPath(base, 'work', 'previews'),
      logs: joinPath(base, 'work', 'logs'),
    }
  }

  function emptyRegistry(config) {
    return {
      version: 3,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      settings: {
        exportPreset: 'Match Source – Adaptive High Bitrate',
        defaultTrack: 'V1',
        migrateLegacyStatus: true,
        statusFile: '',
      },
      presets: DEFAULT_PRESETS.map((preset) => ({ ...preset })),
      projects: [],
    }
  }

  function loadRegistry(config) {
    const registry = readJson(pathsOf(config.root).registry, null)
    if (registry && registry.version >= 3 && Array.isArray(registry.projects)) return registry
    // Either first run, or a registry from an older layout.
    const fresh = emptyRegistry(config)
    if (registry && Array.isArray(registry.projects)) {
      fresh.projects = registry.projects.map((project) => ({
        id: project.id || uid('p'),
        name: project.name || stemOf(project.file || 'project'),
        file: uniqSlashes(project.file || ''),
        tags: Array.isArray(project.tags) ? project.tags : [],
        note: typeof project.note === 'string' ? project.note : '',
        createdAt: project.createdAt || nowIso(),
        updatedAt: project.updatedAt || nowIso(),
      })).filter((project) => project.file !== '')
      if (registry.presets && Array.isArray(registry.presets)) fresh.presets = registry.presets
    }
    return fresh
  }

  function saveRegistry(config, registry) {
    registry.updatedAt = nowIso()
    writeJsonAtomic(pathsOf(config.root).registry, registry)
    return registry
  }

  // ── 10-engine.js ─────────────────────────────────────────────────────
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

  // ── 20-project.js ────────────────────────────────────────────────────
  // ── project ─────────────────────────────────────────────────────────────────
  // Normalises what the engine reports into the shape the panel and the tools both
  // consume. Three CLI calls per read (`inspect project`, `project.items`,
  // `media.status`), each returning raw engine JSON with its own vocabulary — all
  // translation happens here so nothing upstream has to know about `item` vs `clip`
  // vs `sequence`, or that frame rate is `settings.frame_rate` and not `settings.fps`.
  //
  // Reads are cached by the project file's mtime: every edit rewrites the file, so
  // the mtime is a correct and cheap invalidation key.

  const PROJECT_CACHE = new Map()
  const PROJECT_CACHE_LIMIT = 12

  function sequenceFps(settings) {
    if (!settings) return 0
    const rate = settings.frame_rate
    if (rate && typeof rate === 'object') {
      const den = num(rate.den, 0)
      const n = num(rate.num, 0)
      if (den > 0 && n > 0) return n / den
    }
    // Older projects stored a bare fps; accept it rather than show nothing.
    return num(settings.fps, 0)
  }

  function flattenTree(node, out) {
    const list = out || []
    if (!node || typeof node !== 'object') return list
    if (typeof node.item === 'number') list.push(node)
    for (const child of node.children || []) flattenTree(child, list)
    return list
  }

  function trackLabel(kind, index) { return (kind === 'video' ? 'V' : 'A') + String(index + 1) }

  function normalizeEffects(effects) {
    if (!Array.isArray(effects)) return []
    return effects.map((effect) => {
      const params = effect && effect.params ? effect.params : {}
      const flat = {}
      for (const key of Object.keys(params)) {
        const value = params[key]
        // Engine params arrive as { value: 'Float(-85.0)', keyframes: 0 }.
        if (value && typeof value === 'object' && typeof value.value === 'string') {
          const match = /^(Float|Int|Bool|String|Vec2|Color)\((.*)\)$/.exec(value.value)
          flat[key] = match ? (match[1] === 'Bool' ? match[2] === 'true' : (match[2] === '' ? 0 : Number(match[2]))) : value.value
        } else flat[key] = value
      }
      return {
        effect: (effect && effect.effect) || '',
        enabled: !(effect && effect.enabled === false),
        params: flat,
      }
    })
  }

  function normalizeSequence(sequence) {
    if (!sequence) return null
    const settings = sequence.settings || {}
    const tracks = { video: [], audio: [] }
    const clips = []
    for (const kind of ['video', 'audio']) {
      const list = Array.isArray(sequence[kind]) ? sequence[kind] : []
      for (let index = 0; index < list.length; index += 1) {
        const track = list[index] || {}
        const items = []
        for (const raw of track.items || []) {
          const start = ticksToSec(raw.start)
          const duration = ticksToSec(raw.duration)
          const clip = {
            clip: raw.clip,
            item: raw.item,
            name: raw.name || '',
            track: track.id,
            trackLabel: trackLabel(kind, index),
            kind: kind,
            start: start,
            dur: duration,
            end: start + duration,
            sourceIn: ticksToSec(raw.sourceIn),
            sourceOut: ticksToSec(raw.sourceOut),
            speed: num(raw.speed, 1),
            enabled: raw.enabled !== false,
            gainDb: num(raw.gainDb, 0),
            link: raw.link === undefined ? null : raw.link,
            effects: normalizeEffects(raw.effects),
          }
          items.push(clip)
          clips.push(clip)
        }
        tracks[kind].push({
          id: track.id,
          label: trackLabel(kind, index),
          kind: kind,
          enabled: track.enabled !== false,
          muted: track.muted === true,
          locked: track.locked === true,
          clipCount: items.length,
          items: items,
        })
      }
    }
    clips.sort((a, b) => (a.kind === b.kind ? a.start - b.start : (a.kind === 'video' ? -1 : 1)))
    return {
      id: sequence.id,
      name: sequence.name || '',
      duration: ticksToSec(sequence.duration),
      frames: num(sequence.durationFrames, 0),
      width: num(settings.width, 0),
      height: num(settings.height, 0),
      fps: sequenceFps(settings),
      preset: settings.preset || '',
      sampleRate: num(settings.sample_rate, 48000),
      playhead: ticksToSec(sequence.playhead),
      inPoint: ticksToSec(sequence.in),
      outPoint: ticksToSec(sequence.out),
      markers: Array.isArray(sequence.markers) ? sequence.markers.length : 0,
      tracks: tracks,
      clips: clips,
    }
  }

  function readAssets(config, projectFile) {
    // Status carries the on-disk path and online/offline, which the project tree
    // does not expose at all.
    const statusResult = engineJson(config, ['exec', 'media.status', '{}'], { project: projectFile, what: '读取素材状态', allowFailure: true })
    const statuses = Array.isArray(statusResult.json) ? statusResult.json : []
    const statusByItem = new Map()
    for (const entry of statuses) if (entry && typeof entry.item === 'number') statusByItem.set(entry.item, entry)

    // `project.items` is the Project panel's own row model: it already resolves
    // frame rate and frame dimensions into display strings.
    const rowsResult = engineJson(config, ['exec', 'project.items', '{"recursive":true}'], { project: projectFile, what: '读取素材列表', allowFailure: true })
    const rows = rowsResult.json && Array.isArray(rowsResult.json.rows) ? rowsResult.json.rows : []
    const assets = []
    for (const row of rows) {
      if (!row || typeof row.item !== 'number') continue
      const cells = row.cells || {}
      const status = statusByItem.get(row.item) || null
      const fpsMatch = /([\d.]+)\s*fps/i.exec(String(cells['Frame Rate'] || ''))
      const sizeMatch = /(\d+)\s*x\s*(\d+)/i.exec(String(cells['Video Info'] || ''))
      assets.push({
        item: row.item,
        name: row.name || (status ? status.name : '') || '',
        kind: row.label === 'Sequence' ? 'sequence' : 'media',
        path: status ? uniqSlashes(status.path || '') : '',
        online: status ? status.status === 'online' : true,
        proxy: status && status.proxy ? uniqSlashes(status.proxy) : '',
        bytes: status && status.identity ? num(status.identity.size, 0) : 0,
        // The engine's own content fingerprint. Two items with the same value are
        // the same bytes, which is what makes "did this clip really change?" and
        // "is this file already in the project?" answerable without hashing.
        fingerprint: status && status.identity ? String(status.identity.fingerprint || '') : '',
        fps: fpsMatch ? Number(fpsMatch[1]) : 0,
        width: sizeMatch ? Number(sizeMatch[1]) : 0,
        height: sizeMatch ? Number(sizeMatch[2]) : 0,
        durationText: cells['Media Duration'] || '',
        videoInfo: cells['Video Info'] || '',
        audioInfo: cells['Audio Info'] || '',
      })
    }
    return assets
  }

  function projectDetail(config, projectFile, options) {
    const opts = options || {}
    const file = uniqSlashes(projectFile)
    if (!isFile(file)) throw new Error('工程文件不存在: ' + winPath(file))
    const stat = statOf(file)
    const stamp = stat ? stat.mtimeMs : 0
    const cached = PROJECT_CACHE.get(file)
    // `force` exists because a sequence switch changes the *active* sequence
    // without touching the project bytes.
    if (!opts.force && cached && cached.stamp === stamp) return cached.detail

    const tree = inspectProject(config, file)
    const nodes = flattenTree(tree.root)
    const sequences = nodes
      .filter((node) => node.type === 'Sequence')
      .map((node) => ({
        id: node.item,
        name: node.name || '',
        duration: ticksToSec(node.duration),
        active: tree.activeSequence === node.item,
      }))
    const assets = opts.withAssets === false ? [] : readAssets(config, file)

    let sequence = null
    // `inspect sequence` only ever reports the *active* one; the others are listed
    // from the tree and read on demand after `sequence.open`.
    const active = tree.activeSequence
    if (typeof active === 'number') {
      for (const entry of sequences) if (entry.id === active) entry.active = true
      sequence = normalizeSequence(inspectSequence(config, file))
    }

    const detail = {
      path: file,
      name: tree.name || stemOf(file),
      revision: num(tree.revision, 0),
      savedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
      activeSequence: typeof active === 'number' ? active : null,
      sequences: sequences.map((entry) => {
        const summary = { id: entry.id, name: entry.name, duration: entry.duration, active: entry.active, clipCount: null, fps: 0 }
        if (sequence && sequence.id === entry.id) {
          summary.clipCount = sequence.tracks.video.reduce((total, track) => total + track.items.length, 0)
          summary.fps = sequence.fps
          summary.width = sequence.width
          summary.height = sequence.height
          summary.frames = sequence.frames
        }
        return summary
      }),
      assets: assets,
      sequence: sequence,
    }

    PROJECT_CACHE.set(file, { stamp: stamp, detail: detail })
    while (PROJECT_CACHE.size > PROJECT_CACHE_LIMIT) {
      const oldest = PROJECT_CACHE.keys().next()
      if (oldest.done) break
      PROJECT_CACHE.delete(oldest.value)
    }
    return detail
  }

  function projectInvalidate(file) { PROJECT_CACHE.delete(uniqSlashes(file)) }

  // Activates a sequence and persists it. `--save` matters: the active sequence is
  // project state, and every later call is a fresh process that would otherwise
  // open whichever sequence was active last time.
  function projectActivateSequence(config, projectFile, sequenceId) {
    engineExec(config, projectFile, 'sequence.open', { item: sequenceId }, { save: true })
    projectInvalidate(projectFile)
    return projectDetail(config, projectFile, { force: true })
  }

  // Scan for projects under a root, skipping folders that only ever hold tooling.
  // `snapshots` and `_backup*` matter: the previous version of this very plugin
  // saved its undo history as `<name>.fcproj.<epoch>.fcproj` inside the project's
  // own tree, so a naive scan adopts dozens of snapshot copies as real projects —
  // which is exactly what happened on the first run here.
  const SCAN_SKIP = new Set(['node_modules', '.git', 'System Volume Information', '$RECYCLE.BIN', 'work', 'exports', 'jobs', 'snapshots'])
  const SNAPSHOT_FILE = /\.fcproj\.\d+\.fcproj$/i
  function scanProjects(root, depth, out, level) {
    const list = out || []
    const maxDepth = typeof depth === 'number' ? depth : 4
    const here = typeof level === 'number' ? level : 0
    if (here > maxDepth) return list
    for (const entry of listDir(root)) {
      const full = joinPath(root, entry.name)
      if (entry.isDirectory()) {
        if (SCAN_SKIP.has(entry.name) || entry.name.startsWith('.') || entry.name.startsWith('_backup')) continue
        scanProjects(full, maxDepth, list, here + 1)
      } else if (entry.isFile() && /\.fcproj$/i.test(entry.name)) {
        if (SNAPSHOT_FILE.test(entry.name)) continue
        const stat = statOf(full)
        list.push({
          file: uniqSlashes(full),
          name: stemOf(entry.name),
          bytes: stat ? stat.size : 0,
          savedAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
        })
      }
    }
    return list
  }

  // ── 30-registry.js ───────────────────────────────────────────────────
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

  // ── 40-edit.js ───────────────────────────────────────────────────────
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

  // ── 50-jobs.js ───────────────────────────────────────────────────────
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

  // ── 60-preview.js ────────────────────────────────────────────────────
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

  // ── 90-state.js ──────────────────────────────────────────────────────
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
        schema: { type: 'object', additionalProperties: true },
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
        schema: { type: 'object', additionalProperties: true },
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

  // ── 99-plugin.js ─────────────────────────────────────────────────────
  // ── plugin ──────────────────────────────────────────────────────────────────
  // The last module in the host half: it returns the object the loader wants.
  //
  // `apply` is where registration happens. Doing it at module top-level instead
  // would run during the loader's probe pass (`createPlugin({})`, used only to read
  // `name`) with no ctx at all.

  function apply(ctx) {
    buildHandlers(harness)
    registerTools(harness, ctx)
  }

  return {
    name: 'filmcraft-progress',
    // 'tools' 必须声明：读 ctx.tools 时 Cordis 校验 inject，缺了会抛
    // "cannot get property \"tools\" without inject"，整个条目挂载失败
    // （已注册的路由和工具一起被回收，症状是全部 404）。
    inject: ['tools'],
    apply: apply,
  }
}

const plugin = createPlugin({})
export const name = plugin.name
export const inject = [...new Set([...plugin.inject, 'webServer'])]

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 4e6) { reject(new Error('request body too large')); req.destroy() }
    })
    req.on('end', () => {
      if (!raw) return resolve(null)
      try { resolve(JSON.parse(raw)) } catch (_) { reject(new Error('invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

// 宿主 webserver 按 path 建表，同路径注册第二条会抛 duplicate exact route。
// 所以一个 path 只注册一次，读/写两条处理函数在里面按 req.method 分流。
function registerRoute(ctx, slot) {
  const variants = slot.variants
  return ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: slot.path,
    async handler(req, res) {
      const send = (code, value) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(value))
      }
      const hit = variants.find((v) => v.method === req.method)
      if (hit === undefined) return send(405, { error: 'method not allowed' })
      if (hit.kind === 'raw') {
        try { return await hit.handler(req, res) } catch (error) {
          try { send(500, { error: error instanceof Error ? error.message : String(error) }) } catch (_) { }
          return
        }
      }
      try {
        const body = req.method === 'POST' ? await readBody(req) : null
        const query = new URLSearchParams((req.url || '').split('?')[1] || '')
        const merged = Object.assign({}, body || {})
        for (const [k, v] of query.entries()) if (merged[k] === undefined) merged[k] = v
        send(200, await hit.handler(merged))
      } catch (error) {
        send(500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-filmcraft-progress: ' + slot.path)
}

export function apply(ctx) {
  const routes = {
      'state.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/state', kind: 'json' },
      'workspace.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/workspace', kind: 'json' },
      'workspace.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/workspace', kind: 'json' },
      'projects.list': { method: 'GET', path: '/dsh-filmcraft-progress/api/projects', kind: 'json' },
      'projects.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/projects', kind: 'json' },
      'project.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/project', kind: 'json' },
      'project.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/project', kind: 'json' },
      'assets.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/assets', kind: 'json' },
      'browse.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/browse', kind: 'json' },
      'presets.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/presets', kind: 'json' },
      'import.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/import', kind: 'json' },
      'sequence.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/sequence', kind: 'json' },
      'merge.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/merge', kind: 'json' },
      'edit.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/edit', kind: 'json' },
      'grade.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/grade', kind: 'json' },
      'undo.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/undo', kind: 'json' },
      'export.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/export', kind: 'json' },
      'jobs.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/jobs', kind: 'json' },
      'jobs.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/jobs', kind: 'json' },
      'frame.read': { method: 'POST', path: '/dsh-filmcraft-progress/api/frame', kind: 'json' },
      'proxy.write': { method: 'POST', path: '/dsh-filmcraft-progress/api/proxy', kind: 'json' },
      'media.read': { method: 'GET', path: '/dsh-filmcraft-progress/api/media', kind: 'raw' },
    }
  const pending = new Map()
  const harness = {
    defineTool,
    apiBase: '/dsh-filmcraft-progress/api',
    registerTool(_context, tool) {
      return ctx.effect(() => ctx.tools.register(tool), 'dsh-filmcraft-progress: tool ' + tool.name)
    },
    handle(key, handler) {
      const route = routes[key]
      if (route === undefined) throw new Error('unsupported handler: ' + key)
      // 收集到 path 槽位里，等 createPlugin 跑完再一次性注册。
      let slot = pending.get(route.path)
      if (slot === undefined) {
        slot = { path: route.path, kind: route.kind, variants: [] }
        pending.set(route.path, slot)
      }
      slot.variants.push({ method: route.method, kind: route.kind, handler })
    },
  }
  const result = createPlugin(harness).apply(ctx)
  for (const slot of pending.values()) registerRoute(ctx, slot)
  return result
}
