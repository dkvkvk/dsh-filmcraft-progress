// ── views ───────────────────────────────────────────────────────────────────
// What an agent reads back. Compact, but with every number an edit needs:
// seconds (3 dp), timecode, frame counts, and the ids — never indices, because
// an index shifts the moment anything earlier on the track changes.

function mcpClipView(clip, fps) {
  return {
    clip: clip.clip,
    name: clip.name,
    track: clip.trackLabel,
    start: mcpRound(clip.start),
    end: mcpRound(clip.end),
    duration: mcpRound(clip.dur),
    startTc: mcpTimecode(clip.start, fps),
    endTc: mcpTimecode(clip.end, fps),
    durationFrames: mcpFrames(clip.dur, fps),
    sourceIn: mcpRound(clip.sourceIn),
    sourceOut: mcpRound(clip.sourceOut),
    speed: clip.speed,
    enabled: clip.enabled,
    gainDb: clip.kind === 'audio' ? clip.gainDb : undefined,
    link: clip.link,
    effects: (clip.effects || []).map((effect) => effect.effect + (effect.enabled ? '' : '(off)')),
  }
}

function mcpTimelineView(detail, options) {
  const opts = options || {}
  const sequence = detail.sequence
  const view = {
    project: { name: detail.name, path: winPath(detail.path), revision: detail.revision, savedAt: detail.savedAt },
    sequences: detail.sequences.map((entry) => ({ id: entry.id, name: entry.name, duration: mcpRound(entry.duration), active: entry.active })),
    active: null,
  }
  if (sequence) {
    const fps = sequence.fps
    const tracks = []
    for (const kind of ['video', 'audio']) {
      for (const track of sequence.tracks[kind]) {
        if (opts.includeEmpty !== true && track.items.length === 0) continue
        tracks.push({
          track: track.label, id: track.id, kind: kind, muted: track.muted, locked: track.locked, enabled: track.enabled,
          clips: track.items.slice().sort((x, y) => x.start - y.start).map((clip) => mcpClipView(clip, fps)),
          transitions: track.transitions || [],
        })
      }
    }
    view.active = {
      id: sequence.id, name: sequence.name,
      width: sequence.width, height: sequence.height, fps: mcpRound(fps), sampleRate: sequence.sampleRate,
      duration: mcpRound(sequence.duration), durationTc: mcpTimecode(sequence.duration, fps), frames: sequence.frames,
      playhead: mcpRound(sequence.playhead),
      inPoint: mcpRound(sequence.inPoint), outPoint: mcpRound(sequence.outPoint),
      markers: sequence.markers,
      trackCount: { video: sequence.tracks.video.length, audio: sequence.tracks.audio.length },
      tracks: tracks,
      captionTracks: sequence.captionTracks || [],
    }
  }
  if (opts.assets) view.assets = (detail.assets || []).map(mcpAssetView)
  return view
}

function mcpAssetView(asset) {
  return {
    item: asset.item, name: asset.name, kind: asset.kind, online: asset.online,
    path: asset.path ? winPath(asset.path) : '', size: asset.width ? asset.width + 'x' + asset.height : '',
    fps: asset.fps, duration: asset.durationText, audio: asset.audioInfo, proxy: asset.proxy ? winPath(asset.proxy) : '',
  }
}

// Before/after by clip id. Enough for an agent to confirm "the trim did what I
// asked and nothing else moved" without diffing two full timelines itself.
function mcpDiff(before, after) {
  const out = { added: [], removed: [], changed: [], durationBefore: null, durationAfter: null }
  const a = new Map()
  const b = new Map()
  if (before) { out.durationBefore = mcpRound(before.duration); for (const clip of before.clips) a.set(clip.clip, clip) }
  if (after) { out.durationAfter = mcpRound(after.duration); for (const clip of after.clips) b.set(clip.clip, clip) }
  const fps = after ? after.fps : (before ? before.fps : 0)
  const captionsBefore = before ? before.captionTracks || [] : []
  const captionsAfter = after ? after.captionTracks || [] : []
  if (JSON.stringify(captionsBefore) !== JSON.stringify(captionsAfter)) out.captions = { before: captionsBefore, after: captionsAfter }
  const transitions = (sequence) => sequence ? sequence.tracks.video.concat(sequence.tracks.audio).flatMap((track) => (track.transitions || []).map((entry) => Object.assign({ track: track.label }, entry))) : []
  const transitionsBefore = transitions(before)
  const transitionsAfter = transitions(after)
  if (JSON.stringify(transitionsBefore) !== JSON.stringify(transitionsAfter)) out.transitions = { before: transitionsBefore, after: transitionsAfter }
  for (const [id, clip] of b) if (!a.has(id)) out.added.push(mcpClipView(clip, fps))
  for (const [id, clip] of a) if (!b.has(id)) out.removed.push({ clip: id, name: clip.name, track: clip.trackLabel })
  for (const [id, now] of b) {
    const was = a.get(id)
    if (!was) continue
    const delta = {}
    const eps = 1e-6
    if (was.trackLabel !== now.trackLabel) delta.track = [was.trackLabel, now.trackLabel]
    for (const key of ['start', 'dur', 'sourceIn', 'sourceOut', 'speed']) {
      if (Math.abs(was[key] - now[key]) > eps) delta[key === 'dur' ? 'duration' : key] = [mcpRound(was[key]), mcpRound(now[key])]
    }
    if (was.enabled !== now.enabled) delta.enabled = [was.enabled, now.enabled]
    const fx = (clip) => (clip.effects || []).map((effect) => effect.effect + ':' + JSON.stringify(effect.params)).join('|')
    if (fx(was) !== fx(now)) delta.effects = [(was.effects || []).length, (now.effects || []).length]
    if (Object.keys(delta).length > 0) out.changed.push(Object.assign({ clip: id, name: now.name }, delta))
  }
  const cap = 60
  for (const key of ['added', 'removed', 'changed']) {
    if (out[key].length > cap) { out[key + 'Truncated'] = out[key].length - cap; out[key] = out[key].slice(0, cap) }
  }
  return out
}

