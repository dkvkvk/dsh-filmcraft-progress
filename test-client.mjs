// Render the built client bundle without a browser.
//
// React is mocked with hooks that keep state across re-renders, so the whole
// render path runs for real: the panel polls (mocked fetch), the store
// publishes, and the component re-renders with data.  This catches render-time
// crashes that a syntax check cannot.
import { readFileSync } from 'node:fs'

// ── minimal React ───────────────────────────────────────────────────────────
let hookState = []
let hookIndex = 0
let effectQueue = []

function createElement(type, props, ...children) {
  const flat = []
  const push = (c) => {
    if (Array.isArray(c)) { for (const x of c) push(x); return }
    if (c === null || c === undefined || c === false || c === true) return
    flat.push(c)
  }
  for (const c of children) push(c)
  return { type, props: props || {}, children: flat }
}

const React = {
  createElement,
  useState(init) {
    const i = hookIndex++
    if (!(i in hookState)) hookState[i] = typeof init === 'function' ? init() : init
    const set = (v) => { hookState[i] = typeof v === 'function' ? v(hookState[i]) : v }
    return [hookState[i], set]
  },
  useEffect(fn) { effectQueue.push(fn); hookIndex++ },
  useMemo(fn) { return fn() },
  useRef(v) { return { current: v } },
}

// ── mock module loader + DOM + fetch ────────────────────────────────────────
let loaded = null
const styleTags = []
globalThis.window = { __ModuleLoader__: { load(def) { loaded = def } } }
globalThis.document = {
  createElement() { return { setAttribute() { }, remove() { }, set textContent(v) { styleTags.push(v) }, get textContent() { return '' } } },
  head: { appendChild() { } },
}

const PROJECT = {
  ok: true, path: 'D:\\Myfiles\\临时\\build\\final.fcproj', name: 'B_5994fps',
  fps: 59.94, width: 3840, height: 2880, duration: 241.975, durationFrames: 14504, clipCount: 2,
  clips: [
    {
      clip: 69, item: 22, name: 'DJI_20261013121257_0332_D.MP4', label: 'Iris', start: 0, dur: 9.45945,
      end: 9.45945, sourceIn: 0, sourceOut: 9.45945, startFrame: 0, durationFrames: 567, speed: 1,
      enabled: true, gainDb: 0,
      grade: { index: 0, enabled: true, contrast: 27, highlights: -58, saturation: 115, temperature: -14 },
    },
    {
      clip: 70, item: 23, name: 'DJI_20261013121345_0333_D.MP4', label: 'Rose', start: 9.45945, dur: 1.802,
      end: 11.26145, sourceIn: 0, sourceOut: 1.802, startFrame: 567, durationFrames: 108, speed: 1,
      enabled: true, gainDb: 0, grade: null,
    },
  ],
}

const STATE = {
  ok: true, now: Date.now(), statusPath: 'D:\\Myfiles\\临时\\film-status.json',
  project: '深圳天文台 · 逐段调色（33 段全长）', mode: 'batch', phase: 'export', phaseLabel: '导出中 1/33',
  message: '0310 · 第 1/33 段', running: true, startedAt: new Date().toISOString(),
  elapsedMs: 60000, elapsedText: '0:01:00', etaMs: 600000, etaText: '0:10:00',
  percent: 12.5, percentBasis: 'bytes',
  export: { path: 'D:\\Myfiles\\临时\\成片_逐段调色\\a.mp4', exists: true, bytes: 1048576, bytesText: '1 MB', expectedBytes: 8388608, expectedText: '8 MB', rateBytesPerSec: 1000, rateText: '0.00 MB/s', mtimeMs: Date.now() },
  video: { width: 3840, height: 2880, fps: '50 / 59.94 混合', codec: 'H.264 High' },
  timeline: { width: 3840, height: 2880, fps: '50 + 59.94 双序列', durationSeconds: 983.3, shotCount: 2 },
  stats: { sea: 21, trail: 7, cat: 1, neutral: 4 },
  grades: { sea: { contrast: 26, saturation: 110 }, trail: { contrast: 27, saturation: 115 } },
  shots: [
    { n: 1, tag: '0310', cat: 'trail', start: 0, dur: 7.6, fps: 50, status: 'done' },
    { n: 2, tag: '0319', cat: 'sea', start: 7.6, dur: 8, fps: 50, status: 'exporting' },
    { n: 3, tag: '0322', cat: 'sea', start: 15.6, dur: 8, fps: 50, status: 'pending' },
    { n: 4, tag: '0332', cat: 'trail', start: 23.6, dur: 9.46, fps: 59.94, status: 'failed' },
  ],
  notes: ['测试备注'],
  historyCount: 2, error: null,
}

