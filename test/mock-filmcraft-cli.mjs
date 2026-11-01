#!/usr/bin/env node
// A stand-in for filmcraft-cli, for CI and for machines without FilmCraft.
// It implements only the commands and parameter shapes this plugin sends, with
// simple, deterministic semantics. Passing tests against it prove the plumbing
// (MCP protocol, ticks, locking, snapshots, rollback, jobs), NOT the real
// engine's behaviour — run test/smoke-host.mjs against a real install for that.
//
// Mock media files are JSON: {"duration": seconds, "width", "height", "fps", "audio": true}
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'

const TPS = 254016000000
const argv = process.argv.slice(2)
let project = null, save = false, saveAs = null, empty = false
const rest = []
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a === '--project') project = argv[++i]
  else if (a === '--save') save = true
  else if (a === '--save-as') saveAs = argv[++i]
  else if (a === '--empty') empty = true
  else rest.push(a)
}
const out = (v) => process.stdout.write(JSON.stringify(v) + '\n')
const fail = (msg) => { out({ error: msg }); process.exit(1) }
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }

let P = empty ? { name: 'untitled', revision: 0, activeSequence: null, nextId: 1, items: [] } : null
if (!P && project) { try { P = JSON.parse(readFileSync(project, 'utf8')) } catch (e) { if (!['probe', 'commands'].includes(rest[0])) fail('cannot open project: ' + project) } }
const persist = () => {
  P.revision += 1
  if (saveAs) { P.name = saveAs.replace(/^.*[\\/]/, '').replace(/\.fcproj$/, ''); writeFileSync(saveAs, JSON.stringify(P)) }
  else if (save && project) writeFileSync(project, JSON.stringify(P))
}
const media = (path) => { const m = JSON.parse(readFileSync(path, 'utf8')); return Object.assign({ duration: 5, width: 1920, height: 1080, fps: 25, audio: true }, m) }
const item = (id) => P.items.find((x) => x.item === id)
const seq = () => { const s = item(P.activeSequence); if (!s) throw new Error('no active sequence'); return s }
const allClips = (s) => [...s.video, ...s.audio].flatMap((t) => t.items.map((c) => ({ c, t })))
const find = (s, id) => { const hit = allClips(s).find((x) => x.c.clip === id); if (!hit) throw new Error('unknown clip ' + id); return hit }
const partners = (s, clip) => clip.link == null ? [] : allClips(s).filter((x) => x.c.link === clip.link && x.c !== clip)
const shiftAfter = (track, time, delta, skip) => { for (const c of track.items) if (c !== skip && c.start >= time) c.start += delta }
const seqDuration = (s) => Math.max(0, ...allClips(s).map((x) => x.c.start + x.c.duration))

