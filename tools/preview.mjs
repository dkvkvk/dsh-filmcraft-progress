// Render the real panel components to a static HTML page, so the CSS can be
// inspected in a real browser engine instead of being argued about.
//
// Why this exists: the panel lives in a ~344 px right sidebar, and the only way
// to catch a layout that is too cramped, a label that overlaps, or a colour that
// has no contrast is to look at real pixels. The node harness (test-client.mjs)
// proves structure and payloads but has no CSS engine. This tool reuses the same
// fake React tree, serialises it to HTML, and writes preview/panel.html — then
// scripts/shot-preview.mjs hands it to headless Chrome.
//
// It is a development aid: not shipped, not part of dist.
import { writeFileSync, mkdirSync } from 'node:fs'

// ── a React just good enough to render ──────────────────────────────────────
let hookOwner = null
const hooksByOwner = new Map()
let hookIndex = 0
let effectQueue = []
let dirty = false

function createElement(type, props, ...children) {
  const flat = []
  const push = (child) => {
    if (Array.isArray(child)) { for (const item of child) push(item); return }
    if (child === null || child === undefined || child === false || child === true) return
    flat.push(child)
  }
  for (const child of children) push(child)
  return { type, props: props || {}, children: flat }
}

const React = {
  createElement,
  useState(init) {
    const slots = hooksByOwner.get(hookOwner) || []
    hooksByOwner.set(hookOwner, slots)
    const index = hookIndex++
    if (!(index in slots)) slots[index] = { value: typeof init === 'function' ? init() : init }
    const slot = slots[index]
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      dirty = true
    }
    return [slot.value, set]
  },
  useEffect(fn) {
    const slots = hooksByOwner.get(hookOwner)
    const index = hookIndex++
    const slot = slots[index] || (slots[index] = { ran: false })
    if (!slot.ran) { slot.ran = true; effectQueue.push(fn) }
  },
  useMemo(fn) { return fn() },
  useRef(value) {
    const slots = hooksByOwner.get(hookOwner)
    const index = hookIndex++
    const slot = slots[index] || (slots[index] = { value: { current: value } })
    return slot.value
  },
}

// ── the globals the bundle expects ──────────────────────────────────────────
let loaded = null
const styleTags = []
globalThis.window = {
  __ModuleLoader__: { load(def) { loaded = def } },
  innerHeight: 900,
  addEventListener() { },
  removeEventListener() { },
}
globalThis.document = {
  createElement() {
    return {
      setAttribute() { }, remove() { },
      set textContent(value) { styleTags.push(value) },
      get textContent() { return '' },
    }
  },
  head: { appendChild() { } },
}
// A real picture for the preview box, so the aspect-ratio sizing is visible.
const FRAME_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='480'>" +
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0.3' y2='1'>" +
  "<stop offset='0' stop-color='#0a1626'/><stop offset='0.55' stop-color='#1b2740'/><stop offset='1' stop-color='#4a2b1c'/>" +
  "</linearGradient></defs><rect width='640' height='480' fill='url(#g)'/>" +
  "<g fill='#dfe9f5'>" +
  "<circle cx='60' cy='50' r='1.4'/><circle cx='120' cy='120' r='1'/><circle cx='210' cy='70' r='1.6'/>" +
  "<circle cx='300' cy='40' r='1'/><circle cx='380' cy='110' r='1.3'/><circle cx='470' cy='60' r='1'/>" +
  "<circle cx='560' cy='130' r='1.5'/><circle cx='90' cy='200' r='1.2'/><circle cx='250' cy='170' r='1'/>" +
  "<circle cx='520' cy='210' r='1.1'/><circle cx='640-60' cy='250' r='1.3'/>" +
  "</g><circle cx='480' cy='330' r='2.6' fill='#f0f6ff'/>" +
  "<path d='M0 400 L120 330 L230 390 L360 300 L520 360 L640 320 L640 480 L0 480 Z' fill='#0d1522'/>" +
  "</svg>"