const calls = []
globalThis.fetch = async (path, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null
  calls.push({ path, method: (init && init.method) || 'GET', body })
  let value
  if (path.endsWith('/state')) value = STATE
  else if (path.endsWith('/projects')) value = { ok: true, roots: ['D:\\Myfiles\\临时'], projects: [{ path: PROJECT.path, name: PROJECT.name, size: 145000, mtime: Date.now() }] }
  else if (path.endsWith('/open')) value = PROJECT
  else if (path.endsWith('/apply')) value = { ok: true, applied: 1, failed: 0, rejected: [], snapshotted: true, undoDepth: 1, results: [] }
  else if (path.endsWith('/undo')) value = { ok: true, remaining: 0 }
  else if (path.endsWith('/export')) value = { ok: true, pid: 4242, out: 'D:\\out.mp4' }
  else value = { error: 'unknown ' + path }
  return { ok: true, json: async () => value }
}

// ── load the bundle ─────────────────────────────────────────────────────────
await import('./dist/native/client.js')
if (loaded === null) { console.log('❌ 未捕获到模块加载'); process.exit(1) }
const mod = loaded.factory((name) => { if (name === 'react') return React; throw new Error('unknown require ' + name) })
console.log('插件 ' + mod.name + '  注入 ' + JSON.stringify(mod.inject))

// ── mock slot context ───────────────────────────────────────────────────────
const registrations = []
const slots = {
  inject(name, fn) { try { fn() } catch (e) { console.log('  inject(' + name + ') 抛错: ' + e.message) } return () => { } },
  register(meta, render) { const r = { meta, render }; registrations.push(r); return r },
}
const ctx = {
  get(name) {
    if (name === 'slots') return slots
    if (name === 'sidebarRightTabs' || name === 'sidebarRight') return undefined
    return undefined
  },
  slots,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => { } },
  timer: { setTimeout: (f, ms) => setTimeout(f, ms) },
}
mod.apply(ctx)
console.log('注册槽位 ' + registrations.length + ' 个：' + registrations.map(r => r.meta.name).join(', '))
console.log('样式表 ' + styleTags.length + ' 条，共 ' + (styleTags.join('').length) + ' 字符\n')

// ── render ──────────────────────────────────────────────────────────────────
function expand(node, depth) {
  if (depth > 60) throw new Error('渲染过深（可能是无限递归）')
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(n => expand(n, depth + 1))
  const { type, props, children } = node
  if (typeof type === 'function') {
    const p = Object.assign({}, props)
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    return expand(type(p), depth + 1)
  }
  return { type, props, children: children.map(c => expand(c, depth + 1)) }
}

function textOf(node, out) {
  out = out || []
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out }
  if (node.children) for (const c of node.children) textOf(c, out)
  return out
}

function render(component, props) {
  hookState = []
  hookIndex = 0
  effectQueue = []
  const tree = expand(React.createElement(component, props), 0)
  // React runs effects after paint; the panel's poller and listener wiring live
  // there, so nothing would ever fetch without this.
  for (const fn of effectQueue) { try { fn() } catch (e) { console.log('   effect 抛错: ' + e.message) } }
  return tree
}

