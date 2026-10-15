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

async function call(path, body, method) {
  const route = routes.get(path)
  if (route === undefined) throw new Error('没有路由 ' + path)
  const verb = method || (body === undefined ? 'GET' : 'POST')
  return await new Promise((resolve, reject) => {
    const handlers = {}
    const req = {
      method: verb,
      on(event, fn) { handlers[event] = fn; return req },
      destroy() { },
    }
    const res = {
      code: 0,
      writeHead(code) { this.code = code },
      end(text) {
        let parsed = text
        try { parsed = JSON.parse(text) } catch (_) { }
        resolve({ code: this.code, body: parsed })
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

// 9. progress state still works
const state = await call('/dsh-filmcraft-progress/api/state')
console.log('GET /state → ok=' + state.body.ok + ' mode=' + state.body.mode + ' phase=' + state.body.phase + ' project=' + state.body.project)

console.log('\n工具 filmcraft_edit 的 action 校验：')
try { await tools[1].execute({ action: 'nope' }) } catch (e) { console.log('  ' + e.message) }

for (const d of disposers) { try { d() } catch (_) { } }
// Remove the test project AND the undo snapshots it produced — otherwise the
// project picker keeps listing our own backups.
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
  console.log('\n完成（测试工程已删除，清理快照 ' + cleaned + ' 个）')
}