const COMMANDS = {
  'media.status': () => P.items.filter((x) => x.type === 'Media').map((x) => ({ item: x.item, name: x.name, path: x.path, status: existsSync(x.path) ? 'online' : 'offline', identity: { size: x.size, fingerprint: 'fp' + x.item } })),
  'project.items': () => ({ rows: P.items.map((x) => ({ item: x.item, name: x.name, label: x.type === 'Sequence' ? 'Sequence' : 'Clip', cells: x.type === 'Media' ? { 'Frame Rate': x.fps + ' fps', 'Video Info': x.width + ' x ' + x.height, 'Media Duration': x.duration + 's', 'Audio Info': x.audio ? 'Stereo' : '' } : {} })) }),
  'file.import': (p) => {
    const items = []
    for (const path of p.paths) { const m = media(path); const id = P.nextId++; P.items.push({ item: id, type: 'Media', name: path.replace(/^.*[\\/]/, ''), path, size: statSync(path).size, ...m }); items.push(id) }
    return { items, errors: [] }
  },
  'file.newSequence': (p) => {
    const id = P.nextId++
    const tracks = (n, k) => Array.from({ length: n }, (_, i) => ({ id: k + (i + 1) + '_' + id, items: [] }))
    P.items.push({ item: id, type: 'Sequence', name: p.name, settings: { width: p.width, height: p.height, fps: p.fps }, video: tracks(p.video || 3, 'v'), audio: tracks(p.audio || 3, 'a'), clipSeq: 1 })
    P.activeSequence = id
    return { sequence: id }
  },
  'sequence.open': (p) => { if (!item(p.item)) throw new Error('unknown sequence'); P.activeSequence = p.item; return {} },
  'sequence.settings': (p) => { const s = seq(); if (p.name) s.name = p.name; for (const k of ['width', 'height', 'fps']) if (p[k]) s.settings[k] = p[k]; return {} },
  'project.delete': (p) => { P.items = P.items.filter((x) => !p.items.includes(x.item)); if (p.items.includes(P.activeSequence)) P.activeSequence = (P.items.find((x) => x.type === 'Sequence') || {}).item ?? null; return {} },
  'timeline.place': (p) => {
    const s = seq()
    const v = s.video.find((t) => t.id.startsWith(p.track.toLowerCase())) || s.video[0]
    const a = s.audio.find((t) => t.id.startsWith((p.audioTrack || 'A1').toLowerCase())) || s.audio[0]
    let time = p.time || 0
    for (const id of p.items) {
      const m = item(id); const dur = Math.round(m.duration * TPS)
      const link = 'L' + (s.clipSeq)
      v.items.push({ clip: s.clipSeq++ + id * 1000, item: id, name: m.name, start: time, duration: dur, sourceIn: 0, sourceOut: dur, speed: 1, enabled: true, link, effects: [] })
      if (m.audio) a.items.push({ clip: s.clipSeq++ + id * 1000, item: id, name: m.name, start: time, duration: dur, sourceIn: 0, sourceOut: dur, speed: 1, enabled: true, gainDb: 0, link, effects: [] })
      time += dur
    }
    return { placed: p.items.length }
  },
  'timeline.trim': (p) => {
    const s = seq(); const { c, t } = find(s, p.clip)
    if (p.mode !== 'ripple') throw new Error('mock only supports ripple')
    if (p.delta >= c.duration) throw new Error('trim would remove clip')
    for (const x of [{ c, t }, ...partners(s, c)]) {
      const end = x.c.start + x.c.duration
      if (p.edge === 'in') { if (x.c.sourceIn + p.delta < 0) throw new Error('not enough media handle'); x.c.sourceIn += p.delta } else { x.c.sourceOut -= p.delta }
      x.c.duration -= p.delta
      shiftAfter(x.t, end, -p.delta, x.c)
    }
    return {}
  },
  'timeline.move': (p) => {
    const s = seq()
    const plan = p.moves.map((m) => { const hit = find(s, m.clip); return { hit, delta: m.time - hit.c.start, track: m.track } })
    for (const { hit, delta, track } of plan) {
      hit.c.start += delta
      if (track && track !== hit.t.id) { const to = [...s.video, ...s.audio].find((t) => t.id === track); hit.t.items.splice(hit.t.items.indexOf(hit.c), 1); to.items.push(hit.c) }
      for (const x of partners(s, hit.c)) if (!plan.some((q) => q.hit.c === x.c)) x.c.start += delta
    }
    for (const t of [...s.video, ...s.audio]) {
      const items = t.items.slice().sort((a, b) => a.start - b.start)
      for (let i = 1; i < items.length; i += 1) if (items[i].start < items[i - 1].start + items[i - 1].duration) throw new Error('move would overlap on ' + t.id)
    }
    return {}
  },
  'edit.rippleDelete': (p) => {
    const s = seq()
    for (const id of p.clips) {
      const { c, t } = find(s, id)
      for (const x of [{ c, t }, ...partners(s, c)]) { x.t.items.splice(x.t.items.indexOf(x.c), 1); shiftAfter(x.t, x.c.start + x.c.duration, -x.c.duration) }
    }
    return {}
  },
  'clip.enable': (p) => { const s = seq(); for (const id of p.clips) { const { c } = find(s, id); c.enabled = !c.enabled } return {} },
  'effects.apply': (p) => { const s = seq(); for (const id of p.clips) find(s, id).c.effects.push({ effect: p.effect, enabled: true, params: {} }); return {} },
  'effects.setParam': (p) => {
    const { c } = find(seq(), p.clip); const fx = c.effects.find((e) => e.effect === p.effect)
    if (!fx) throw new Error('effect not applied'); if (p.param === 'bogus') throw new Error('unknown param bogus')
    fx.params[p.param] = { value: typeof p.value === 'boolean' ? 'Bool(' + p.value + ')' : 'Float(' + Number(p.value).toFixed(1) + ')', keyframes: 0 }
    return {}
  },
  'effects.reset': (p) => { const { c } = find(seq(), p.clip); c.effects.splice(p.index, 1); return {} },
  'timeline.razor': (p) => {
    const s = seq(); const { c, t } = find(s, p.clip)
    const cut = p.time - c.start
    if (cut <= 0 || cut >= c.duration) throw new Error('razor time outside clip')
    const right = JSON.parse(JSON.stringify(c)); right.clip = c.clip + 500; right.start = p.time; right.duration = c.duration - cut; right.sourceIn = c.sourceIn + cut; right.link = null
    c.duration = cut; c.sourceOut = c.sourceIn + cut; t.items.push(right)
    return { clips: [c.clip, right.clip] }
  },
  'file.exportInterchange': (p) => { writeFileSync(p.path, 'TITLE: mock ' + p.format + '\n'); return { path: p.path } },
}

