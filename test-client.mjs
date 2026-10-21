// Render the built client bundle without a browser.
//
// The bug this harness exists for is the one that broke web boot: a module that
// touched `ctx` at top level, before the loader had called apply(). So the first
// assertion is simply "the bundle imports and exposes apply" — no DOM needed.
//
// After that it paints the panel through the same slot registration the real
// shell uses, with a mocked fetch that answers the 0.3.0 routes, and drives the
// buttons (扫描 / 打开工程 / 裁头 / 导出) to prove the panel talks to the host
// with the right payloads.
import { readFileSync } from 'node:fs'

// ── minimal React ───────────────────────────────────────────────────────────
let hookOwner = null
const hooksByOwner = new Map()
let hookIndex = 0
let effectQueue = []
let dirty = false
let mockTop = 210

function createElement(type, props, ...children) {
  const flat = []
  const push = (child) => {
    if (Array.isArray(child)) { for (const item of child) push(item); return }
    if (child === null || child === undefined || child === false || child === true) return
    flat.push(child)
  }
  for (const child of children) push(child)
  const node = { type, props: props || {}, children: flat }
  if (typeof type === 'string') {
    node.getBoundingClientRect = () => ({ top: mockTop, left: 0, width: 400, height: 300 })
  }
  const ref = node.props.ref
  if (ref !== null && typeof ref === 'object' && 'current' in ref) {
    ref.current = node
    Object.defineProperty(node.props, 'ref', { value: ref, enumerable: false, writable: true, configurable: true })
  }
  return node
}

