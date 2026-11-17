// Compact timeline geometry with same-track drag sorting.
// Intervals are arranged into lanes so overlaps never hide another clip.
function fcTimelineLayout(sequence) {
  const rows = []
  let duration = Math.max(0, Number(sequence && sequence.duration) || 0)
  for (const kind of ['video', 'audio']) {
    const tracks = sequence && sequence.tracks && sequence.tracks[kind] || []
    for (const track of tracks) {
      const items = (track.items || []).filter(function (clip) {
        return Number.isFinite(clip.start) && Number.isFinite(clip.dur) && clip.dur > 0 && clip.start + clip.dur > 0
      }).slice().sort(function (a, b) { return a.start - b.start || a.clip - b.clip })
      if (items.length === 0) continue
      const ends = []
      const clips = []
      const gaps = []
      const overlaps = []
      let covered = 0
      for (const clip of items) {
        const start = Math.max(0, clip.start)
        const end = clip.start + clip.dur
        if (start > covered + 1e-7) gaps.push({ start: covered, end: start })
        if (start < covered - 1e-7) overlaps.push({ start: start, end: Math.min(covered, end) })
        let lane = ends.findIndex(function (value) { return value <= start + 1e-7 })
        if (lane < 0) lane = ends.length
        ends[lane] = end
        clips.push({ clip: clip, start: start, end: end, lane: lane })
        covered = Math.max(covered, end)
        duration = Math.max(duration, end)
      }
      rows.push({ track: track, kind: kind, clips: clips, gaps: gaps, overlaps: overlaps, lanes: ends.length, end: covered })
    }
  }
  for (const row of rows) if (row.end < duration - 1e-7) row.gaps.push({ start: row.end, end: duration })
  return { duration: Number.isFinite(duration) ? duration : 0, rows: rows }
}

function FcTimeline() {
  const sequence = fcSequence()
  const layout = fcTimelineLayout(sequence)
  if (layout.duration <= 0 || layout.rows.length === 0) return h('div', { className: 'fc-empty' }, '序列里还没有片段')
  const videos = fcClips()
  const busy = store.busy !== ''
  const scale = 100 / layout.duration
  const position = function (span) {
    return { left: (span.start * scale) + '%', width: ((span.end - span.start) * scale) + '%' }
  }
  return h('div', { className: 'fc-timeline', 'aria-label': '音视频时间线' },
    h('div', { className: 'fc-tl-ruler', 'aria-hidden': true },
      h('span', null, fcTime(0)), h('span', null, fcTime(layout.duration / 2)), h('span', null, fcTime(layout.duration))),
    layout.rows.map(function (row) {
      const track = row.track
      return h('div', { className: 'fc-tl-row', key: row.kind + track.id },
        h('div', { className: 'fc-tl-label', title: track.label + (track.muted ? ' · 静音' : '') },
          track.label, track.muted ? h('small', null, '静音') : null),
        h('div', { className: 'fc-tl-track', style: { height: (row.lanes * 28 + 4) + 'px' } },
          row.gaps.map(function (gap, index) {
            return h('span', { key: 'gap-' + index, className: 'fc-tl-gap', style: position(gap), title: '轨内空隙 ' + fcTime(gap.start) + '–' + fcTime(gap.end) })
          }),
          row.clips.map(function (span) {
            const clip = span.clip
            const video = row.kind === 'video' ? clip : videos.find(function (candidate) {
              return clip.link !== null && clip.link !== undefined && candidate.link === clip.link
            })
            const selected = !!video && video.clip === store.clipId
            const label = track.label + ' · ' + clip.name + ' · ' + fcTime(span.start) + '–' + fcTime(span.end)
            const style = Object.assign(position(span), { top: (span.lane * 28 + 2) + 'px' })
            const props = {
              key: 'clip-' + clip.clip,
              className: 'fc-tl-clip ' + row.kind + (selected ? ' on' : '') + (clip.enabled === false ? ' off' : ''),
              style: style,
              title: label + (clip.enabled === false ? ' · 停用' : '') + (video ? '（点击选中视频）' : ''),
              'aria-label': label,
            }
            if (video) {
              props.type = 'button'
              props.disabled = busy
              props['aria-pressed'] = selected
              props.onClick = function () { fcSelectClip(video.clip) }
              if (row.kind === 'video') Object.assign(props, fcDragBindings(clip, false))
            }
            return h(video ? 'button' : 'span', props, clip.name || String(clip.clip))
          }),
          (track.transitions || []).map(function (entry) {
            return h('span', { key: 'transition-' + entry.id, className: 'fc-tl-transition', style: position({ start: entry.start, end: entry.start + entry.dur }), title: '转场 · ' + (FC_TRANSITION_NAMES[entry.effect] || entry.effect) })
          }),
          row.overlaps.map(function (overlap, index) {
            return h('span', { key: 'overlap-' + index, className: 'fc-tl-overlap', style: position(overlap), title: '片段重叠 ' + fcTime(overlap.start) + '–' + fcTime(overlap.end) })
          })))
    }),
    (sequence.captionTracks || []).map(function (track) {
      return h('div', { className: 'fc-tl-row', key: 'caption-' + track.id },
        h('div', { className: 'fc-tl-label' }, track.label),
        h('div', { className: 'fc-tl-track', style: { height: '32px' } }, track.items.map(function (caption) {
          return h('button', { type: 'button', key: caption.id, className: 'fc-tl-clip caption', style: Object.assign(position(caption), { top: '2px' }), disabled: busy, title: caption.text, onClick: function () { fcCaptionChoose(track, caption) } }, caption.text)
        })))
    }),
    h('div', { className: 'fc-hint' }, '拖动视频到同轨镜头前后可排序，该轨镜头将首尾相接；片段列表也支持拖动。虚线为空隙，红线为重叠，紫条为转场。'))
}