function inspectSequence() {
  const s = seq()
  const num = s.settings.fps === 23.976 ? 24000 : Math.round(s.settings.fps * 1000), den = s.settings.fps === 23.976 ? 1001 : 1000
  const dur = seqDuration(s)
  return { id: s.item, name: s.name, settings: { width: s.settings.width, height: s.settings.height, frame_rate: { num, den }, sample_rate: 48000 }, duration: dur, durationFrames: Math.round(dur / TPS * s.settings.fps), playhead: 0, in: 0, out: dur, markers: [], video: s.video, audio: s.audio }
}

function execOne(id, params) {
  const fn = COMMANDS[id]
  if (!fn) throw new Error('unknown command: ' + id)
  return fn(params || {})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function main() {
  const cmd = rest[0]
  try {
    if (cmd === 'commands') return out([
      { id: 'timeline.razor', params: { clip: 'clip id', time: 'ticks (sequence time)' } },
      { id: 'timeline.trim', params: { clip: 'clip id', edge: 'in|out', mode: 'ripple|roll|normal', delta: 'ticks' } },
      { id: 'timeline.move', params: { moves: '[{clip, track, time}]' } },
      { id: 'markers.add', params: { time: 'ticks', name: 'string' } },
      { id: 'render.everything', params: {} },
    ])
    if (cmd === 'probe') { const m = media(rest[1]); return out({ duration: Math.round(m.duration * TPS), video: { width: m.width, height: m.height, frame_rate: { num: m.fps * 1000, den: 1000 }, codec: 'h264' }, audio_streams: m.audio ? [{}] : [], file_size: statSync(rest[1]).size }) }
    if (cmd === 'inspect' && rest[1] === 'project') {
      const children = P.items.map((x) => ({ item: x.item, type: x.type, name: x.name, duration: x.type === 'Sequence' ? seqDuration(x) : Math.round(x.duration * TPS) }))
      return out({ name: P.name, revision: P.revision, activeSequence: P.activeSequence, root: { children } })
    }
    if (cmd === 'inspect' && rest[1] === 'sequence') return out(inspectSequence())
    if (cmd === 'import') { const r = COMMANDS['file.import']({ paths: rest.slice(1).filter((x) => !x.startsWith('--')) }); persist(); return out(r) }
    if (cmd === 'exec') { const r = execOne(rest[1], rest[2] ? JSON.parse(rest[2]) : {}); if (save) persist(); return out(r) }
    if (cmd === 'run') {
      const lines = readFileSync(rest[1], 'utf8').split('\n').filter(Boolean)
      let failed = false
      lines.forEach((line, i) => {
        const step = JSON.parse(line)
        if (failed && !rest.includes('--keep-going')) return
        try { out({ ok: true, id: step.id, line: i + 1, result: execOne(step.id, step.params) }) } catch (e) { failed = true; out({ ok: false, id: step.id, line: i + 1, error: e.message }) }
      })
      if (save) persist()
      process.exit(failed ? 1 : 0)
    }
    if (cmd === 'render') { await sleep(50); writeFileSync(flag('--out'), PNG); return out({ ok: true }) }
    if (cmd === 'export') {
      const target = rest[1]
      const s = inspectSequence(); const fps = s.settings.frame_rate.num / s.settings.frame_rate.den
      const start = Number(flag('--start') || 0), end = flag('--end') ? Number(flag('--end')) : s.duration / TPS
      for (let i = 0; i < 4; i += 1) { writeFileSync(target, Buffer.alloc((i + 1) * 4096)); await sleep(250) }
      const frames = Math.round((end - start) * fps)
      return out({ result: { frames, seconds: end - start, render_fps: 30, bytes: statSync(target).size, path: target } })
    }
    fail('unknown invocation: ' + rest.join(' '))
  } catch (e) { fail(e.message) }
}
main()
