// Render the built client bundle without a browser.
//
// React is mocked faithfully enough to catch the bug class that broke the real
// panel: useState state persists across renders and a setter whose value is
// Object.is-equal to the current state does NOT schedule a re-render.  A store
// that notifies listeners with no argument (setter(undefined) twice in a row)
// therefore silently stops repainting — and this test fails instead of passing.
import { readFileSync } from 'node:fs'

// ── minimal React ───────────────────────────────────────────────────────────
let hookOwner = null
const hooksByOwner = new Map()   // component function -> hook slots
let hookIndex = 0
let effectQueue = []
let dirty = false                // did any setter actually change a value?

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
    const slots = hooksByOwner.get(hookOwner) || []
    hooksByOwner.set(hookOwner, slots)
    const i = hookIndex++
    if (!(i in slots)) slots[i] = { value: typeof init === 'function' ? init() : init, ran: false }
    const slot = slots[i]
    const set = (v) => {
      const next = typeof v === 'function' ? v(slot.value) : v
      // React's eager bailout: an identical value schedules no work at all.
      if (Object.is(next, slot.value)) return
      slot.value = next
      dirty = true
    }
    return [slot.value, set]
  },
  useEffect(fn) {
    const slots = hooksByOwner.get(hookOwner)
    const i = hookIndex++
    const slot = slots[i] || (slots[i] = { value: undefined, ran: false })
    if (!slot.ran) { slot.ran = true; effectQueue.push(fn) }   // models [] deps
  },
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
  get(name) { if (name === 'slots') return slots; return undefined },
  slots,
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => { } },
  timer: { setTimeout: (f, ms) => setTimeout(f, ms) },
}
mod.apply(ctx)
console.log('注册槽位 ' + registrations.length + ' 个：' + registrations.map(r => r.meta.name).join(', '))
console.log('样式表 ' + styleTags.length + ' 条，' + (styleTags.join('').length) + ' 字符\n')

// ── render / paint ──────────────────────────────────────────────────────────
function expand(node, depth) {
  if (depth > 60) throw new Error('渲染过深（可能无限递归）')
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(n => expand(n, depth + 1))
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

const settings = registrations.find(r => r.meta.name === 'settings.section')
if (settings === undefined) { console.log('❌ 没有 settings.section 注册'); process.exit(1) }
const mount = () => settings.render()

let currentTree = null
let failed = false

function renderOnce() {
  effectQueue = []
  dirty = false
  const tree = expand(React.createElement(mount().type, mount().props), 0)
  for (const fn of effectQueue) { try { fn() } catch (e) { console.log('   effect 抛错: ' + e.message) } }
  currentTree = tree
  return tree
}

// Repaint the way React would: only when a setter actually changed something.
function paint(label) {
  if (currentTree === null) { console.log('   ' + label + '：首帧'); return renderOnce() }
  if (!dirty) {
    console.log('   ' + label + '：⚠️ 没有任何 setter 改变状态 → React 不会重渲染')
    return currentTree
  }
  return renderOnce()
}

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

function attempt(label, fn) {
  try { const t = fn(); console.log('✅ ' + label); return t } catch (e) {
    failed = true
    console.log('❌ ' + label + '  →  ' + e.message)
    console.log(e.stack.split('\n').slice(1, 4).join('\n'))
    return currentTree
  }
}

function check(ok, label) {
  console.log((ok ? '   ✓ ' : '   ❌ ') + label)
  if (!ok) failed = true
}

console.log('── 首屏 ──')
let tree = attempt('进度视图渲染', renderOnce)
console.log('   文本: ' + textOf(tree).join(' | ').slice(0, 90))

await new Promise(r => setTimeout(r, 60))
console.log('\n── 轮询到达后 ──')
tree = attempt('重渲染', () => paint('数据到达'))
{
  const t = textOf(tree).join(' | ')
  check(t.includes('片段表'), '出现「片段表」（batch 模式）')
  check(t.includes('逐段调色'), '出现「逐段调色」')
  check(t.includes('导出中 1/33'), '出现「导出中 1/33」')
  check(JSON.stringify(tree).split('"fc-shot"').length - 1 === 4, '分镜 4 行')
}

console.log('\n── 点击「剪辑」标签（回归：这一击曾经失效）──')
tree = attempt('点标签', () => { findClickable(tree, '剪辑')[0].props.onClick(); return paint('切换后') })
check(textOf(tree).join('').includes('扫描'), '剪辑视图出现「扫描」按钮')

await new Promise(r => setTimeout(r, 80))
tree = attempt('重渲染', () => paint('工程列表到达'))
{
  const rows = findClickable(tree, 'B_5994fps')
  check(rows.length > 0, '工程行出现')

  console.log('\n── 点击工程行（回归：这一击曾经失效）──')
  rows[0].props.onClick()
  await new Promise(r => setTimeout(r, 80))
  tree = attempt('重渲染', () => paint('工程打开后'))
  const t = textOf(tree).join(' | ')
  check(t.includes('0332_D'), '片段名出现（工程已打开）')
  const missing = ['裁头', '裁尾', '排序', '海景', '山路', '撤销', '导出选中片段', '导出整条序列'].filter(x => !t.includes(x))
  check(missing.length === 0, '编辑控件齐全' + (missing.length ? '，缺：' + missing.join(',') : ''))
}

console.log('\n── 点击「进度」标签（回归：这一击曾经失效）──')
tree = attempt('点标签', () => { findClickable(tree, '进度')[0].props.onClick(); return paint('切回后') })
check(textOf(tree).join('').includes('片段表'), '切回进度视图')

console.log('\n── 已发出的请求 ──')
for (const c of calls) console.log('   ' + c.method.padEnd(5) + c.path.replace('/dsh-filmcraft-progress/api/', '') + (c.body ? '  ' + JSON.stringify(c.body).slice(0, 80) : ''))

console.log('\n' + (failed ? '❌ 有失败项' : '✅ 全部通过'))
process.exit(failed ? 1 : 0)