// ── timeline QA ─────────────────────────────────────────────────────────────
// The checks an assistant editor runs before handing a cut over: black holes,
// stacked clips, flash frames, offline media, desynced links.
function mcpCheckTimeline(detail) {
  const issues = []
  const sequence = detail.sequence
  const add = (level, code, message, extra) => issues.push(Object.assign({ level: level, code: code, message: message }, extra || {}))
  if (!sequence) {
    add('error', 'no-sequence', '工程里没有激活的序列')
    return { ok: false, issues: issues }
  }
  const fps = sequence.fps
  const half = fps > 0 ? 0.5 / fps : 0.02
  if (sequence.clips.length === 0) add('warning', 'empty', '序列是空的')

  for (const kind of ['video', 'audio']) {
    for (const track of sequence.tracks[kind]) {
      const items = track.items.slice().sort((x, y) => x.start - y.start)
      for (let i = 0; i < items.length; i += 1) {
        const clip = items[i]
        const prev = items[i - 1]
        if (i === 0 && kind === 'video' && track.label === 'V1' && clip.start > half) {
          add('warning', 'leading-gap', track.label + ' 开头有 ' + mcpRound(clip.start) + 's 黑场', { track: track.label, at: 0, duration: mcpRound(clip.start) })
        }
        if (prev) {
          const gap = clip.start - prev.end
          if (gap > half && kind === 'video' && track.label === 'V1') {
            add('warning', 'gap', track.label + ' 在 ' + mcpTimecode(prev.end, fps) + ' 有 ' + mcpRound(gap) + 's 空隙（黑场）', { track: track.label, at: mcpRound(prev.end), duration: mcpRound(gap), after: prev.clip, before: clip.clip })
          }
          if (gap < -half) {
            add('error', 'overlap', track.label + ' 上片段 ' + prev.clip + ' 与 ' + clip.clip + ' 重叠 ' + mcpRound(-gap) + 's', { track: track.label, clips: [prev.clip, clip.clip] })
          }
        }
        const frames = mcpFrames(clip.dur, fps)
        if (frames !== null && frames < 3) add('warning', 'flash-frame', '片段 ' + clip.clip + ' 只有 ' + frames + ' 帧（闪帧）', { clip: clip.clip, track: track.label })
        else if (clip.dur < 0.5 && kind === 'video') add('info', 'very-short', '片段 ' + clip.clip + ' 短于 0.5s', { clip: clip.clip })
        if (!clip.enabled) add('info', 'disabled', '片段 ' + clip.clip + ' 已停用，导出时不出现', { clip: clip.clip })
        if (Math.abs(clip.speed - 1) > 1e-6) add('info', 'speed', '片段 ' + clip.clip + ' 变速 ' + clip.speed + 'x', { clip: clip.clip })
      }
      if (track.muted && track.items.length > 0) add('info', 'muted-track', track.label + ' 已静音')
    }
  }

  // Linked A/V must start together; a mismatch is an out-of-sync shot.
  const groups = new Map()
  for (const clip of sequence.clips) {
    if (clip.link === null || clip.link === undefined) continue
    const key = JSON.stringify(clip.link)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(clip)
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const starts = members.map((clip) => clip.start)
    const spread = Math.max.apply(null, starts) - Math.min.apply(null, starts)
    if (spread > half) {
      add('error', 'link-desync', '联动片段 ' + members.map((clip) => clip.clip).join('/') + ' 起点相差 ' + mcpRound(spread) + 's（音画不同步）', { clips: members.map((clip) => clip.clip) })
    }
  }

  for (const asset of detail.assets || []) {
    if (asset.kind === 'media' && !asset.online) add('error', 'offline', '素材离线: ' + asset.name, { item: asset.item, path: winPath(asset.path) })
    if (asset.kind === 'media' && asset.width > 0 && sequence.width > 0 && (asset.width / asset.height).toFixed(2) !== (sequence.width / sequence.height).toFixed(2)) {
      add('info', 'aspect', '素材 ' + asset.name + ' 画幅 ' + asset.width + 'x' + asset.height + ' 与序列 ' + sequence.width + 'x' + sequence.height + ' 不同，会补边或裁切', { item: asset.item })
    }
  }
  const counts = { error: 0, warning: 0, info: 0 }
  for (const issue of issues) counts[issue.level] += 1
  return {
    ok: counts.error === 0,
    counts: counts,
    sequence: { id: sequence.id, name: sequence.name, duration: mcpRound(sequence.duration), durationTc: mcpTimecode(sequence.duration, fps), clips: sequence.clips.length },
    issues: issues,
  }
}
