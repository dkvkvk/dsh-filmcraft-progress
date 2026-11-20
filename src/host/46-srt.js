// SRT cues use elapsed time in milliseconds. Round to sequence frames only
// after checking the original range so a small overrun cannot round into bounds.
function srtSeconds(value) {
  const time = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value)
  if (!time) throw new Error('时间格式应为 00:00:00,000 --> 00:00:01,000')
  return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) + Number(time[4]) / 1000
}

function parseSrtCaptions(srt, sequence) {
  if (typeof srt !== 'string') throw new Error('请选择 UTF-8 编码的 SRT 文件')
  const lines = srt.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  const captions = []
  let cursor = 0
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) {
      cursor += 1
      continue
    }
    const firstLine = cursor + 1
    const location = 'SRT 第 ' + (captions.length + 1) + ' 条（第 ' + firstLine + ' 行）'
    try {
      if (!/^\d+$/.test(lines[cursor].trim())) throw new Error('缺少数字序号')
      const timing = (lines[cursor + 1] || '').trim().split(/\s*-->\s*/)
      if (timing.length !== 2) throw new Error('时间行须用 --> 分隔起点和终点')
      const start = srtSeconds(timing[0])
      const end = srtSeconds(timing[1])
      if (end <= start || end > sequence.duration + 1 / TICKS_PER_SECOND) throw new Error('字幕起止时间须位于序列内，且终点晚于起点')
      cursor += 2
      const textStart = cursor
      while (cursor < lines.length && lines[cursor].trim()) {
        if (/^\d+$/.test(lines[cursor].trim()) && /^\s*\d{2,}:\d{2}:\d{2}[,.]/.test(lines[cursor + 1] || '')) throw new Error('第 ' + (cursor + 1) + ' 行前缺少分隔字幕的空行')
        cursor += 1
      }
      captions.push(captionFields(sequence, { start, end, text: lines.slice(textStart, cursor).join('\n') }))
    } catch (error) {
      throw new Error(location + '：' + error.message)
    }
  }
  if (captions.length === 0) throw new Error('SRT 文件中没有字幕')
  return captions
}
