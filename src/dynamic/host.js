// FilmCraft progress host plugin.
// Reads a status contract file written by the editing pipeline, plus live
// output-file sampling, and serves a single state object to the client.
// NOTE: `readFileSync/statSync/existsSync` are injected as top-level imports
// by scripts/build-native.mjs — do not import them here.
return {
  name: 'filmcraft-progress-host',
  inject: ['tools'],
  apply(ctx) {
    // Status contract file. Override with FILMCRAFT_PROGRESS_FILE to point the
    // panel at another job without editing the plugin.
    const STATUS_PATH = (typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_PROGRESS_FILE)
      ? process.env.FILMCRAFT_PROGRESS_FILE
      : 'D:\\Myfiles\\临时\\film-status.json'
    const HISTORY = []
    const ALIVE_WINDOW_MS = 30000

    function num(v, d) {
      const n = Number(v)
      return Number.isFinite(n) ? n : d
    }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }
    function pad2(n) { return String(n).padStart(2, '0') }
    function hhmmss(sec) {
      if (!Number.isFinite(sec) || sec < 0) return '--:--'
      const s = Math.round(sec)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const ss = s % 60
      return (h > 0 ? h + ':' : '') + pad2(m) + ':' + pad2(ss)
    }
    function mb(bytes) { return bytes / 1048576 }

    function readStatus() {
      try { return JSON.parse(readFileSync(STATUS_PATH, 'utf8')) } catch (_) { return null }
    }

    function buildState() {
      const st = readStatus()
      const now = Date.now()
      if (st === null) {
        return {
          ok: false,
          now,
          statusPath: STATUS_PATH,
          error: '未找到进度文件（' + STATUS_PATH + '）',
        }
      }

      const ex = st.export || {}
      let bytes = 0, mtimeMs = 0, exists = false
      if (ex.path) {
        try {
          if (existsSync(ex.path)) {
            const s = statSync(ex.path)
            bytes = s.size
            mtimeMs = s.mtimeMs
            exists = true
          }
        } catch (_) { }
      }

      if (exists) {
        HISTORY.push({ t: now, bytes: bytes })
        while (HISTORY.length > 60) HISTORY.shift()
      }

      // write rate over the sampled window (bytes/sec)
      let rate = 0
      if (HISTORY.length >= 2) {
        const a = HISTORY[0]
        const b = HISTORY[HISTORY.length - 1]
        const dt = (b.t - a.t) / 1000
        if (dt > 2) rate = Math.max(0, (b.bytes - a.bytes) / dt)
      }

      const expectedBytes = num(ex.expectedBytes, num(st.expectedBytes, 0))
      const expectedMs = num(st.expectedMs, 0)
      const startedAt = st.startedAt ? Date.parse(st.startedAt) : null
      const elapsedMs = startedAt !== null && Number.isFinite(startedAt) ? now - startedAt : null

      // progress: prefer byte ratio when the target size is known
      let percent = null, basis = null
      if (expectedBytes > 0 && bytes > 0) {
        percent = clamp((bytes / expectedBytes) * 100, 0, 99.9)
        basis = 'bytes'
      } else if (expectedMs > 0 && elapsedMs !== null && elapsedMs > 0) {
        percent = clamp((elapsedMs / expectedMs) * 100, 0, 99.9)
        basis = 'time'
      }

      let etaMs = null
      if (rate > 0 && expectedBytes > 0 && bytes > 0) {
        etaMs = ((expectedBytes - bytes) / rate) * 1000
      } else if (expectedMs > 0 && elapsedMs !== null) {
        etaMs = expectedMs - elapsedMs
      }
      if (etaMs !== null) etaMs = Math.max(0, etaMs)

      const alive = exists && mtimeMs > 0 && (now - mtimeMs) < ALIVE_WINDOW_MS
      let phase = st.phase || 'idle'
      if (phase === 'export' && !alive && percent !== null && percent >= 99) phase = 'done'

      return {
        ok: true,
        now,
        statusPath: STATUS_PATH,
        project: st.project || '',
        phase,
        phaseLabel: st.phaseLabel || '',
        message: st.message || '',
        running: alive,
        startedAt: st.startedAt || null,
        updatedAt: st.updated || null,
        elapsedMs,
        elapsedText: elapsedMs !== null ? hhmmss(elapsedMs / 1000) : '--:--',
        etaMs,
        etaText: etaMs !== null ? hhmmss(etaMs / 1000) : '--:--',
        percent: percent === null ? null : Math.round(percent * 10) / 10,
        percentBasis: basis,
        export: {
          path: ex.path || '',
          exists,
          bytes,
          bytesText: exists ? mb(bytes).toFixed(0) + ' MB' : '—',
          expectedBytes,
          expectedText: expectedBytes > 0 ? mb(expectedBytes).toFixed(0) + ' MB' : '—',
          rateBytesPerSec: Math.round(rate),
          rateText: rate > 0 ? mb(rate).toFixed(2) + ' MB/s' : '—',
          mtimeMs: mtimeMs || null,
        },
        video: st.video || null,
        timeline: st.timeline || null,
        stats: st.stats || null,
        grades: st.grades || null,
        shots: Array.isArray(st.shots) ? st.shots : [],
        notes: Array.isArray(st.notes) ? st.notes : [],
        historyCount: HISTORY.length,
        error: st.error || null,
      }
    }

    harness.handle('progress.state', () => buildState())

    harness.registerTool(ctx, harness.defineTool({
      name: 'filmcraft_progress',
      description: '查看 FilmCraft 视频剪辑与调色的实时进度：导出百分比、已用时、预计剩余、输出文件大小与写入速度、分镜列表、调色参数。数据来自进度文件与输出文件的实时采样。',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      },
      async execute() { return buildState() },
    }))
  },
}