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
