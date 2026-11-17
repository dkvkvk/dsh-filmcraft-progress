// Validated editing operations shared by the sidebar and the MCP workflow tool.
// Build the whole batch before taking a snapshot; invalid input never writes.
function editTimeTicks(value, fps, label) {
  if (!(fps > 0)) throw new Error('序列帧率无效')
  const text = String(value === undefined ? '' : value).trim()
  let seconds
  let match
  if ((match = /^([+-]?\d+)f$/i.exec(text))) seconds = Number(match[1]) / fps
  else if ((match = /^(\d+):(\d{2}):(\d{2}):(\d{2})$/.exec(text))) {
    if (Number(match[2]) > 59 || Number(match[3]) > 59 || Number(match[4]) >= Math.round(fps)) throw new Error('时间码超出范围')
    seconds = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * Math.round(fps) / fps + Number(match[4]) / fps
  } else if ((match = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(text))) {
    if (Number(match[2]) >= 60) throw new Error('时间秒数须小于 60')
    seconds = Number(match[1]) * 60 + Number(match[2])
  } else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)s?$/i.test(text)) seconds = Number(text.replace(/s$/i, ''))
  if (!Number.isFinite(seconds)) throw new Error((label || '时间') + '请填写秒、帧（如 12f）或时间码（00:00:01:12）')
  const ticks = Math.round(Math.round(seconds * fps) * TICKS_PER_SECOND / fps)
  if (!Number.isSafeInteger(ticks)) throw new Error('时间超出可处理范围')
  return ticks
}