globalThis.URL.createObjectURL = () => 'data:image/svg+xml;utf8,' + encodeURIComponent(FRAME_SVG)
globalThis.URL.revokeObjectURL = () => { }

// ── fixtures ────────────────────────────────────────────────────────────────
const ROOT = 'D:\\Myfiles\\FilmCraft'
const WORKSPACE = {
  ok: true, version: '0.3.0', root: 'D:/Myfiles/FilmCraft', rootDisplay: ROOT,
  paths: { registry: ROOT + '\\registry.json', projects: ROOT + '\\projects', exports: ROOT + '\\exports', work: ROOT + '\\work', jobs: ROOT + '\\jobs.json', previews: ROOT + '\\previews' },
  cli: { path: 'C:\\Program Files\\FilmCraft\\filmcraft-cli.exe', exists: true },
  settings: { root: 'D:/Myfiles/FilmCraft', previewSeconds: 3, preset: 'neutral' },
  presets: [
    { id: 'neutral', name: '中性', color: '#8b949e', builtin: true },
    { id: 'sea', name: '海景', color: '#2f81f7', builtin: true },
    { id: 'trail', name: '星空延时', color: '#a371f7', builtin: true },
    { id: 'warm', name: '暖调', color: '#db6d28', builtin: true },
  ],
  counts: { projects: 4, missing: 1, jobs: 3, running: 1 },
  legacyRoot: 'D:/Myfiles/临时',
}
const PROJECTS = [
  { id: 'p1', name: '深圳天文台', file: ROOT + '\\projects\\深圳天文台.fcproj', exists: true, bytes: 25165824, savedAt: '2026-10-21T07:12:00.000Z', clips: 33, duration: 412.5 },
  { id: 'p2', name: 'export', file: 'D:/Myfiles/临时/build/export.fcproj', exists: true, bytes: 4194304, savedAt: '2026-10-20T09:41:00.000Z', clips: 3, duration: 11.26 },
  { id: 'p3', name: '无人机合集_2026秋', file: ROOT + '\\projects\\无人机合集_2026秋.fcproj', exists: true, bytes: 94371840, savedAt: '2026-10-19T15:02:00.000Z', clips: 12, duration: 96.4 },
  { id: 'p4', name: '已删除的工程', file: ROOT + '\\projects\\gone.fcproj', exists: false, bytes: 0, savedAt: '2026-09-30T02:00:00.000Z', clips: 0, duration: 0 },
]
const clip = (id, name, start, dur, effects) => ({
  clip: id, item: id + 100, name, track: 'V1', trackLabel: 'V1', kind: 'video',
  start, dur, end: start + dur, sourceIn: 0, sourceOut: dur, speed: 1, enabled: true,
  gainDb: 0, link: null, effects: effects || [],
})
const DETAIL = {
  ok: true,
  project: { id: 'p1', name: '深圳天文台', file: ROOT + '\\projects\\深圳天文台.fcproj' },
  sequence: {
    id: 9, name: '序列 1', duration: 26.4, frames: 1582, width: 3840, height: 2880, fps: 59.94,
    preset: 'neutral', sampleRate: 48000, playhead: 0, inPoint: 0, outPoint: 0, markers: 2,
    tracks: {
      video: [{
        id: 'V1', label: 'V1', kind: 'video', enabled: true, muted: false, locked: false, clipCount: 5,
        items: [
          clip(69, 'DJI_20261013121257_0332_D.MP4', 0, 9.459),
          clip(70, 'DJI_20261013121345_0333_D.MP4', 9.459, 1.802, [{ effect: 'lumetri', enabled: true, params: { contrast: 27 } }]),
          clip(71, 'DJI_20261013121901_0334_D.MP4', 11.261, 6.2),
          clip(72, 'DJI_20261013122533_0335_D.MP4', 17.461, 4.8),
          clip(73, 'A7S3_20261013_001.MP4', 22.261, 4.139),
        ],
      }],
      audio: [],
    },
    // The host normalises a flat clip list next to the track tree; the client
    // reads this one.
    clips: [
      clip(69, 'DJI_20261013121257_0332_D.MP4', 0, 9.459),
      clip(70, 'DJI_20261013121345_0333_D.MP4', 9.459, 1.802, [{ effect: 'lumetri', enabled: true, params: { contrast: 27 } }]),
      clip(71, 'DJI_20261013121901_0334_D.MP4', 11.261, 6.2),
      clip(72, 'DJI_20261013122533_0335_D.MP4', 17.461, 4.8),
      clip(73, 'A7S3_20261013_001.MP4', 22.261, 4.139),
    ],
  },
  sequences: [{ id: 9, name: '序列 1', clips: 5 }, { id: 10, name: '竖屏剪辑', clips: 2 }],
  assets: [
    { item: 22, name: 'DJI_20261013121257_0332_D.MP4', kind: 'video', dur: 9.459 },
    { item: 23, name: 'DJI_20261013121345_0333_D.MP4', kind: 'video', dur: 1.802 },
    { item: 40, name: '背景音乐.wav', kind: 'audio', dur: 180 },
  ],
  missing: 0,
}
const JOB = (id, kind, state, pct) => ({
  id, kind, state, createdAt: '2026-10-21T08:15:12.738Z', startedAt: '2026-10-21T08:15:13.000Z',
  endedAt: state === 'running' ? null : '2026-10-21T08:16:40.000Z',
  out: ROOT + '\\exports\\深圳天文台_1.mp4', bytes: state === 'done' ? 7439786 : null,
  progress: state === 'running' ? { ratio: pct, frames: 210, total: 1582 } : { ratio: 1, frames: 1582, total: 1582 },
  etaSeconds: state === 'running' ? 96 : null,
  command: 'export --preset h264 --range 0-26.4',
  log: ROOT + '\\jobs\\' + id + '.log',
  error: state === 'failed' ? 'ffmpeg exited with code 1' : null,
})
const JOBS = [JOB('j1', 'export', 'running', 0.13), JOB('j2', 'proxy', 'done', 1), JOB('j3', 'export', 'failed', null)]