const React = {
  createElement,
  useState(init) {
    const slots = hooksByOwner.get(hookOwner) || []
    hooksByOwner.set(hookOwner, slots)
    const index = hookIndex++
    if (!(index in slots)) slots[index] = { value: typeof init === 'function' ? init() : init, ran: false }
    const slot = slots[index]
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      // React's eager bailout: an identical value schedules no work at all.
      if (Object.is(value, slot.value)) return
      slot.value = value
      dirty = true
    }
    return [slot.value, set]
  },
  useEffect(fn) {
    const slots = hooksByOwner.get(hookOwner)
    const index = hookIndex++
    const slot = slots[index] || (slots[index] = { value: undefined, ran: false })
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

// ── mock loader / DOM / fetch ───────────────────────────────────────────────
let loaded = null
const styleTags = []
const winListeners = {}
globalThis.window = {
  __ModuleLoader__: { load(def) { loaded = def } },
  innerHeight: 1000,
  addEventListener(kind, fn) { winListeners[kind] = fn },
  removeEventListener(kind) { delete winListeners[kind] },
}
globalThis.document = {
  createElement() {
    return { setAttribute() { }, remove() { }, set textContent(value) { styleTags.push(value) }, get textContent() { return '' } }
  },
  head: { appendChild() { } },
}
let blobSeq = 0
globalThis.URL.createObjectURL = () => 'blob:mock/' + (++blobSeq)
globalThis.URL.revokeObjectURL = () => { }

// ── fake host data ──────────────────────────────────────────────────────────
const PROJECT_PATH = 'D:\\Myfiles\\FilmCraft\\projects\\深圳天文台.fcproj'
const WORKSPACE = {
  ok: true, version: '0.3.0', root: 'D:/Myfiles/FilmCraft', rootDisplay: 'D:\\Myfiles\\FilmCraft',
  paths: { registry: '', projects: '', exports: 'D:\\Myfiles\\FilmCraft\\exports', work: '', jobs: '', previews: '' },
  cli: { path: 'C:\\Program Files\\FilmCraft\\filmcraft-cli.exe', exists: true },
  settings: {}, presets: [
    { id: 'neutral', name: '中性', color: '#8b949e', builtin: true },
    { id: 'sea', name: '海景', color: '#2f81f7', builtin: true },
  ],
  counts: { projects: 1, missing: 0, jobs: 1, running: 1 },
  legacyRoot: '',
}

const CLIP_A = {
  clip: 69, item: 22, name: 'DJI_20261013121257_0332_D.MP4', track: 'V1', trackLabel: 'V1', kind: 'video',
  start: 0, dur: 9.45945, end: 9.45945, sourceIn: 0, sourceOut: 9.45945, speed: 1, enabled: true,
  gainDb: 0, link: null, effects: [],
}
const CLIP_B = {
  clip: 70, item: 23, name: 'DJI_20261013121345_0333_D.MP4', track: 'V1', trackLabel: 'V1', kind: 'video',
  start: 9.45945, dur: 1.802, end: 11.26145, sourceIn: 0, sourceOut: 1.802, speed: 1, enabled: true,
  gainDb: 0, link: null, effects: [{ effect: 'lumetri', enabled: true, params: { contrast: 27 } }],
}
const SEQUENCE = {
  id: 9, name: '序列 1', duration: 11.26145, frames: 675, width: 3840, height: 2880, fps: 59.94,
  preset: '', sampleRate: 48000, playhead: 0, inPoint: 0, outPoint: 0, markers: 0,
  tracks: { video: [{ id: 'V1', label: 'V1', kind: 'video', enabled: true, muted: false, locked: false, clipCount: 2, items: [CLIP_A, CLIP_B] }], audio: [] },
  clips: [CLIP_A, CLIP_B],
}
function detail() {
  return {
    ok: true, projectId: 'p_test', projectName: '深圳天文台',
    path: PROJECT_PATH, name: '深圳天文台', revision: 12, savedAt: new Date().toISOString(),
    activeSequence: 9,
    sequences: [{ id: 9, name: '序列 1', duration: 11.26145, active: true, clipCount: 2, fps: 59.94, width: 3840, height: 2880, frames: 675 }],
    assets: [],
    sequence: SEQUENCE,
  }
}

const calls = []
const frameCalls = []
const proxyCalls = []
const mergeCalls = []
const RUNNING_JOB = {
  id: 'j_1', kind: 'export', state: 'running',
  createdAt: new Date().toISOString(), startedAt: new Date().toISOString(),
  project: { id: 'p_test', name: '深圳天文台', file: PROJECT_PATH },
  sequence: { id: 9, name: '序列 1', duration: 11.26, fps: 59.94 },
  out: 'D:\\Myfiles\\FilmCraft\\exports\\深圳天文台.mp4',
  display: 'D:\\Myfiles\\FilmCraft\\exports\\深圳天文台.mp4',
  expected: { frames: 675, seconds: 11.26, secPerFrame: 0.7, bytes: 41943040 },
  progress: { bytes: 10485760, elapsedMs: 120000, bytesPerSecond: 87381, framesExpected: 675, ratio: 0.25, etaMs: 360000 },
  error: null,
}

globalThis.fetch = async (path, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null
  calls.push({ path, method: (init && init.method) || 'GET', body })
  if (path.indexOf('/api/media?') >= 0) {
    return { ok: true, status: 200, blob: async () => ({ size: 2048, type: 'image/png' }) }
  }
  let value
  if (path.indexOf('/api/workspace') >= 0) value = WORKSPACE
  else if (path.indexOf('/api/projects') >= 0) {
    value = { ok: true, projects: [{ id: 'p_test', name: '深圳天文台', file: PROJECT_PATH, display: PROJECT_PATH, exists: true, bytes: 145000, savedAt: new Date().toISOString() }] }
  } else if (path.indexOf('/api/project?') >= 0) value = detail()
  else if (path.indexOf('/api/project') >= 0) value = detail()
  else if (path.indexOf('/api/jobs') >= 0) value = { ok: true, jobs: [RUNNING_JOB], calibration: [] }
  else if (path.indexOf('/api/state') >= 0) value = { ok: true, present: false, state: null }
  else if (path.indexOf('/api/edit') >= 0) value = { ok: true, ran: 1, failed: [], snapshot: 'x', detail: detail() }
  else if (path.indexOf('/api/grade') >= 0) value = { ok: true, applied: 1, failed: [], detail: detail() }
  else if (path.indexOf('/api/undo') >= 0) value = Object.assign({ ok: true, detail: detail() })
  else if (path.indexOf('/api/export') >= 0) value = { ok: true, job: RUNNING_JOB }
  else if (path.indexOf('/api/frame') >= 0) {
    frameCalls.push(body)
    value = { ok: true, cached: false, name: 'frame-x.png', seconds: body.seconds, scale: body.scale, bytes: 2048 }
  } else if (path.indexOf('/api/proxy') >= 0) {
    proxyCalls.push(body)
    value = { ok: true, cached: false, name: 'proxy-x.mp4', bytes: 4096, seconds: body.seconds }
  } else if (path.indexOf('/api/browse') >= 0) {
    value = {
      ok: true,
      path: 'D:\\Myfiles\\临时\\tianwentai',
      parent: 'D:\\Myfiles\\临时',
      dirs: [],
      files: [
        { name: 'A.MP4', path: 'D:\\Myfiles\\临时\\tianwentai\\A.MP4', bytes: 1000, savedAt: new Date().toISOString() },
        { name: 'B.MP4', path: 'D:\\Myfiles\\临时\\tianwentai\\B.MP4', bytes: 2000, savedAt: new Date().toISOString() },
      ],
      projects: [],
    }
  } else if (path.indexOf('/api/merge') >= 0) {
    mergeCalls.push(body)
    value = {
      ok: true,
      project: { id: 'p_new', name: '合并工程', file: 'D:\\Myfiles\\FilmCraft\\projects\\合并工程.fcproj' },
      sequence: { id: 10, name: '合并序列' },
      itemIds: [1, 2],
      settings: { width: 3840, height: 2880, fps: 59.94, video: 2, audio: 2 },
      compat: { checked: 2, rows: [], mixedSize: 0, mixedFps: 0, warnings: [] },
      placed: [[11, 12], [13, 14]],
      detail: detail(),
      job: null,
    }
  } else if (path.indexOf('/api/sequence') >= 0) value = { ok: true, sequence: 10, detail: detail() }
  else value = { ok: true }
  return { ok: true, json: async () => value }
}

// ── load / apply ────────────────────────────────────────────────────────────
await import('./dist/native/client.js')
if (loaded === null) { console.log('❌ 未捕获到模块加载'); process.exit(1) }
const mod = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unknown require ' + name)
})
let failed = false
function check(ok, label) {
  console.log((ok ? '   ✓ ' : '   ❌ ') + label)
  if (!ok) failed = true
}
function attempt(label, fn) {
  try { const value = fn(); console.log('✅ ' + label); return value } catch (error) {
    failed = true
    console.log('❌ ' + label + '  →  ' + error.message)
    console.log(error.stack.split('\n').slice(1, 4).join('\n'))
    return currentTree
  }
}

