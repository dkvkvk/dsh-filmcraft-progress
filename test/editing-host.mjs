// Drives the built host's HTTP handlers in an isolated, automatically cleaned
// workspace. --real uses generated AVI+PCM fixtures and the installed engine.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { makeRealFixtures } from './make-real-fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const real = process.argv.includes('--real')
if (!process.argv.includes('--child')) {
  const tmp = mkdtempSync(join(tmpdir(), 'filmcraft-edit-'))
  try {
    const media = join(tmp, 'media'); mkdirSync(media)
    const files = real ? makeRealFixtures(media) : [4, 6, 3].map((duration, i) => {
      const file = join(media, '片段 ' + i + '.mp4')
      writeFileSync(file, JSON.stringify({ duration, width: 320, height: 180, fps: 25, audio: true }))
      return file
    })
    const cli = real ? process.env.FILMCRAFT_CLI || 'C:/Program Files/FilmCraft/filmcraft-cli.exe' : join(here, 'mock-filmcraft-cli.mjs')
    const configDir = join(tmp, '.dsh', 'filmcraft-progress'); mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ root: join(tmp, 'ws'), cliPath: cli }))
    writeFileSync(join(tmp, 'files.json'), JSON.stringify(files))
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', ...(real ? ['--real'] : [])], {
      env: { ...process.env, USERPROFILE: tmp, HOME: tmp, FILMCRAFT_EDITING_TEST_ROOT: tmp, FILMCRAFT_EDITING_CLI: cli }, stdio: 'inherit', windowsHide: true, timeout: 180000,
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    if (process.argv.includes('--keep')) console.log('Editing test workspace: ' + tmp)
    else {
      assert.equal(dirname(resolve(tmp)), resolve(tmpdir()))
      assert.ok(resolve(tmp).startsWith(join(resolve(tmpdir()), 'filmcraft-edit-')))
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
    }
  }
} else {
  const root = process.env.FILMCRAFT_EDITING_TEST_ROOT
  const files = JSON.parse(readFileSync(join(root, 'files.json')))
  const routes = new Map()
  const ctx = { effect: (fn) => fn(), webServer: { register(route) { routes.set(route.path, route); return () => {} } }, tools: { register: (tool) => tool } }
  const plugin = await import('../dist/native/index.js'); plugin.apply(ctx)
  let checks = 0
  function check(condition, message) { assert.ok(condition, message); checks++; console.log('✔ ' + message) }
  async function request(path, body, method = 'POST', fail = false) {
    const req = new EventEmitter(); req.method = method; req.headers = {}; req.url = '/dsh-filmcraft-progress/api/' + path
    if (method === 'GET') req.url += '?' + new URLSearchParams(body)
    const res = { code: 0, text: '', writeHead(code) { this.code = code }, end(value) { this.text = String(value || '') } }
    setTimeout(() => { if (method === 'POST') req.emit('data', JSON.stringify(body)); req.emit('end') }, 0)
    await routes.get('/dsh-filmcraft-progress/api/' + path).handler(req, res)
    const result = JSON.parse(res.text)
    if (!fail) assert.equal(res.code, 200, JSON.stringify(result))
    return result
  }
  const merged = await request('merge', { create: { name: '剪辑验收' }, name: '精剪', sources: files.map((file) => ({ file })), settings: { width: 320, height: 180, fps: 25 } })
  const project = merged.project.file
  let detail = merged.detail
  const videos = () => detail.sequence.tracks.video[0].items.slice().sort((a, b) => a.start - b.start)
  const read = async () => { detail = await request('project', { project, force: '1' }, 'GET'); return detail }
  const edit = async (body, fail = false) => {
    const r = await request('edit', { project, sequence: detail.sequence.id, ...body }, 'POST', fail)
    if (r.detail) detail = r.detail
    if (!fail) assert.equal(r.ok, true, JSON.stringify(r.failed))
    return r
  }
  const undo = async () => { detail = (await request('undo', { project })).detail }
  const original = videos().map((entry) => entry.clip)
  await edit({ operation: 'reorder', clip: original[2], target: original[0], after: false })
  check(JSON.stringify(videos().map((entry) => entry.clip)) === JSON.stringify([original[2], original[0], original[1]]), 'drag reorder inserts before target')
  check(videos().every((entry, i, all) => i === 0 || Math.abs(entry.start - all[i - 1].end) < 1e-6), 'unequal-duration clips remain contiguous')
  check(videos().every((entry) => detail.sequence.clips.some((audio) => audio.kind === 'audio' && audio.link === entry.link && Math.abs(audio.start - entry.start) < 1e-6)), 'linked audio follows drag reorder')
  await undo(); check(JSON.stringify(videos().map((entry) => entry.clip)) === JSON.stringify(original), 'one undo restores entire order')
  const clip = videos()[0].clip
  const duration = detail.sequence.duration
  await edit({ operation: 'trim', clip, edge: 'in', delta: '1f' })
  check(Math.abs(videos()[0].sourceIn - 0.04) < 1e-6 && Math.abs(detail.sequence.duration - (duration - 0.04)) < 1e-6, 'trim exactly one frame and ripple')
  await edit({ operation: 'trim', clip, edge: 'in', delta: '-1f' }); check(Math.abs(videos()[0].sourceIn) < 1e-6, 'negative frame delta extends clip')
  const invalid = await edit({ operation: 'trim', clip, edge: 'out', delta: '99s' }, true)
  check(/一帧/.test(invalid.error), 'reject trim that erases clip')
  check((await edit({ operation: 'trim', clip, edge: 'in', delta: 'abc' }, true)).error, 'reject malformed time')
  check((await request('edit', { project, sequence: -1, operation: 'trim', clip, edge: 'in', delta: '1f' }, 'POST', true)).error, 'reject stale sequence')
  await edit({ operation: 'trim', clip, edge: 'out', delta: '00:00:00:05' }); check(Math.abs(videos()[0].dur - 3.8) < 1e-6, 'timecode trim uses frame grid')
  check(detail.sequence.clips.some((entry) => entry.kind === 'audio' && entry.link === videos()[0].link && Math.abs(entry.dur - 3.8) < 1e-6), 'tail trim keeps linked audio duration aligned')
  await undo()
  if (real) {
    const clamped = await edit({ operation: 'trim', clip, edge: 'out', delta: '-99f' }, true)
    check(clamped.ok === false && clamped.rolledBack === true && Math.abs(videos()[0].dur - 4) < 1e-6, 'insufficient media handle rolls back rather than silently clamps')
  }
  await edit({ operation: 'split', clip, time: '25f' }); check(videos().length === 4, 'split at playhead adds a video clip')
  if (real) check(detail.sequence.clips.filter((entry) => entry.kind === 'audio').length === 4, 'split preserves linked audio cuts')
  await undo(); check(videos().length === 3, 'undo split')
  const frame = async (name, seconds) => {
    const result = await request('frame', { project, seconds, scale: 1 })
    const path = join(root, 'ws', 'work', 'previews', result.name)
    const bytes = readFileSync(path); writeFileSync(join(root, name + '.png'), bytes)
    return bytes
  }
  const pngData = (bytes) => {
    const blocks = []
    for (let at = 8; at + 12 <= bytes.length;) {
      const len = bytes.readUInt32BE(at)
      if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') blocks.push(bytes.subarray(at + 8, at + 8 + len))
      at += len + 12
    }
    return inflateSync(Buffer.concat(blocks))
  }
  const baseline = await frame('baseline', 1)
  await edit({ operation: 'caption', text: '中文剪辑验收\nFilmCraft', start: '25f', end: '75f' })
  let track = detail.sequence.captionTracks[0]
  let caption = track.items[0]
  check(track.label === 'C1' && caption.text.includes('中文') && caption.start === 1 && caption.end === 3, 'create Chinese multiline subtitle on frame-aligned range')
  const captionFrame = await frame('caption', 1)
  if (real) check(!pngData(baseline).equals(pngData(captionFrame)), 'subtitle changes rendered frame pixels')
  await edit({ operation: 'caption', caption: caption.id, track: track.id, text: '修改后的字幕', start: '30f', end: '70f' })
  caption = detail.sequence.captionTracks[0].items[0]
  check(caption.text === '修改后的字幕' && Math.abs(caption.start - 1.2) < 1e-6 && Math.abs(caption.end - 2.8) < 1e-6, 'edit subtitle text and range')
  check((await edit({ operation: 'caption', text: '越界', start: '-1', end: '2' }, true)).error, 'reject subtitle outside sequence')
  await edit({ operation: 'caption', track: track.id, caption: caption.id, remove: true }); check(detail.sequence.captionTracks[0].items.length === 0, 'delete subtitle')
  await undo(); check(detail.sequence.captionTracks[0].items.length === 1, 'undo restores subtitle')
  const transitionBaseline = await frame('transition-baseline', 0.2)
  await edit({ operation: 'transition', clip, effect: 'dip_to_black', edge: 'in', duration: '12f' })
  let transition = detail.sequence.tracks.video[0].transitions.find((entry) => entry.to === clip || entry.from === clip)
  check(transition && transition.effect === 'dip_to_black', 'add video fade transition')
  const fadeFrame = await frame('fade', 0.2)
  if (real) check(!pngData(transitionBaseline).equals(pngData(fadeFrame)), 'transition changes rendered frame pixels')
  await edit({ operation: 'transition', clip, transition: transition.id, duration: '8f' })
  check(Math.abs(detail.sequence.tracks.video[0].transitions[0].dur - 0.32) < 1e-6, 'update transition duration')
  check((await edit({ operation: 'reorder', clip: original[1], target: clip }, true)).error, 'protect transitions while reordering')
  await edit({ operation: 'transition', clip, transition: transition.id, remove: true }); check(detail.sequence.tracks.video[0].transitions.length === 0, 'remove transition')
  await undo(); check(detail.sequence.tracks.video[0].transitions.length === 1, 'undo restores transition')
  await edit({ operation: 'transition', clip: original[1], effect: 'cross_dissolve', edge: 'in', duration: '10f' })
  check(detail.sequence.tracks.video[0].transitions.some((entry) => entry.effect === 'cross_dissolve'), 'add cross dissolve between adjacent clips')
  const beforeText = detail.sequence.captionTracks[0].items[0].text
  const failed = await edit({ atomic: true, commands: [{ id: 'captions.setText', params: { caption: caption.id, text: '必须回滚' } }, { id: 'captions.setText', params: { caption: 99999999, text: '失败' } }] }, true)
  check(failed.ok === false && failed.rolledBack === true && detail.sequence.captionTracks[0].items[0].text === beforeText, 'failed subtitle batch rolls back completely')
  const exported = await request('export', { project, scale: 1 })
  let job
  for (let i = 0; i < 120; i++) {
    job = (await request('jobs', {}, 'GET')).jobs.find((entry) => entry.id === exported.job.id)
    if (job.state !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  check(job.state === 'done', 'export edited timeline with captions and transitions')
  if (real) {
    const probe = spawnSync(process.env.FILMCRAFT_EDITING_CLI, ['probe', job.out], { encoding: 'utf8', windowsHide: true })
    assert.equal(probe.status, 0, probe.stderr)
    const media = JSON.parse(probe.stdout)
    check(media.audio_streams.length > 0 && Math.abs(media.duration / 254016000000 - detail.sequence.duration) <= 0.04, 'MP4 decodes with correct duration and audio')
  }
  const locks = readdirSync(join(root, 'ws', 'work', 'locks'))
  check(locks.length === 0, 'host releases all editing locks')
  console.log('Editing host: ' + checks + ' checks passed (' + (real ? 'REAL' : 'mock') + ')')
}