const json = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) })
globalThis.fetch = async (url) => {
  const path = String(url)
  if (path.indexOf('/api/workspace') >= 0) return json(WORKSPACE)
  if (path.indexOf('/api/projects') >= 0) return json({ ok: true, projects: PROJECTS })
  if (path.indexOf('/api/project') >= 0) return json(DETAIL)
  if (path.indexOf('/api/jobs') >= 0) return json({ ok: true, jobs: JOBS, calibration: [] })
  if (path.indexOf('/api/state') >= 0) return json({ ok: true, present: true, state: { project: 'p1', clips: 33 } })
  if (path.indexOf('/api/frame') >= 0 || path.indexOf('/api/media') >= 0) {
    return { ok: true, status: 200, blob: async () => ({ size: 1234, type: 'image/png' }), json: async () => ({ ok: true }), text: async () => '' }
  }
  if (path.indexOf('/api/browse') >= 0) {
    return json({
      ok: true, path: 'D:\\Myfiles\\临时\\tianwentai', parent: 'D:\\Myfiles\\临时',
      dirs: [{ name: 'build', path: 'D:\\Myfiles\\临时\\tianwentai\\build' }],
      files: [
        { name: 'DJI_20261013121257_0332_D.MP4', path: 'D:\\Myfiles\\临时\\tianwentai\\DJI_20261013121257_0332_D.MP4', bytes: 4215275520, savedAt: '2026-10-13T12:12:57.000Z' },
        { name: 'DJI_20261013121345_0333_D.MP4', path: 'D:\\Myfiles\\临时\\tianwentai\\DJI_20261013121345_0333_D.MP4', bytes: 812646400, savedAt: '2026-10-13T12:13:45.000Z' },
        { name: 'A7S3_20261013_001.MP4', path: 'D:\\Myfiles\\临时\\tianwentai\\A7S3_20261013_001.MP4', bytes: 2147483648, savedAt: '2026-10-13T21:04:00.000Z' },
      ],
      projects: [],
    })
  }
  return json({ ok: true })
}