check(typeof mod.apply === 'function', '模块导出 apply（web boot 崩溃的根因）')
check(mod.name === 'filmcraft-progress-client', '插件名 ' + mod.name)

const registrations = []
const slots = {
  inject(name, fn) { try { fn() } catch (error) { console.log('  inject(' + name + ') 抛错: ' + error.message) } return () => { } },
  register(meta, render) { const entry = { meta, render }; registrations.push(entry); return entry },
}
let tabBody = null
const tabs = {
  register(meta) { tabBody = meta; return () => { } },
}
const ctrl = { openTab() { } }
const ctx = {
  get(name) {
    if (name === 'slots') return slots
    if (name === 'sidebarRightTabs') return tabs
    if (name === 'sidebarRight') return ctrl
    return undefined
  },
  slots,
  effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => { } },
  timer: { setTimeout: (f, ms) => setTimeout(f, ms) },
}
attempt('apply(ctx)', () => mod.apply(ctx))
console.log('注册槽位：' + registrations.map((r) => r.meta.name).join(', '))
console.log('样式表 ' + styleTags.length + ' 条，' + styleTags.join('').length + ' 字符\n')

const tab = registrations.find((r) => r.meta.name === 'sidebar.right.pane.tab')
if (!tab) { console.log('❌ 没有注册侧栏标签'); process.exit(1) }

// ── paint ───────────────────────────────────────────────────────────────────
function expand(node, depth) {
  if (depth > 60) throw new Error('渲染过深（可能无限递归）')
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
function textOf(node, out) {
  out = out || []
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const item of node) textOf(item, out); return out }
  if (node.children) for (const child of node.children) textOf(child, out)
  return out
}
function findNodes(node, className, out) {
  out = out || []
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) findNodes(item, className, out); return out }
  const cn = node.props ? node.props.className : null
  if (typeof cn === 'string' && cn.split(' ').indexOf(className) >= 0) out.push(node)
  if (node.children) for (const child of node.children) findNodes(child, className, out)
  return out
}
function findClickable(node, label, out) {
  out = out || []
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) findClickable(item, label, out); return out }
  if (node.children) {
    if (textOf(node).join('').indexOf(label) >= 0 && node.props && typeof node.props.onClick === 'function') out.push(node)
    for (const child of node.children) findClickable(child, label, out)
  }
  return out
}
function findText(node, label) { return textOf(node).join('').indexOf(label) >= 0 }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let currentTree = null
function renderOnce() {
  effectQueue = []
  dirty = false
  const tree = expand(React.createElement(tab.render().type, tab.render().props), 0)
  for (const fn of effectQueue) { try { fn() } catch (error) { console.log('   effect 抛错: ' + error.message) } }
  currentTree = tree
  return tree
}
function paint(label) {
  if (currentTree === null) { console.log('   ' + label + '：首帧'); return renderOnce() }
  if (!dirty) { console.log('   ' + label + '：⚠️ 没有状态变化，不重渲染'); return currentTree }
  return renderOnce()
}

