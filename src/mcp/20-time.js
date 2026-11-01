// ── time ────────────────────────────────────────────────────────────────────
// Agents and editors think in seconds and timecode; the engine only takes
// integer ticks (254016000000 per second). Every edit point an MCP tool sends is
// snapped to the sequence's frame grid, because an edit between two frames is
// invisible on screen but makes the next trim land off by one.

function mcpParseTime(value, fps, label) {
  const what = label || '时间'
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') throw new Error(what + ' 必须是秒数或时间码')
  const text = value.trim()
  let match = /^(-?)(\d+(?:\.\d+)?)s?$/.exec(text)
  if (match) return (match[1] === '-' ? -1 : 1) * Number(match[2])
  match = /^(-?)(\d+)f$/i.exec(text)
  if (match) {
    if (!(fps > 0)) throw new Error(what + ' 用了帧数，但序列帧率未知')
    return (match[1] === '-' ? -1 : 1) * Number(match[2]) / fps
  }
  match = /^(-?)(\d+):(\d{1,2}):(\d{1,2})[:;](\d{1,3})$/.exec(text)
  if (match) {
    if (!(fps > 0)) throw new Error(what + ' 用了时间码，但序列帧率未知')
    const nominal = Math.round(fps)
    const frames = ((Number(match[2]) * 60 + Number(match[3])) * 60 + Number(match[4])) * nominal + Number(match[5])
    return (match[1] === '-' ? -1 : 1) * frames / fps
  }
  match = /^(-?)(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text)
  if (match) {
    const total = (Number(match[2] || 0) * 60 + Number(match[3])) * 60 + Number(match[4])
    return (match[1] === '-' ? -1 : 1) * total
  }
  throw new Error(what + ' 无法解析: ' + text + '（可用 12.5 / "12.5s" / "30f" / "00:01:02:12" / "1:02.5"）')
}

function mcpFrameTicks(fps) { return fps > 0 ? TICKS_PER_SECOND / fps : 0 }

function mcpToTicks(seconds, fps) {
  if (!(fps > 0)) return Math.round(seconds * TICKS_PER_SECOND)
  const frames = Math.round(seconds * fps)
  return Math.round(frames * mcpFrameTicks(fps))
}

function mcpFrames(seconds, fps) { return fps > 0 ? Math.round(seconds * fps) : null }

function mcpTimecode(seconds, fps) {
  if (!Number.isFinite(seconds)) return null
  const rate = fps > 0 ? fps : 25
  const nominal = Math.round(rate)
  const sign = seconds < 0 ? '-' : ''
  let frames = Math.round(Math.abs(seconds) * rate)
  const ff = frames % nominal; frames = (frames - ff) / nominal
  const ss = frames % 60; frames = (frames - ss) / 60
  const mm = frames % 60
  const hh = (frames - mm) / 60
  return sign + pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + ':' + pad2(ff)
}

function mcpRound(value) { return Math.round(value * 1000) / 1000 }