function editWorkflowCommands(config, projectFile, request) {
  const sequence = projectDetail(config, projectFile, { force: true }).sequence
  if (!sequence) throw new Error('请先打开一个序列')
  if (request.sequence !== sequence.id) throw new Error('序列已切换，请刷新后重试')
  const tick = (value, label) => editTimeTicks(value, sequence.fps, label)
  const clipOf = (id) => {
    const clip = sequence.clips.find((entry) => entry.clip === id && entry.kind === 'video')
    if (!clip) throw new Error('镜头已不存在，请刷新后重试')
    const track = sequence.tracks.video.find((entry) => entry.id === clip.track)
    if (track.locked) throw new Error('轨道已锁定')
    return clip
  }
  if (request.operation === 'trim') {
    const clip = clipOf(request.clip)
    if (request.edge !== 'in' && request.edge !== 'out') throw new Error('请选择裁头或裁尾')
    const delta = tick(request.delta, '裁切量')
    if (delta === 0) throw new Error('裁切量不足一帧')
    if (delta >= clip.ticks.duration) throw new Error('裁切后必须至少保留一帧')
    return [{ id: 'timeline.trim', params: { clip: clip.clip, edge: request.edge, delta: request.edge === 'out' ? -delta : delta, mode: 'ripple' } }]
  }
  if (request.operation === 'split') {
    const clip = clipOf(request.clip)
    const time = tick(request.time, '分割位置')
    if (time <= clip.ticks.start || time >= clip.ticks.start + clip.ticks.duration) throw new Error('分割位置须在镜头内部')
    return [{ id: 'timeline.razor', params: { clip: clip.clip, time: time } }]
  }
  if (request.operation === 'reorder') {
    const clip = clipOf(request.clip)
    const target = clipOf(request.target)
    if (clip.track !== target.track) throw new Error('请拖到同一视频轨的镜头上')
    const track = sequence.tracks.video.find((entry) => entry.id === clip.track)
    if ((track.transitions || []).length > 0) throw new Error('请先移除该轨转场，再调整镜头顺序')
    const sorted = track.items.slice().sort((a, b) => a.start - b.start)
    const order = sorted.filter((entry) => entry.clip !== clip.clip)
    const at = order.findIndex((entry) => entry.clip === target.clip)
    if (at < 0) throw new Error('顺序没有变化')
    order.splice(at + (request.after === true ? 1 : 0), 0, clip)
    let cursor = Math.min.apply(null, sorted.map((entry) => entry.ticks.start))
    const moves = []
    for (const entry of order) {
      if (entry.ticks.start !== cursor) moves.push({ clip: entry.clip, track: track.id, time: cursor })
      cursor += entry.ticks.duration
    }
    if (moves.length === 0) throw new Error('顺序没有变化')
    return [{ id: 'timeline.move', params: { moves: moves, linked: true, insert: false } }]
  }
  if (request.operation === 'caption') {
    const tracks = sequence.captionTracks || []
    const track = request.track ? tracks.find((entry) => entry.id === request.track) : tracks[0]
    if (request.track && !track) throw new Error('字幕轨已不存在')
    if (track && track.locked) throw new Error('字幕轨已锁定')
    const caption = track && track.items.find((entry) => entry.id === request.caption)
    if (request.caption && !caption) throw new Error('字幕已不存在，请刷新后重试')
    if (request.remove === true) {
      if (!caption) throw new Error('请选择要删除的字幕')
      return [{ id: 'captions.delete', params: { captions: [caption.id], ripple: false } }]
    }
    const text = String(request.text || '').trim()
    if (!text || text.length > 4000) throw new Error('字幕内容须为 1–4000 个字符')
    const start = tick(request.start, '字幕起点')
    const end = tick(request.end, '字幕终点')
    if (start < 0 || end <= start || end > Math.round(sequence.duration * TICKS_PER_SECOND) + 1) throw new Error('字幕起止时间须位于序列内，且终点晚于起点')
    const steps = []
    if (!track) {
      steps.push({ id: 'captions.newTrack', params: { format: 'Subtitle', name: '字幕', language: 'zh' } })
      steps.push({ id: 'captions.setStyle', params: { track: 'C1', font: process.platform === 'win32' ? 'Microsoft YaHei' : 'sans-serif', size: Math.max(12, Math.round(sequence.height * 0.05)), background: true } })
    }
    if (caption) {
      steps.push({ id: 'captions.setText', params: { caption: caption.id, text: text } })
      steps.push({ id: 'captions.setTimes', params: { caption: caption.id, startTime: start, endTime: end } })
    } else steps.push({ id: 'captions.add', params: { track: track ? track.id : 'C1', text: text, time: start, durationSeconds: (end - start) / TICKS_PER_SECOND } })
    return steps
  }
  if (request.operation === 'transition') {
    const clip = clipOf(request.clip)
    const track = sequence.tracks.video.find((entry) => entry.id === clip.track)
    if (request.remove === true || request.transition) {
      const transition = (track.transitions || []).find((entry) => entry.id === request.transition && (entry.from === clip.clip || entry.to === clip.clip))
      if (!transition) throw new Error('转场已不存在，请刷新后重试')
      if (request.remove === true) return [{ id: 'sequence.removeTransition', params: { transitions: [transition.id] } }]
      const duration = tick(request.duration, '转场时长')
      if (duration <= 0 || duration > clip.ticks.duration) throw new Error('转场须至少一帧，且不能长于镜头')
      return [{ id: 'sequence.setTransition', params: { transition: transition.id, duration: duration } }]
    }
    if (request.edge !== 'in' && request.edge !== 'out') throw new Error('请选择镜头开头或结尾')
    if (!['cross_dissolve', 'dip_to_black'].includes(request.effect)) throw new Error('不支持的转场类型')
    const duration = tick(request.duration, '转场时长')
    if (duration <= 0 || duration > clip.ticks.duration) throw new Error('转场须至少一帧，且不能长于镜头')
    return [{ id: 'sequence.applyVideoTransition', params: { clip: clip.clip, effect: request.effect, edge: request.edge, frames: Math.round(duration / TICKS_PER_SECOND * sequence.fps) } }]
  }
  throw new Error('未知的剪辑操作')
}