// ── load the built bundle the same way the shell does ───────────────────────
await import('../dist/native/client.js')
if (loaded === null) { console.error('没有捕获到模块加载'); process.exit(1) }
const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unknown require ' + name)
})
const styleTagsStart = styleTags.length
const registrations = []
const slots = {
  inject(name, fn) { fn(); return () => { } },
  register(meta, render) { const entry = { meta, render }; registrations.push(entry); return entry },
}
const ctx = {
  get(name) {
    if (name === 'slots') return slots
    if (name === 'sidebarRightTabs') return { register(meta) { return () => { } } }
    if (name === 'sidebarRight') return { openTab() { } }
    return undefined
  },
  slots,
  effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => { } },
  timer: { setTimeout: (f, ms) => setTimeout(f, ms) },
}
mod.apply(ctx)
const tabEntry = registrations.find((r) => r.meta.name === 'sidebar.right.pane.tab')
if (!tabEntry) { console.error('没有注册侧栏标签'); process.exit(1) }
const css = styleTags.slice(styleTagsStart).join('')

// ── render ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function expand(node, depth) {
  if (depth > 80) throw new Error('渲染过深')
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((item) => expand(item, depth + 1))
  const { type, props, children } = node
  if (typeof type === 'function') {
    const p = Object.assign({}, props)
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    const prevOwner = hookOwner
    const prevIndex = hookIndex
    hookOwner = type
    hookIndex = 0
    let out
    try { out = expand(type(p), depth + 1) } finally { hookOwner = prevOwner; hookIndex = prevIndex }
    return out
  }
  return { type, props, children: children.map((child) => expand(child, depth + 1)) }
}
let tree = null
function render() {
  effectQueue = []
  dirty = false
  tree = expand(React.createElement(tabEntry.render().type, tabEntry.render().props), 0)
  for (const fn of effectQueue) { try { fn() } catch (error) { console.error('effect: ' + error.message) } }
  return tree
}
function textOf(node, out) {
  out = out || []
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const item of node) textOf(item, out); return out }
  if (node.children) for (const child of node.children) textOf(child, out)
  return out
}
function find(node, pred, out) {
  out = out || []
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) find(item, pred, out); return out }
  if (pred(node)) out.push(node)
  if (node.children) for (const child of node.children) find(child, pred, out)
  return out
}

// ── serialise ───────────────────────────────────────────────────────────────
const VOID = new Set(['input', 'img', 'br', 'hr'])
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function styleOf(value) {
  if (value === null || typeof value !== 'object') return ''
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + ':' + v)
    .join(';')
}
function attrsOf(node) {
  const props = node.props || {}
  let out = ''
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key' || key === 'ref' || key === 'onClick' || key === 'onChange' || key === 'onInput' || key === 'onBlur' || key === 'onKeyDown') continue
    if (typeof value === 'function' || value === null || value === undefined || value === false) continue
    if (key === 'className') { if (value) out += ' class="' + esc(value) + '"'; continue }
    if (key === 'style') { const s = styleOf(value); if (s) out += ' style="' + esc(s) + '"'; continue }
    if (key === 'value') continue
    if (key === 'checked') { if (value) out += ' checked'; continue }
    if (key === 'disabled') { out += ' disabled'; continue }
    out += ' ' + key + '="' + esc(value) + '"'
  }
  const type = props.type
  if (node.type === 'input' && props.value !== undefined && type !== 'checkbox' && type !== 'range') {
    out += ' value="' + esc(props.value) + '"'
  }
  if (node.type === 'input' && type === 'range' && props.value !== undefined) {
    out += ' value="' + esc(props.value) + '"'
  }
  return out
}
function html(node, parent) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map((item) => html(item, parent)).join('')
  if (typeof node !== 'object') return esc(node)
  const type = node.type
  if (typeof type !== 'string') return node.children.map((c) => html(c, parent)).join('')
  if (type === 'select') {
    const want = node.props ? node.props.value : undefined
    const options = node.children.map((child) => {
      if (child && typeof child === 'object' && child.type === 'option') {
        const v = child.props ? child.props.value : undefined
        const mark = String(v) === String(want) ? ' selected' : ''
        return '<option value="' + esc(v === undefined ? '' : v) + '"' + mark + '>' + child.children.map((c) => html(c, child)).join('') + '</option>'
      }
      return html(child, node)
    }).join('')
    return '<select' + attrsOf(node) + '>' + options + '</select>'
  }
  if (type === 'textarea') {
    return '<textarea' + attrsOf(node) + '>' + esc(node.props && node.props.value !== undefined ? node.props.value : '') + '</textarea>'
  }
  const inner = node.children.map((c) => html(c, node)).join('')
  if (VOID.has(type)) return '<' + type + attrsOf(node) + '>'
  return '<' + type + attrsOf(node) + '>' + inner + '</' + type + '>'
}

