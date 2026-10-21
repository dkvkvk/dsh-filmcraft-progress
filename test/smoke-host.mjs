// End-to-end check of the built host half, through its real HTTP surface.
//
// The routes are registered with fixed paths, so this drives them the way the
// panel does — a fake req/res pair per call — instead of reaching into internals
// that only exist inside the bundle.
//
//   node test/smoke-host.mjs            # read-only: workspace, projects, project
//   node test/smoke-host.mjs --write    # also merge + export + frame (slow)
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'

const BASE = '/dsh-filmcraft-progress/api'
const routes = new Map()
const tools = new Map()

const ctx = {
  effect(fn) { return fn() },
  webServer: {
    register(route) { routes.set(route.method + ' ' + route.path, route); return () => { } },
  },
  tools: {
    register(tool) { tools.set(tool.name, tool); return tool },
  },
}

const plugin = await import('../dist/native/index.js')
plugin.apply(ctx)
console.log('plugin:', plugin.name, '| inject:', plugin.inject.join(','))
console.log('routes:', routes.size, '| tools:', [...tools.keys()].join(','))

function fakeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = {}
  setTimeout(() => {
    if (body !== undefined) req.emit('data', JSON.stringify(body))
    req.emit('end')
  }, 0)
  return req
}
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '', finished: false,
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}) },
    end(chunk) {
      if (chunk) this.body += Buffer.isBuffer(chunk) ? chunk.toString('binary') : String(chunk)
      this.finished = true
    },
  }
}

// Handler key -> route path. Kept explicit rather than derived from the key,
// because the key is a name (workspace.read) and the path is a URL (/workspace).
const PATHS = {
  'state.read': '/state',
  'workspace.read': '/workspace', 'workspace.write': '/workspace',
  'projects.list': '/projects', 'projects.write': '/projects',
  'project.read': '/project', 'project.write': '/project',
  'assets.read': '/assets',
  'browse.read': '/browse',
  'presets.write': '/presets',
  'import.write': '/import',
  'sequence.write': '/sequence',
  'merge.write': '/merge',
  'edit.write': '/edit',
  'grade.write': '/grade',
  'undo.write': '/undo',
  'export.write': '/export',
  'jobs.read': '/jobs', 'jobs.write': '/jobs',
  'frame.read': '/frame',
  'proxy.write': '/proxy',
  'media.read': '/media',
}

async function call(key, body) {
  const path = BASE + (PATHS[key] || (() => { throw new Error('unmapped key ' + key) })())
  // Read vs write is not guessable from the key: `frame.read` carries a request
  // body and is a POST, `media.read` streams bytes and is a GET. Spell it out.
  const resolved = /^(state|workspace|projects|project|assets|browse|jobs)\.(read|list)$/.test(key) || key === 'media.read' ? 'GET' : 'POST'
  const route = routes.get(resolved + ' ' + path)
  if (!route) throw new Error('no route for ' + key + ' (' + resolved + ' ' + path + ')')
  const url = resolved === 'GET' && body ? path + '?' + new URLSearchParams(body).toString() : path
  const res = fakeRes()
  await route.handler(fakeReq(resolved, url, resolved === 'POST' ? body || {} : undefined), res)
  let json = null
  try { json = JSON.parse(res.body) } catch (_) { }
  if (res.statusCode !== 200) throw new Error(key + ' -> HTTP ' + res.statusCode + ': ' + (json && json.error ? json.error : res.body.slice(0, 200)))
  return json
}

function show(title, value, limit) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1)
  console.log('\n=== ' + title + ' ===')
  console.log(text.length > (limit || 1200) ? text.slice(0, limit || 1200) + '\n…' : text)
}

const write = process.argv.includes('--write')

// ── 1. workspace + registry ────────────────────────────────────────────────
const ws = await call('workspace.read')
show('workspace.read', {
  version: ws.version, root: ws.rootDisplay, cli: ws.cli,
  counts: ws.counts, presets: (ws.presets || []).map((p) => p.id + ':' + p.name),
  seeded: ws.seeded ? ws.seeded.added : null,
})

const projects = await call('projects.list')
show('projects.list', { count: (projects.projects || []).length, sample: (projects.projects || []).slice(0, 6).map((p) => ({ name: p.name, exists: p.exists, file: p.file })) })

