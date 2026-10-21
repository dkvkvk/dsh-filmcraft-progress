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