// ── drive the five pages ────────────────────────────────────────────────────
render()
await sleep(120)
render()
await sleep(120)
if (dirty) render()

// Open a project first so 剪辑 renders its dense state (clip list + preview +
// grading controls) instead of the empty placeholder — that screen is the one
// most likely to break at 344 px.
const opener = find(tree, (n) => {
  if (!n.props || typeof n.props.onClick !== 'function') return false
  if (typeof n.props.className !== 'string') return false
  if (n.props.className.indexOf('fc-clip') < 0) return false
  return textOf(n).join('').indexOf('深圳天文台') >= 0
})[0]
if (opener) { opener.props.onClick(); render(); await sleep(250); if (dirty) render(); await sleep(150); if (dirty) render() }

const PAGES = ['项目', '剪辑', '合并', '任务', '设置']
const shots = []
for (const label of PAGES) {
  const tabNode = find(tree, (n) => {
    const cn = n.props && n.props.className
    return typeof cn === 'string' && cn.split(' ').indexOf('fc-tab') >= 0 && textOf(n).join('').indexOf(label) >= 0
  })[0]
  if (tabNode && typeof tabNode.props.onClick === 'function') { tabNode.props.onClick(); }
  render()
  await sleep(150)
  if (dirty) render()
  await sleep(80)
  if (dirty) render()
  shots.push({ label, body: html(tree, null) })
}

const panel = (inner, width) => '<div class="stage" style="width:' + width + 'px">' + inner + '</div>'
const page = `<!doctype html>
<meta charset="utf-8">
<title>filmcraft-progress 面板预览</title>
<style>
  html,body{margin:0;padding:0;background:#0b0e11;color:#e6edf3;
    font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;}
  .board{display:flex;gap:18px;padding:18px;align-items:flex-start;
    background:repeating-linear-gradient(45deg,#0b0e11,#0b0e11 12px,#0e1216 12px,#0e1216 24px);}
  .stage{flex:0 0 auto;background:#161b22;border:1px solid #30363d;border-radius:10px;
    overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.45);}
  .stage > .fc-root{padding:8px;}
  .cap{font:600 11px/1.4 "Segoe UI",sans-serif;color:#8b949e;letter-spacing:.08em;
    text-transform:uppercase;margin:0 0 6px 2px;}
  .col{display:flex;flex-direction:column}
</style>
<style>${css}</style>
<div class="board">
${shots.map((s) => '<div class="col"><div class="cap">' + esc(s.label) + '</div>' + panel(s.body, 344) + '</div>').join('\n')}
</div>
`
mkdirSync('preview', { recursive: true })
writeFileSync('preview/panel.html', page, 'utf8')
console.log('写入 preview/panel.html  ' + page.length + ' 字符，' + shots.length + ' 页，CSS ' + css.length + ' 字符')
// The panel starts its own poll timer (ctx.timer), so the event loop would never
// drain. This is a batch renderer: flush stdout and leave.
process.exit(0)
