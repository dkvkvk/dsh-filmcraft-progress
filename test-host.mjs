// Exercise the built host plugin without DSH: mock the context, capture the
// registered routes, then call them the way the client would.
import { apply } from './dist/native/index.js'
import { copyFileSync, existsSync } from 'node:fs'

const routes = new Map()
const tools = []
const disposers = []

const ctx = {
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  webServer: {
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
  },
  tools: { register(tool) { tools.push(tool); return () => { } } },
}

apply(ctx)

console.log('注册路由 ' + routes.size + ' 条：')
for (const [path, route] of routes) console.log('  ' + path)
console.log('注册工具 ' + tools.length + ' 个：' + tools.map(t => t.name).join(', '))
console.log('')

// `opts.query` appends a query string; `opts.headers` are request headers.
// Binary responses come back as `raw` (Buffer) with `body` left unparsed.
async function call(path, body, method, opts) {
  const route = routes.get(path)
  if (route === undefined) throw new Error('没有路由 ' + path)
  const verb = method || (body === undefined ? 'GET' : 'POST')
  const extra = opts || {}
  return await new Promise((resolve, reject) => {
    const handlers = {}
    const req = {
      method: verb,
      url: path + (extra.query ? '?' + extra.query : ''),
      headers: extra.headers || {},
      on(event, fn) { handlers[event] = fn; return req },
      destroy() { },
    }
    const res = {
      code: 0,
      headers: {},
      writeHead(code, h) { this.code = code; if (h) Object.assign(this.headers, h) },
      end(text) {
        const isBuffer = Buffer.isBuffer(text)
        let parsed = text
        if (!isBuffer) { try { parsed = JSON.parse(text) } catch (_) { } }
        resolve({ code: this.code, headers: this.headers, body: parsed, raw: isBuffer ? text : null })
      },
    }
    // Fire data then end once the handler has registered both listeners.
    queueMicrotask(() => {
      try {
        if (body !== undefined && typeof handlers.data === 'function') {
          handlers.data(Buffer.from(JSON.stringify(body)))
        }
        if (typeof handlers.end === 'function') handlers.end()
      } catch (error) { reject(error) }
    })
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

const show = (label, v, keep) => {
  const text = JSON.stringify(v, null, 2)
  const lines = text.split('\n')
  console.log('── ' + label + ' ──')
  console.log(lines.slice(0, keep || 18).join('\n'))
  if (lines.length > (keep || 18)) console.log('  … 共 ' + lines.length + ' 行')
  console.log('')
}

// 1. list projects
const projects = await call('/dsh-filmcraft-progress/api/projects')
show('GET /projects  → ' + (projects.body.projects || []).length + ' 个工程', {
  ok: projects.body.ok, roots: projects.body.roots,
  first3: (projects.body.projects || []).slice(0, 3).map(p => p.name + '  ' + Math.round(p.size / 1024) + 'KB'),
})

// 2. open a project
const src = 'D:\\Myfiles\\临时\\build\\final.fcproj'
const test = 'D:\\Myfiles\\临时\\build\\panel-test.fcproj'
copyFileSync(src, test)
const opened = await call('/dsh-filmcraft-progress/api/open', { path: test })
const b = opened.body
if (!b.ok) {
  console.log('❌ /open 失败：' + JSON.stringify(b))
  console.log('   测试工程存在：' + existsSync(test))
  process.exit(1)
}
show('POST /open', {
  ok: b.ok, name: b.name, fps: b.fps, size: b.width + 'x' + b.height,
  duration: Math.round(b.duration) + 's', clipCount: b.clipCount,
  clip0: b.clips && b.clips[0],
}, 26)

// 3. apply a harmless edit (select only) — must not damage the project
const applied = await call('/dsh-filmcraft-progress/api/apply', {
  project: test,
  commands: [{ id: 'timeline.select', params: { clips: [b.clips[0].clip] } }],
})
show('POST /apply (timeline.select)', applied.body, 12)

// 4. whitelist must reject a non-editing command
const blocked = await call('/dsh-filmcraft-progress/api/apply', {
  project: test,
  commands: [{ id: 'file.quit', params: {} }],
})
show('POST /apply (被白名单拒绝的 file.quit)', blocked.body, 8)

// 5. a real edit must persist: ripple-trim 1s off the head, then re-open
const TICKS = 254016000000
const before = (await call('/dsh-filmcraft-progress/api/open', { path: test })).body
const trimmed = await call('/dsh-filmcraft-progress/api/apply', {
  project: test,
  commands: [{ id: 'timeline.trim', params: { clip: before.clips[0].clip, edge: 'in', mode: 'ripple', delta: TICKS } }],
})
const after = (await call('/dsh-filmcraft-progress/api/open', { path: test })).body
console.log('── 真实编辑往返：首段头部裁掉 1 秒 ──')
console.log('  apply ok=' + trimmed.body.ok + ' applied=' + trimmed.body.applied + ' failed=' + trimmed.body.failed)
console.log('  第 1 段时长  ' + before.clips[0].dur.toFixed(3) + 's  →  ' + after.clips[0].dur.toFixed(3) + 's')
console.log('  序列总时长   ' + before.duration.toFixed(3) + 's  →  ' + after.duration.toFixed(3) + 's')
console.log('  源入点       ' + before.clips[0].sourceIn.toFixed(3) + 's  →  ' + after.clips[0].sourceIn.toFixed(3) + 's')
const okTrim = Math.abs((before.clips[0].dur - after.clips[0].dur) - 1) < 0.05
console.log('  ' + (okTrim ? '✅ 裁剪已生效并写入工程' : '❌ 裁剪未生效'))
console.log('')

// 6. undo must restore it (snapshot-based: the CLI's own undo stack dies with
//    the process, so the plugin restores a copy taken before the change)
const undone = await call('/dsh-filmcraft-progress/api/undo', { project: test })
const restored = (await call('/dsh-filmcraft-progress/api/open', { path: test })).body
console.log('── 撤销（快照还原）──')
console.log('  ok=' + undone.body.ok + '  ' + JSON.stringify(undone.body).slice(0, 120))
console.log('  时长 ' + after.clips[0].dur.toFixed(3) + 's → ' + restored.clips[0].dur.toFixed(3) + 's  ' +
  (Math.abs(restored.clips[0].dur - before.clips[0].dur) < 0.05 ? '✅ 已还原到改动前' : '❌ 未还原'))
console.log('')

// 7. guards
for (const [label, body] of [
  ['非 .fcproj 路径', { project: 'C:\\Windows\\system32\\cmd.exe', commands: [{ id: 'edit.undo', params: {} }] }],
  ['空操作列表', { project: test, commands: [] }],
  ['越权命令', { project: test, commands: [{ id: 'file.quit', params: {} }] }],
]) {
  const r = await call('/dsh-filmcraft-progress/api/apply', body)
  console.log('  ' + label.padEnd(16) + '→ code ' + r.code + '  ' + (r.body.error || JSON.stringify(r.body).slice(0, 90)))
}
console.log('')

// 8. method guard
const wrong = await call('/dsh-filmcraft-progress/api/open', undefined, 'GET')
console.log('GET /open（应 405）→ code ' + wrong.code + '  ' + JSON.stringify(wrong.body))

console.log('\n工具 filmcraft_edit 的 action 校验：')
try { await tools[1].execute({ action: 'nope' }) } catch (e) { console.log('  ' + e.message) }

// 10. preview — render one graded frame to a still
console.log('\n── 预览 ──')
const created = []
const frame = await call('/dsh-filmcraft-progress/api/frame', { project: test, seconds: 3, scale: 0.25 })
if (frame.body && frame.body.name) created.push(frame.body.name)
console.log('POST /frame → code ' + frame.code + '  ' + JSON.stringify({
  ok: frame.body.ok, cached: frame.body.cached, scale: frame.body.scale,
  bytes: frame.body.bytes, ms: frame.body.ms,
}))
const frameOk = frame.body.ok === true && frame.body.bytes > 1000
console.log('  ' + (frameOk ? '✅ 已渲染 ' + Math.round(frame.body.bytes / 1024) + 'KB 画面' : '❌ 渲染失败：' + frame.body.error))

// 11. serve it back as binary
const img = await call('/dsh-filmcraft-progress/api/media', undefined, 'GET', { query: 'name=' + frame.body.name })
const magic = img.raw ? img.raw.subarray(0, 4).toString('hex') : ''
const pngOk = img.raw !== null && magic === '89504e47'
console.log('GET /media → code ' + img.code + '  ' + img.headers['content-type'] + '  ' +
  (img.raw ? img.raw.length + ' B' : '—') + '  accept-ranges=' + img.headers['accept-ranges'])
console.log('  ' + (pngOk ? '✅ PNG 魔数正确（89504e47）' : '❌ 魔数 ' + magic) +
  '  声明类型与实际一致：' + (img.headers['content-type'] === 'image/png' ? '✅' : '❌ ' + img.headers['content-type']))

// 12. the cache must be hit on a repeat request
const again = await call('/dsh-filmcraft-progress/api/frame', { project: test, seconds: 3, scale: 0.25 })
console.log('重复请求 → cached=' + again.body.cached + '  ' + (again.body.cached === true ? '✅ 命中缓存' : '❌ 未命中'))

// 13. media guards
for (const [label, query, want] of [
  ['路径穿越', 'name=..%2F..%2Ffilm-status.json', 400],
  ['绝对路径', 'name=C%3A%5CWindows%5Cwin.ini', 400],
  ['带分隔符', 'name=sub%2Ff.jpg', 400],
  ['不存在的文件', 'name=f_deadbeefdeadbeef.jpg', 404],
]) {
  const r = await call('/dsh-filmcraft-progress/api/media', undefined, 'GET', { query })
  console.log('  ' + label.padEnd(12) + '→ code ' + r.code + '  ' +
    (r.code === want ? '✅' : '❌ 期望 ' + want) + '  ' + (r.body && r.body.error ? r.body.error : ''))
}

// 14. Range must work, or <video> cannot seek
const ranged = await call('/dsh-filmcraft-progress/api/media', undefined, 'GET', {
  query: 'name=' + frame.body.name, headers: { range: 'bytes=0-99' },
})
console.log('Range bytes=0-99 → code ' + ranged.code + '  ' + ranged.headers['content-range'] +
  '  ' + (ranged.raw ? ranged.raw.length + ' B' : '—') +
  '  ' + (ranged.code === 206 && ranged.raw.length === 100 ? '✅ 支持分段' : '❌'))

// 15. proxy clip
const proxy = await call('/dsh-filmcraft-progress/api/proxy', { project: test, start: 0, end: 1, scale: 0.25, quality: 60 })
if (proxy.body && proxy.body.name) created.push(proxy.body.name)
console.log('POST /proxy (1s) → code ' + proxy.code + '  ' + JSON.stringify({
  ok: proxy.body.ok, cached: proxy.body.cached, bytes: proxy.body.bytes, ms: proxy.body.ms,
}))
if (proxy.body.ok) {
  const vid = await call('/dsh-filmcraft-progress/api/media', undefined, 'GET', { query: 'name=' + proxy.body.name })
  const ftyp = vid.raw ? vid.raw.subarray(4, 8).toString('ascii') : ''
  console.log('  回读 ' + Math.round(vid.raw.length / 1024) + 'KB  ' + vid.headers['content-type'] +
    '  ftyp=' + ftyp + '  ' + (ftyp === 'ftyp' ? '✅ 合法 MP4' : '❌'))
}

// 16. proxy guards
for (const [label, body, want] of [
  ['超长片段', { project: test, start: 0, end: 999, scale: 0.25 }, 500],
  ['结束早于起始', { project: test, start: 5, end: 2, scale: 0.25 }, 500],
  ['非工程路径', { project: 'C:\\Windows\\win.ini', start: 0, end: 1 }, 500],
]) {
  const r = await call('/dsh-filmcraft-progress/api/proxy', body)
  console.log('  ' + label.padEnd(12) + '→ code ' + r.code + '  ' + (r.code === want ? '✅' : '❌ 期望 ' + want) +
    '  ' + (r.body && r.body.error ? String(r.body.error).slice(0, 60) : ''))
}

// 17. progress state still works, and a paused job must not claim 99.9%
const state = await call('/dsh-filmcraft-progress/api/state')
console.log('\nGET /state → ok=' + state.body.ok + ' mode=' + state.body.mode + ' phase=' + state.body.phase +
  ' percent=' + state.body.percent + ' (' + state.body.percentBasis + ')')
console.log('  ' + (state.body.percent === null || state.body.percent < 50
  ? '✅ 已暂停的任务不再显示接近 100%'
  : '❌ 暂停任务仍报 ' + state.body.percent + '%'))

for (const d of disposers) { try { d() } catch (_) { } }
// Remove the test project, the undo snapshots it produced, and the preview
// stills/clips it rendered — otherwise the picker lists our own backups and the
// preview cache keeps files keyed to a project that no longer exists.
{
  const { rmSync, readdirSync } = await import('node:fs')
  if (existsSync(test)) rmSync(test, { force: true })
  const snapDir = 'D:\\Myfiles\\临时\\build\\snapshots'
  let cleaned = 0
  try {
    for (const n of readdirSync(snapDir)) {
      if (n.indexOf('panel-test.fcproj.') >= 0) { rmSync(snapDir + '\\' + n, { force: true }); cleaned++ }
    }
  } catch (_) { }
  let previews = 0
  const previewDir = 'D:\\Myfiles\\临时\\build\\preview'
  try {
    for (const n of readdirSync(previewDir)) {
      if (created.indexOf(n) >= 0) { rmSync(previewDir + '\\' + n, { force: true }); previews++ }
    }
  } catch (_) { }
  console.log('\n完成（测试工程已删除，清理快照 ' + cleaned + ' 个、预览 ' + previews + ' 个）')
}
