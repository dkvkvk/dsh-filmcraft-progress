// End-to-end test of dist/mcp/filmcraft-mcp.mjs over real stdio JSON-RPC.
//
//   node test/mcp-smoke.mjs                 # against test/mock-filmcraft-cli.mjs (any OS)
//   FILMCRAFT_CLI="C:\Program Files\FilmCraft\filmcraft-cli.exe" node test/mcp-smoke.mjs --real <media1> <media2> ...
//
// The mock run proves the MCP layer: protocol, ticks/timecode, path guard,
// locking, snapshots, atomic rollback, diffs, jobs. It cannot prove the real
// engine accepts each parameter shape — that is what --real is for.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRealFixtures } from './make-real-fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const real = process.argv.includes('--real')
const keep = process.argv.includes('--keep')
const suppliedFiles = real ? process.argv.slice(process.argv.indexOf('--real') + 1).filter((arg) => arg !== '--keep') : []
if (suppliedFiles.length > 0 && suppliedFiles.length < 3) {
  console.error('真实剪辑验证至少需要三段视频；省略视频路径即可自动生成测试素材。')
  process.exit(2)
}
const generatedFixtures = real && suppliedFiles.length === 0
const tmp = mkdtempSync(join(tmpdir(), 'fcmcp-'))
const ws = join(tmp, 'ws').replace(/\\/g, '/')
const mediaDir = join(ws, 'media').replace(/\\/g, '/')
mkdirSync(mediaDir, { recursive: true })
let files
if (real) {
  files = suppliedFiles
  if (files.length === 0) files = makeRealFixtures(mediaDir)
}
else {
  files = [['a.mp4', 4], ['b.mp4', 6], ['c.mp4', 3]].map(([name, duration]) => {
    const p = mediaDir + '/' + name
    writeFileSync(p, JSON.stringify({ duration, width: name === 'c.mp4' ? 3840 : 1920, height: name === 'c.mp4' ? 2160 : 1080, fps: 25 }))
    return p
  })
}
const env = Object.assign({}, process.env, { HOME: tmp, USERPROFILE: tmp, FILMCRAFT_WORKSPACE: ws })
if (!real) env.FILMCRAFT_CLI = join(here, 'mock-filmcraft-cli.mjs')
else env.FILMCRAFT_MCP_ROOTS = [...new Set(files.map((f) => dirname(f)))].join(';')

const server = spawn(process.execPath, [join(here, '..', 'dist', 'mcp', 'filmcraft-mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''
server.stderr.on('data', (d) => { stderr += d })
let buf = ''
const waiting = new Map()
server.on('error', (error) => {
  for (const request of waiting.values()) request.reject(error)
  waiting.clear()
})
server.on('close', (code) => {
  for (const request of waiting.values()) request.reject(new Error('MCP exited (' + code + '): ' + stderr))
  waiting.clear()
})
server.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    const msg = JSON.parse(line)
    const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w.resolve(msg) }
  }
})
let nextId = 1
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(method + ' timed out\n' + stderr)) }, real ? 180000 : 15000)
  waiting.set(id, {
    resolve: (value) => { clearTimeout(timer); resolve(value) },
    reject: (error) => { clearTimeout(timer); reject(error) },
  })
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const call = async (name, args) => {
  const msg = await rpc('tools/call', { name, arguments: args || {} })
  if (msg.error) throw new Error(name + ' rpc error ' + msg.error.message)
  return { value: JSON.parse(msg.result.content[0].text), isError: msg.result.isError, content: msg.result.content }
}
let passed = 0
const ok = (cond, label, extra) => {
  if (!cond) throw new Error(label + (extra === undefined ? '' : '\n' + JSON.stringify(extra, null, 2).slice(0, 3000)))
  passed += 1; console.log('✔ ' + label)
}
const V1 = (tl) => tl.active.tracks.find((t) => t.track === 'V1').clips