console.log('── 首屏 ──')
let tree = attempt('面板渲染', renderOnce)
await sleep(80)
tree = attempt('数据到达', () => paint('加载完成'))
check(findText(tree, '下载工作区') === false, '没有残留占位文案')
check(findText(tree, '扫描'), '出现「扫描」按钮')
check(findText(tree, '深圳天文台'), '工程列表里出现工程名')
check(findText(tree, '工作区：D:\\Myfiles\\FilmCraft'), '显示工作区路径')
check(styleTags.join('').indexOf('.fc-prev') >= 0, '样式已注入')

console.log('\n── 打开工程 ──')
{
  const rows = findNodes(tree, 'fc-clip').filter((node) => findText(node, '深圳天文台'))
  check(rows.length > 0, '工程行可点击')
  rows[0].props.onClick()
  await sleep(80)
  tree = attempt('重渲染', () => paint('工程已打开'))
  // 0.3.0 起首屏是「项目」页：打开工程后还要切到「剪辑」才看得到时间线。
  const editTab = findClickable(tree, '剪辑')[0]
  check(!!editTab, '有「剪辑」页签')
  if (editTab) editTab.props.onClick()
  await sleep(80)
  tree = attempt('重渲染', () => paint('剪辑页'))
  check(findText(tree, 'DJI_20261013121257'), '片段名出现')
  check(findNodes(tree, 'fc-clip').length >= 2, '片段列表两行')
  check(findText(tree, '3840×2880'), '序列规格显示')
  check(findText(tree, '裁头') && findText(tree, '裁尾'), '裁切控件出现')
  check(findText(tree, '海景') && findText(tree, '中性'), '调色预设来自工作区')
  check(frameCalls.length > 0, '打开工程后自动渲染了画面（' + frameCalls.length + ' 次）')
  check(findNodes(tree, 'fc-prev-i').length === 1, '画面 <img> 已渲染')
}

console.log('\n── 裁头 ──')
{
  const before = calls.length
  findClickable(tree, '+0.5s')[0].props.onClick()
  await sleep(120)
  tree = attempt('重渲染', () => paint('裁头后'))
  const edit = calls.slice(before).filter((call) => call.path.indexOf('/api/edit') >= 0)[0]
  check(!!edit, '发出了 edit.write 请求')
  const command = edit && edit.body && edit.body.commands ? edit.body.commands[0] : null
  check(!!command && command.id === 'timeline.trim', '命令是 timeline.trim（' + (command && command.id) + '）')
  check(!!command && command.params.clip === 69, '命令带上了选中片段')
  check(!!command && command.params.delta === Math.round(0.5 * 254016000000), 'delta 换算成 tick')
}

console.log('\n── 预览片段 ──')
{
  const buttons = findClickable(tree, '生成预览片段')
  check(buttons.length === 1, '有「生成预览片段」按钮')
  buttons[0].props.onClick()
  await sleep(120)
  tree = attempt('重渲染', () => paint('片段就绪'))
  check(proxyCalls.length === 1, '调用了 proxy.write')
  const span = proxyCalls.length ? proxyCalls[0].seconds : 0
  check(span >= 0.5 && span <= 20, '片段长度在 0.5–20 秒（' + span + 's）')
  check(findNodes(tree, 'fc-prev-v').length === 1, '出现 <video> 播放器')
}

console.log('\n── 任务页 ──')
{
  findClickable(tree, '任务')[0].props.onClick()
  await sleep(80)
  tree = attempt('重渲染', () => paint('任务页'))
  check(findText(tree, '导出中'), '显示运行中的任务')
  check(findText(tree, '25%'), '显示 25% 进度')
  check(findText(tree, '剩余 6m00s'), '显示预计剩余')
  check(findNodes(tree, 'fc-prog-fill').length >= 1, '进度条已渲染')
  check(findText(tree, '取消'), '有取消按钮')
}

console.log('\n── 导出 ──')
{
  findClickable(tree, '剪辑')[0].props.onClick()
  await sleep(60)
  tree = attempt('重渲染', () => paint('回到剪辑页'))
  const before = calls.length
  const buttons = findClickable(tree, '导出当前序列')
  check(buttons.length === 1, '有「导出当前序列」按钮')
  buttons[0].props.onClick()
  await sleep(140)
  tree = attempt('重渲染', () => paint('导出后'))
  const exported = calls.slice(before).filter((call) => call.path.indexOf('/api/export') >= 0)[0]
  check(!!exported, '发出了 export.write 请求')
  check(!!exported && exported.body.sequence === 9, '导出带上序列 id')
  check(!!exported && exported.body.format === 'h264' && exported.body.scale === 1, '默认格式 h264 / 100%')
}