// ── 2. read a real project ─────────────────────────────────────────────────
const SOURCE = 'D:/Myfiles/临时/tianwentai'
const TARGET = 'D:/tmp/fc-test/proj.fcproj'
const project = await call('project.read', { project: TARGET })
show('project.read', {
  name: project.name, path: project.path, revision: project.revision,
  activeSequence: project.activeSequence,
  sequences: project.sequences,
  assets: (project.assets || []).map((a) => ({ item: a.item, name: a.name, fps: a.fps, w: a.width, h: a.height, online: a.online, fp: a.fingerprint, file: a.path.split('/').pop() })),
  sequence: project.sequence ? {
    name: project.sequence.name, fps: project.sequence.fps, size: project.sequence.width + 'x' + project.sequence.height,
    duration: project.sequence.duration,
    tracks: { video: project.sequence.tracks.video.map((t) => t.label + ':' + t.clipCount), audio: project.sequence.tracks.audio.map((t) => t.label + ':' + t.clipCount) },
    clips: project.sequence.clips.filter((c) => c.kind === 'video').map((c) => ({ clip: c.clip, name: c.name.slice(-8), start: Math.round(c.start * 100) / 100, dur: Math.round(c.dur * 100) / 100, effects: c.effects.length })),
  } : null,
})

// ── 3. browser + presets ───────────────────────────────────────────────────
const browse = await call('browse.read', { path: SOURCE })
show('browse.read', { path: browse.path, dirs: browse.dirs.length, files: browse.files.length, first: browse.files.slice(0, 3).map((f) => f.name) })

if (!write) {
  console.log('\n(read-only run; pass --write for merge/export)')
  process.exit(0)
}

// ── 4. merge: three files into a brand-new project + sequence ──────────────
const files = browse.files.slice(0, 3).map((f) => f.path)
const merged = await call('merge.write', {
  create: { name: 'smoke-merge', overwrite: true },
  name: '合并测试',
  sources: files.map((file) => ({ file })),
})
show('merge.write', {
  project: merged.project, sequence: merged.sequence, itemIds: merged.itemIds,
  settings: merged.settings, compat: merged.compat,
  placed: merged.placed,
  clips: merged.detail.sequence.clips.filter((c) => c.kind === 'video').map((c) => ({ item: c.item, start: Math.round(c.start * 100) / 100, dur: Math.round(c.dur * 100) / 100 })),
})

// ── 5. grade every clip in the new sequence ────────────────────────────────
const clipIds = merged.detail.sequence.clips.filter((c) => c.kind === 'video').map((c) => c.clip)
const graded = await call('grade.write', { project: merged.project.file, clips: clipIds, preset: 'sea' })
show('grade.write', {
  applied: graded.applied, preset: graded.preset, commands: graded.commands, failed: graded.failed,
  effectsNow: graded.detail.sequence.clips.filter((c) => c.kind === 'video').map((c) => c.effects.map((e) => e.effect)),
})

// ── 6. export as a job, then watch it ──────────────────────────────────────
const job = await call('export.write', {
  project: merged.project.file,
  // A few seconds is enough to prove the job lifecycle; the full-length render
  // is the user's call, not the test's.
  start: 0,
  end: 3,
  scale: 0.25,
  quality: 60,
  noAudio: true,
})
show('export.write', job.job ? { id: job.job.id, state: job.job.state, out: job.job.display, expected: job.job.expected } : job)

let last = null
for (let i = 0; i < 90; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const jobs = await call('jobs.read')
  const current = (jobs.jobs || []).filter((entry) => entry.id === job.job.id)[0]
  if (current) {
    last = current
    const p = current.progress || {}
    process.stdout.write('\r  [' + current.state + '] ' + Math.round((p.ratio || 0) * 100) + '%  bytes=' + (p.bytes || 0) + '  eta=' + (p.etaMs === null || p.etaMs === undefined ? '?' : Math.round(p.etaMs / 1000) + 's') + '   ')
    if (current.state !== 'running') break
  }
}
console.log('')
show('jobs.read (final)', last ? { state: last.state, result: last.result, error: last.error, progress: last.progress } : null)

// ── 7. preview frame ───────────────────────────────────────────────────────
const frame = await call('frame.read', { project: merged.project.file, seconds: 1, scale: 0.25 })
show('frame.read', frame)
if (frame && frame.name) {
  const media = fakeRes()
  await routes.get('GET ' + BASE + '/media').handler(fakeReq('GET', BASE + '/media?name=' + encodeURIComponent(frame.name)), media)
  console.log('  media:', media.statusCode, media.headers['content-type'], media.body.length, 'bytes')
}

// ── 8. undo ────────────────────────────────────────────────────────────────
const undone = await call('undo.write', { project: merged.project.file })
show('undo.write', { restored: undone.restored, remaining: undone.remaining, effects: undone.detail.sequence.clips.filter((c) => c.kind === 'video').map((c) => c.effects.length) })