try {
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
ok(init.result.protocolVersion === '2025-06-18' && init.result.capabilities.tools, 'initialize')
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const list = await rpc('tools/list', {})
ok(list.result.tools.length >= 20 && list.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'), 'tools/list ' + list.result.tools.length + ' tools')

let r = await call('filmcraft_status')
ok(r.value.cli.exists === true, 'status: cli found')

r = await call('filmcraft_assemble', { create: { name: 'smoke' }, sources: files.map((file) => ({ file })), name: '粗剪' })
ok(!r.isError && r.value.project.id, 'assemble: new project + sequence', r.value)
const project = r.value.project.id
ok(r.value.compat.checked === files.length && (!real || generatedFixtures ? r.value.compat.mixedSize === 1 : true), 'assemble: mixed size warning', r.value.compat)

r = await call('filmcraft_get_timeline', { project, include_assets: true })
let clips = V1(r.value)
ok(clips.length === files.length, 'timeline: ' + clips.length + ' clips on V1')
const fps = r.value.active.fps
ok(typeof clips[1].startTc === 'string' && clips[1].durationFrames > 0, 'timeline: timecode + frames', clips[1])
const total0 = r.value.active.duration
const sequenceId = r.value.active.id
r = await call('filmcraft_edit_timeline', { project, sequence: sequenceId, operation: 'caption', text: 'MCP 字幕验证', start: '0f', end: '25f', dry_run: true })
ok(r.value.dryRun && r.value.planned.some((step) => step.id === 'captions.add'), 'workflow: subtitle dry run')
r = await call('filmcraft_edit_timeline', { project, sequence: sequenceId, operation: 'caption', text: 'MCP 字幕验证', start: '0f', end: '25f' })
ok(r.value.ok && r.value.changes.captions.after[0].items[0].text === 'MCP 字幕验证', 'workflow: subtitle diff returned', r.value)
r = await call('filmcraft_get_timeline', { project })
ok(r.value.active.captionTracks[0].items[0].end === 1, 'workflow: subtitles readable through MCP')
r = await call('filmcraft_undo', { project })
ok(r.value.ok && r.value.changes.captions.after.length === 0, 'workflow: subtitle undo')

r = await call('filmcraft_trim', { project, clip: clips[0].clip, edge: 'in', delta: '00:00:01:00', dry_run: true })
ok(r.value.dryRun && r.value.planned[0].params.delta === 254016000000, 'trim dry_run: timecode → ticks', r.value)
r = await call('filmcraft_get_timeline', { project })
ok(r.value.active.duration === total0, 'dry_run did not write')

r = await call('filmcraft_trim', { project, clip: clips[0].clip, edge: 'in', delta: 1.013 })
ok(r.value.ok && r.value.changes.changed.some((c) => c.clip === clips[0].clip), 'trim: applied with diff', r.value)
ok(Math.abs(r.value.changes.durationAfter - (total0 - 1)) < 1e-6 + 0.5 / fps, 'trim: snapped to frame + rippled', r.value.changes)

r = await call('filmcraft_trim', { project, clip: clips[2].clip, edge: 'out', delta: 99 })
ok(r.isError && /消失/.test(r.value.error), 'trim: refuses to erase clip')

r = await call('filmcraft_get_timeline', { project }); clips = V1(r.value)
const order = clips.map((c) => c.clip).reverse()
r = await call('filmcraft_reorder', { project, order })
ok(r.value.ok, 'reorder: applied', r.value)
r = await call('filmcraft_get_timeline', { project }); clips = V1(r.value)
ok(JSON.stringify(clips.map((c) => c.clip)) === JSON.stringify(order), 'reorder: order matches')
r = await call('filmcraft_check_timeline', { project })
ok(!r.value.issues.some((i) => i.code === 'gap' || i.code === 'overlap' || i.code === 'link-desync'), 'check: no gap/overlap/desync after reorder', r.value)

// atomic rollback: second command fails → first must be undone
const before = (await call('filmcraft_get_timeline', { project })).value
r = await call('filmcraft_apply', { project, commands: [{ id: 'effects.apply', params: { clips: [clips[0].clip], effect: 'lumetri' } }, { id: 'effects.setParam', params: { clip: clips[0].clip, effect: 'lumetri', param: 'bogus', value: 1 } }] })
ok(r.value.ok === false && r.value.rolledBack === true, 'apply: failure rolls back', r.value)
const after = (await call('filmcraft_get_timeline', { project })).value
ok(JSON.stringify(V1(after).map((c) => c.effects)) === JSON.stringify(V1(before).map((c) => c.effects)), 'apply: timeline unchanged after rollback')
r = await call('filmcraft_apply', { project, commands: [{ id: 'file.exportInterchange', params: {} }, { id: 'system.shell', params: {} }] })
ok(r.isError && /不允许/.test(r.value.error), 'apply: whitelist enforced')

r = await call('filmcraft_describe_commands', { prefix: 'timeline.razor' })
ok(r.value.commands.length === 1 || real, 'describe_commands: razor schema from CLI', r.value)
if (!real) {
  const target = clips[0]
  const cutTicks = Math.round((target.start + 1) * 254016000000)
  r = await call('filmcraft_apply', { project, commands: [{ id: 'timeline.razor', params: { clip: target.clip, time: cutTicks } }] })
  ok(r.value.ok && r.value.changes.added.length === 1, 'apply: razor split via generic path', r.value)
}

r = await call('filmcraft_set_enabled', { project, clips: [clips[1].clip], enabled: false })
ok(r.value.ok && r.value.changes.changed[0].enabled[1] === false, 'set_enabled: disabled', r.value)
r = await call('filmcraft_set_enabled', { project, clips: [clips[1].clip], enabled: false })
ok(r.isError, 'set_enabled: idempotent refusal')

const ungraded = (await call('filmcraft_get_timeline', { project })).value
r = await call('filmcraft_grade', { project, preset: 'warm' })
ok(r.value.ok && r.value.failed.length === 0, 'grade: all video clips', r.value)
r = await call('filmcraft_get_timeline', { project })
ok(V1(r.value).every((clip) => clip.effects.includes('lumetri')), 'grade: effect present on every video clip')

r = await call('filmcraft_grade', { project, clear: true })
ok(r.value.ok && r.value.failed.length === 0, 'grade clear: commands accepted', r.value)
r = await call('filmcraft_get_timeline', { project })
ok(V1(r.value).every((clip) => !clip.effects.includes('lumetri')), 'grade clear: color effect actually removed', V1(r.value).map((clip) => clip.effects))
ok(JSON.stringify(V1(r.value).map((clip) => clip.effects)) === JSON.stringify(V1(ungraded).map((clip) => clip.effects)), 'grade clear: original effects preserved')
r = await call('filmcraft_undo', { project })
ok(r.value.ok, 'undo: restores cleared grade')

r = await call('filmcraft_undo', { project })
ok(r.value.ok && r.value.changes.changed.length > 0, 'undo: reverts grade', r.value)

r = await call('filmcraft_delete_clips', { project, clips: [clips[1].clip] })
ok(r.value.ok && r.value.changes.removed.length >= 1, 'delete: ripple delete', r.value.changes)

r = await call('filmcraft_preview_frame', { project, clip: clips[0].clip })
ok(r.value.ok && r.content.some((c) => c.type === 'image' && c.data.length > 10), 'preview_frame: image returned')
r = await call('filmcraft_storyboard', { project, max: 4 })
ok(r.value.ok && r.content.filter((c) => c.type === 'image').length === r.value.shown, 'storyboard: ' + r.value.shown + ' frames')

r = await call('filmcraft_export', { project, out: tmp + '/outside.mp4' })
ok(r.isError && /不在允许的目录内/.test(r.value.error), 'export: path guard')
r = await call('filmcraft_browse_media', { dir: ws + '/../../' })
ok(r.isError, 'browse: traversal blocked')

r = await call('filmcraft_export', { project, scale: 0.25 })
ok(r.value.ok && r.value.job.state === 'running', 'export: job started')
const jobId = r.value.job.id
r = await call('filmcraft_export', { project })
ok(r.isError && /串行/.test(r.value.error), 'export: serial guard')
let state = 'running'
for (let i = 0; i < 60 && state === 'running'; i += 1) {
  await new Promise((res) => setTimeout(res, 500))
  state = (await call('filmcraft_jobs', { action: 'get', id: jobId })).value.job.state
}
ok(state === 'done', 'export: job done')
if (real) {
  const job = (await call('filmcraft_jobs', { action: 'get', id: jobId })).value.job
  const probe = spawnSync(env.FILMCRAFT_CLI || 'C:/Program Files/FilmCraft/filmcraft-cli.exe', ['probe', job.out], { encoding: 'utf8', windowsHide: true })
  ok(probe.status === 0, 'export: real MP4 decodes', probe.stderr)
  const media = JSON.parse(probe.stdout)
  const timeline = (await call('filmcraft_get_timeline', { project })).value
  ok(Math.abs(media.duration / 254016000000 - timeline.active.duration) <= 1 / fps, 'export: duration matches edited timeline', media)
  ok(media.audio_streams.length > 0, 'export: audio track present')
}

r = await call('filmcraft_export_interchange', { project, format: 'edl' })
ok(r.value.ok && r.value.bytes > 0, 'interchange: EDL written')

r = await call('filmcraft_check_timeline', { project })
ok(typeof r.value.counts === 'object', 'check: report ' + JSON.stringify(r.value.counts))

// another live process holds the project lock → edits must wait, reads still work
{
  const { createHash } = await import('node:crypto')
  const tl = (await call('filmcraft_get_timeline', { project })).value
  const file = tl.project.path.replace(/\\/g, '/')
  let h = 0x811c9dc5
  for (const ch of file.toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  const lock = ws + '/work/locks/' + h.toString(16).padStart(8, '0') + '.lock'
  mkdirSync(ws + '/work/locks', { recursive: true })
  writeFileSync(lock, JSON.stringify({ pid: process.pid, owner: 'panel', at: new Date().toISOString() }))
  const clip = V1(tl)[0].clip
  r = await call('filmcraft_set_enabled', { project, clips: [clip], enabled: false })
  ok(r.isError && /占用/.test(r.value.error), 'lock: edit refused while panel holds lock', r.value)
  r = await call('filmcraft_check_timeline', { project })
  ok(!r.isError, 'lock: reads unaffected')
  writeFileSync(lock, JSON.stringify({ pid: 999999, owner: 'panel', at: new Date().toISOString() }))
  r = await call('filmcraft_set_enabled', { project, clips: [clip], enabled: false })
  ok(!r.isError && r.value.ok, 'lock: stale lock (dead pid) taken over', r.value)
}

const locks = existsSync(ws + '/work/locks') ? readdirSync(ws + '/work/locks') : []
ok(locks.length === 0, 'locks released')

console.log('\n✅ MCP smoke: ' + passed + ' checks passed' + (real ? ' (REAL engine)' : ' (mock engine)'))
} catch (error) {
  console.error('❌ ' + error.message + '\n' + stderr)
  process.exitCode = 1
} finally {
  const closed = new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve()
    const timer = setTimeout(() => server.kill(), 2000)
    server.once('close', () => { clearTimeout(timer); resolve() })
  })
  server.stdin.end()
  await closed
  if (keep) console.log('Test workspace: ' + tmp)
  else rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
}