const settings = registrations.find(r => r.meta.name === 'settings.section')
if (settings === undefined) { console.log('❌ 没有 settings.section 注册'); process.exit(1) }

// The settings render returns h(Panel, {wide:true}); call it, then expand.
let failed = false
function attempt(label, fn) {
  try { const t = fn(); console.log('✅ ' + label); return t } catch (e) {
    failed = true
    console.log('❌ ' + label + '  →  ' + e.message)
    console.log(e.stack.split('\n').slice(1, 4).join('\n'))
    return null
  }
}

console.log('── 渲染 ──')
let tree = attempt('首屏渲染（进度视图，数据未到）', () => render(settings.render().type, settings.render().props))
if (tree) console.log('   文本: ' + textOf(tree).join(' | ').slice(0, 200))

// let the poll resolve, then re-render
await new Promise(r => setTimeout(r, 60))
tree = attempt('数据到达后渲染（进度视图 · batch 模式）', () => render(settings.render().type, settings.render().props))
if (tree) {
  const t = textOf(tree).join(' | ')
  console.log('   含「片段表」: ' + t.includes('片段表'))
  console.log('   含「逐段调色」: ' + t.includes('逐段调色'))
  console.log('   含「导出中 1/33」: ' + t.includes('导出中 1/33'))
  console.log('   分镜行数（fc-shot）: ' + (JSON.stringify(tree).split('"fc-shot"').length - 1))
}

console.log('\n── 剪辑视图 ──')
// flip the editor view by driving the tab button's onClick
function findClickable(node, label, out) {
  out = out || []
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) findClickable(n, label, out); return out }
  if (node.children) {
    const t = textOf(node).join('')
    if (t.indexOf(label) >= 0 && node.props && typeof node.props.onClick === 'function') out.push(node)
    for (const c of node.children) findClickable(c, label, out)
  }
  return out
}
const tabBtns = findClickable(tree, '剪辑')
console.log('找到「剪辑」按钮: ' + tabBtns.length)
if (tabBtns.length) {
  tabBtns[0].props.onClick()
  await new Promise(r => setTimeout(r, 80))
  let editTree = attempt('剪辑视图渲染（工程列表）', () => render(settings.render().type, settings.render().props))
  // click the project row to open it
  const rows = findClickable(editTree, 'B_5994fps')
  console.log('   工程行可点: ' + rows.length)
  if (rows.length) {
    rows[0].props.onClick()
    await new Promise(r => setTimeout(r, 80))
    editTree = attempt('剪辑视图渲染（工程已打开）', () => render(settings.render().type, settings.render().props))
  }
  if (editTree) {
    const t = textOf(editTree).join(' | ')
    const missing = []
    for (const probe of ['扫描', '片段', '裁头', '裁尾', '排序', '调色', '海景', '山路', '撤销', '导出选中片段', '导出整条序列']) {
      if (!t.includes(probe)) missing.push(probe)
    }
    console.log('   缺少的控件: ' + (missing.length ? missing.join(', ') : '无'))
    console.log('   工程名出现: ' + t.includes('B_5994fps'))
    console.log('   片段名出现: ' + t.includes('0332_D') + '（应为 true）')
    console.log('   片段行数: ' + (JSON.stringify(editTree).split('"fc-clip').length - 1) + '（应为 2）')
  }
}

console.log('\n── 交互调用 ──')
console.log('已发出的请求：')
for (const c of calls) console.log('   ' + c.method.padEnd(5) + c.path.replace('/dsh-filmcraft-progress/api/', '') + (c.body ? '  ' + JSON.stringify(c.body).slice(0, 90) : ''))

console.log('\n' + (failed ? '❌ 有渲染失败' : '✅ 全部渲染通过'))
process.exit(failed ? 1 : 0)