console.log('\n── 合并页 ──')
{
  const mergeTab = findClickable(tree, '合并')[0]
  check(!!mergeTab, '有「合并」页签')
  if (mergeTab) mergeTab.props.onClick()
  await sleep(80)
  tree = attempt('重渲染', () => paint('合并页'))
  check(findText(tree, '待合并'), '有「待合并」分区')
  check(findText(tree, '开始合并'), '有「开始合并」按钮')

  const browseBtn = findClickable(tree, '浏览目录')[0]
  check(!!browseBtn, '有「浏览目录」按钮')
  if (browseBtn) browseBtn.props.onClick()
  await sleep(80)
  tree = attempt('重渲染', () => paint('目录已读取'))
  check(findText(tree, 'A.MP4'), '目录里出现素材')

  const pickA = findNodes(tree, 'fc-clip').filter((node) => findText(node, 'A.MP4'))[0]
  const pickB = findNodes(tree, 'fc-clip').filter((node) => findText(node, 'B.MP4'))[0]
  check(!!pickA && !!pickB, '素材行可点击')
  if (pickB) pickB.props.onClick()
  await sleep(40)
  tree = attempt('重渲染', () => paint('加入 1 段'))
  if (pickA) findNodes(tree, 'fc-clip').filter((node) => findText(node, 'A.MP4'))[0].props.onClick()
  await sleep(40)
  tree = attempt('重渲染', () => paint('加入 2 段'))
  check(findText(tree, '待合并 (2)'), '待合并计数到 2')

  const goBtn = findClickable(tree, '开始合并')[0]
  if (goBtn) goBtn.props.onClick()
  await sleep(120)
  tree = attempt('重渲染', () => paint('合并完成'))
  check(mergeCalls.length === 1, '发出了 merge.write 请求')
  const sent = mergeCalls[0] || {}
  check(Array.isArray(sent.sources) && sent.sources.length === 2, '带了 2 个 sources')
  // 先点 B、再点 A —— 顺序必须按用户点的顺序保留，不能被目录顺序覆盖
  check(!!sent.sources && sent.sources[0] && /B\.MP4$/.test(sent.sources[0].file), '顺序是 B 在前（按加入顺序，不是目录顺序）')
  check(findText(tree, '合并工程'), '结果里显示新工程名')
}

console.log('\n── 设置页 ──')
{
  const settingsTab = findClickable(tree, '设置')[0]
  check(!!settingsTab, '有「设置」页签')
  if (settingsTab) settingsTab.props.onClick()
  await sleep(60)
  tree = attempt('重渲染', () => paint('设置页'))
  check(findText(tree, '工作区'), '显示工作区分区')
  check(findText(tree, '调色预设'), '显示调色预设分区')
  check(findText(tree, '内置'), '内置预设带标记')
  check(findNodes(tree, 'fc-clip').length >= 2, '预设列表有内容')
  if (findClickable(tree, '剪辑')[0]) findClickable(tree, '剪辑')[0].props.onClick()
  await sleep(60)
  tree = attempt('重渲染', () => paint('回到剪辑页'))
}

console.log('\n── 面板自身滚动 ──')
{
  const wrap = findNodes(tree, 'fc-wrap')[0]
  check(!!wrap && !!wrap.props.style && wrap.props.style.overflowY === 'auto', '面板可纵向滚动')
  check(!!wrap && wrap.props.style.maxHeight === '780px', '高度 = 视口 1000 − 起点 210 − 10')
  mockTop = 100
  winListeners.resize()
  await sleep(40)
  tree = attempt('重渲染', () => paint('布局变化'))
  check(findNodes(tree, 'fc-wrap')[0].props.style.maxHeight === '890px', '重新测量后 890px')
  mockTop = 210
  winListeners.resize()
  await sleep(40)
  attempt('重渲染', () => paint('复位'))
}

console.log('\n── 已发出的请求 ──')
for (const call of calls) {
  console.log('   ' + call.method.padEnd(5) + call.path.replace('/dsh-filmcraft-progress', '') +
    (call.body ? '  ' + JSON.stringify(call.body).slice(0, 90) : ''))
}

console.log('\n' + (failed ? '❌ 有失败项' : '✅ 全部通过'))
process.exit(failed ? 1 : 0)
