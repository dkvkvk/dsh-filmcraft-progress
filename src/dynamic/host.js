// FilmCraft host plugin.  Two jobs:
//
// 1. PROGRESS — reads a status contract file written by the editing pipeline,
//    samples the live output file, and serves one state object to the client.
// 2. EDITING  — a thin, whitelisted bridge to filmcraft-cli so the panel can
//    inspect a project and perform basic cuts (trim, delete, move, grade,
//    export) without the user leaving DSH.
//
// NOTE: `readFileSync/statSync/existsSync/readdirSync/openSync/closeSync/
// writeFileSync/mkdirSync` and `spawnSync/spawn` are injected as top-level
// imports by scripts/build-native.mjs — do not import them here.
return {
  name: 'filmcraft-progress-host',
  inject: ['tools'],
  apply(ctx) {
    // ── 1. progress ─────────────────────────────────────────────────────────
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
      // ex.path may be a directory (a paused batch run points at its output
      // folder). statSync reports a size for directories too, which would
      // masquerade as a real, recently-written export file.
      let bytes = 0, mtimeMs = 0, exists = false
      if (ex.path) {
        try {
          const s = statSync(ex.path)
          if (s.isFile()) { bytes = s.size; mtimeMs = s.mtimeMs; exists = true }
        } catch (_) { }
      }

      const alive = exists && mtimeMs > 0 && (now - mtimeMs) < ALIVE_WINDOW_MS

      if (alive) {
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
      // `num` treats null as 0, so test the type explicitly.
      const frozenMs = typeof st.elapsedMs === 'number' && Number.isFinite(st.elapsedMs) ? st.elapsedMs : null
      // A paused job must stop accruing. Leaving elapsed on the wall clock makes
      // it grow past expectedMs and pins the bar at 99.9% forever — the "已暂停
      // 0/33" + 99.9% contradiction.
      const elapsedMs = alive
        ? (startedAt !== null && Number.isFinite(startedAt) ? now - startedAt : null)
        : frozenMs

      // progress: prefer byte ratio when the target size is known
      let percent = null, basis = null
      if (alive) {
        if (expectedBytes > 0 && bytes > 0) {
          percent = clamp((bytes / expectedBytes) * 100, 0, 99.9)
          basis = 'bytes'
        } else if (expectedMs > 0 && elapsedMs !== null && elapsedMs > 0) {
          percent = clamp((elapsedMs / expectedMs) * 100, 0, 99.9)
          basis = 'time'
        }
      } else {
        // Not running: report what the status file recorded, never a live guess.
        const recorded = typeof st.percent === 'number' && Number.isFinite(st.percent) ? st.percent : null
        if (recorded !== null) { percent = clamp(recorded, 0, 100); basis = 'recorded' }
      }

      let etaMs = null
      if (alive) {
        if (rate > 0 && expectedBytes > 0 && bytes > 0) {
          etaMs = ((expectedBytes - bytes) / rate) * 1000
        } else if (expectedMs > 0 && elapsedMs !== null) {
          etaMs = expectedMs - elapsedMs
        }
        if (etaMs !== null) etaMs = Math.max(0, etaMs)
      }

      let phase = st.phase || 'idle'
      if (phase === 'export' && !alive && percent !== null && percent >= 99) phase = 'done'

      return {
        ok: true,
        now,
        statusPath: STATUS_PATH,
        project: st.project || '',
        // 'batch' (per-clip grading/export) vs 'film' (one cut timeline);
        // the panel picks its layout from this.
        mode: st.mode === 'batch' ? 'batch' : 'film',
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

    // ── 2. editing bridge ───────────────────────────────────────────────────
    const CLI = (typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_CLI)
      ? process.env.FILMCRAFT_CLI
      : 'C:\\Program Files\\FilmCraft\\filmcraft-cli.exe'
    const TICKS = 254016000000
    const ROOTS = ((typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_ROOTS)
      ? process.env.FILMCRAFT_ROOTS
      : 'D:\\Myfiles\\临时').split(';').map(s => s.trim()).filter(Boolean)
    const EXPORT_DIR = (typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_EXPORT_DIR)
      ? process.env.FILMCRAFT_EXPORT_DIR
      : 'D:\\Myfiles\\临时\\导出'
    const LOG_DIR = (typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_LOG_DIR)
      ? process.env.FILMCRAFT_LOG_DIR
      : 'D:\\Myfiles\\临时\\build'

    // Only these may reach the CLI through the edit endpoint.  The panel is a
    // basic cutter, not a remote control for all 700 commands.
    const ALLOWED = {
      'timeline.select': 1, 'timeline.trim': 1, 'timeline.slip': 1, 'timeline.slide': 1,
      'timeline.move': 1, 'timeline.razor': 1, 'timeline.place': 1,
      'edit.rippleDelete': 1, 'edit.clear': 1, 'edit.undo': 1, 'edit.redo': 1, 'edit.deselectAll': 1,
      'clip.speedDuration': 1, 'clip.audioGain': 1, 'clip.enable': 1, 'clip.rename': 1,
      'clip.fitToFrame': 1, 'clip.fillFrame': 1,
      'effects.apply': 1, 'effects.setParam': 1, 'effects.reset': 1, 'effects.remove': 1,
      'file.newSequence': 1, 'file.save': 1, 'file.saveAs': 1,
    }

    function cli(args, timeoutMs) {
      const r = spawnSync(CLI, args, {
        encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true,
        timeout: timeoutMs || 120000,
      })
      return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
    }

    // `run` prints one JSON object per line; `inspect` prints one pretty blob.
    function cliJson(args, timeoutMs) {
      const r = cli(args, timeoutMs)
      if (r.code !== 0) throw new Error((r.err || r.out || 'filmcraft-cli 执行失败').trim().slice(0, 300))
      try { return JSON.parse(r.out) } catch (_) {
        throw new Error('无法解析 CLI 输出：' + r.out.trim().slice(0, 200))
      }
    }

    function guardPath(p) {
      if (typeof p !== 'string' || p.length === 0) throw new Error('缺少工程路径')
      const lower = p.toLowerCase()
      if (!lower.endsWith('.fcproj')) throw new Error('只接受 .fcproj 工程文件')
      if (p.indexOf('\u0000') >= 0) throw new Error('路径非法')
      return p
    }

    // Bounded recursive scan for project files, newest first.
    // Undo snapshots live next to the projects and are also `.fcproj`, so they
    // are filtered out — otherwise the picker fills up with our own backups.
    const SNAP_NAME = /\.fcproj\.\d+\.fcproj$/i
    function scanProjects() {
      const found = []
      let budget = 4000
      function walk(dir, depth) {
        if (depth > 3 || budget <= 0) return
        let entries
        try { entries = readdirSync(dir, { withFileTypes: true }) } catch (_) { return }
        for (const e of entries) {
          if (budget-- <= 0) return
          const full = dir + '\\' + e.name
          if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === 'snapshots' || e.name.charAt(0) === '.') continue
            walk(full, depth + 1)
          } else if (/\.fcproj$/i.test(e.name) && !SNAP_NAME.test(e.name)) {
            let size = 0, mtime = 0
            try { const s = statSync(full); size = s.size; mtime = s.mtimeMs } catch (_) { }
            found.push({ path: full, name: e.name, size, mtime })
          }
        }
      }
      for (const root of ROOTS) walk(root.replace(/[\\/]+$/, ''), 0)
      found.sort((a, b) => b.mtime - a.mtime)
      return found.slice(0, 40)
    }

    function parseVal(text) {
      const m = /^(\w+)\((.*)\)$/s.exec(String(text || ''))
      if (m === null) return text
      const kind = m[1], inner = m[2]
      if (kind === 'Float' || kind === 'Int') { const n = Number(inner); return Number.isFinite(n) ? n : inner }
      if (kind === 'Bool') return inner === 'true'
      if (kind === 'Choice') return Number(inner)
      return inner
    }

    const GRADE_KEYS = ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint',
      'saturation', 'vibrance', 'sharpen', 'hsl_on', 'hsl_hue', 'hsl_hue_range', 'hsl_sat', 'hsl_hue_shift']

    function gradeOf(effects) {
      const list = Array.isArray(effects) ? effects : []
      const index = list.findIndex(e => e && e.effect === 'lumetri')
      if (index < 0) return null
      const lum = list[index]
      const params = lum.params || {}
      // `index` lets the panel reset/remove exactly this effect instead of
      // guessing at a name that could match more than one entry.
      const out = { index: index, enabled: lum.enabled !== false }
      for (const k of GRADE_KEYS) {
        if (params[k] !== undefined) out[k] = parseVal(params[k].value)
      }
      return out
    }

    function openProject(path) {
      const p = guardPath(path)
      const sq = cliJson(['--project', p, 'inspect', 'sequence'])
      const vtrack = (sq.video || [])[0] || {}
      const items = Array.isArray(vtrack.items) ? vtrack.items : []
      const settings = sq.settings || {}
      const clips = items.map((it) => ({
        clip: it.clip,
        item: it.item,
        name: it.name || '',
        label: it.label || '',
        start: (it.start || 0) / TICKS,
        dur: (it.duration || 0) / TICKS,
        end: (it.end || 0) / TICKS,
        sourceIn: (it.sourceIn || 0) / TICKS,
        sourceOut: (it.sourceOut || 0) / TICKS,
        startFrame: it.startFrame || 0,
        durationFrames: it.durationFrames || 0,
        speed: it.speed === undefined ? 1 : it.speed,
        enabled: it.enabled !== false,
        gainDb: it.gainDb || 0,
        grade: gradeOf(it.effects),
      }))
      const frames = clips.reduce((a, c) => a + c.durationFrames, 0)
      return {
        ok: true,
        path: p,
        name: sq.name || '',
        fps: settings.fps || null,
        width: settings.width || null,
        height: settings.height || null,
        duration: (sq.duration || 0) / TICKS,
        durationFrames: sq.durationFrames || frames,
        clipCount: clips.length,
        clips,
      }
    }

    // filmcraft-cli is one process per invocation, so its own undo stack is gone
    // by the time the next call starts.  Undo therefore works on file snapshots:
    // every apply copies the project aside first, and undo restores the newest.
    const SNAP_DIR = LOG_DIR + '\\snapshots'
    const SNAP_KEEP = 20

    function snapKey(project) { return project.replace(/[\\/:*?"<>|]/g, '_') }

    function snapshot(project) {
      try {
        if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true })
        const key = snapKey(project)
        const dest = SNAP_DIR + '\\' + key + '.' + Date.now() + '.fcproj'
        copyFileSync(project, dest)
        let all = readdirSync(SNAP_DIR).filter(n => n.indexOf(key + '.') === 0).sort()
        while (all.length > SNAP_KEEP) {
          const old = all.shift()
          try { rmSync(SNAP_DIR + '\\' + old, { force: true }) } catch (_) { }
        }
        return dest
      } catch (_) { return null }
    }

    function snapshotCount(project) {
      try { return readdirSync(SNAP_DIR).filter(n => n.indexOf(snapKey(project) + '.') === 0).length } catch (_) { return 0 }
    }

    function restoreSnapshot(project) {
      const key = snapKey(project)
      let all = []
      try { all = readdirSync(SNAP_DIR).filter(n => n.indexOf(key + '.') === 0).sort() } catch (_) { }
      if (all.length === 0) return { ok: false, error: '没有可撤销的备份（本次会话尚未改动过该工程）' }
      const latest = all[all.length - 1]
      copyFileSync(SNAP_DIR + '\\' + latest, project)
      try { rmSync(SNAP_DIR + '\\' + latest, { force: true }) } catch (_) { }
      return { ok: true, restored: latest, remaining: all.length - 1 }
    }

    function applyEdits(project, commands, save) {
      const p = guardPath(project)
      if (!Array.isArray(commands) || commands.length === 0) throw new Error('没有要执行的编辑操作')
      if (commands.length > 400) throw new Error('单次操作过多（上限 400）')
      const rejected = []
      const lines = []
      for (const c of commands) {
        const id = c && c.id
        if (typeof id !== 'string' || ALLOWED[id] !== 1) { rejected.push(String(id)); continue }
        lines.push(JSON.stringify({ id: id, params: c.params === undefined ? {} : c.params }))
      }
      if (lines.length === 0) throw new Error('没有允许执行的操作：' + rejected.join(', '))
      if (!existsSync(LOG_DIR)) { try { mkdirSync(LOG_DIR, { recursive: true }) } catch (_) { } }
      const script = LOG_DIR + '\\panel-edit.jsonl'
      writeFileSync(script, lines.join('\n') + '\n', 'utf8')
      // snapshot before touching the file, so the change can be taken back
      const snap = save === false ? null : snapshot(p)
      const args = ['--project', p, 'run', script, '--compact', '--keep-going']
      if (save !== false) args.push('--save')
      const r = cli(args, 300000)
      const results = r.out.trim().split('\n').map((l) => {
        try { return JSON.parse(l) } catch (_) { return null }
      }).filter(Boolean)
      const failed = results.filter(x => x && x.ok === false)
      return {
        ok: failed.length === 0 && r.code === 0,
        applied: results.length,
        failed: failed.length,
        rejected,
        snapshotted: snap !== null,
        undoDepth: snapshotCount(p),
        results: results.slice(-40),
        stderr: r.err ? r.err.trim().slice(0, 400) : '',
      }
    }

    function startExport(opts) {
      const p = guardPath(opts.project)
      const out = opts.out
      if (typeof out !== 'string' || !/\.(mp4|mov|mkv)$/i.test(out)) throw new Error('输出路径必须是 .mp4/.mov/.mkv')
      if (!existsSync(LOG_DIR)) { try { mkdirSync(LOG_DIR, { recursive: true }) } catch (_) { } }
      const log = LOG_DIR + '\\panel-export.log'
      const args = ['--project', p, 'export', out, '--preset', opts.preset || 'Match Source – Adaptive High Bitrate']
      if (Number.isFinite(Number(opts.start))) args.push('--start', String(opts.start))
      if (Number.isFinite(Number(opts.end))) args.push('--end', String(opts.end))
      if (opts.noAudio === true) args.push('--no-audio')
      const fd = openSync(log, 'a')
      const child = spawn(CLI, args, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
      child.unref()
      try { closeSync(fd) } catch (_) { }
      return { ok: true, pid: child.pid, out, log, args: args.slice(1) }
    }

    // ── 3. preview ──────────────────────────────────────────────────────────
    // `render` draws one graded Program frame to a still; `export` writes a
    // short proxy clip.  Both are decode-bound (≈1.2 s per frame, almost
    // independent of --scale), so results are cached on disk and keyed by the
    // project's mtime: edit the project and every key changes.
    const PREVIEW_DIR = (typeof process !== 'undefined' && process.env && process.env.FILMCRAFT_PREVIEW_DIR)
      ? process.env.FILMCRAFT_PREVIEW_DIR
      : LOG_DIR + '\\preview'
    const PREVIEW_KEEP = 120
    const PROXY_MAX_SECONDS = 20

    function previewDir() {
      if (!existsSync(PREVIEW_DIR)) { try { mkdirSync(PREVIEW_DIR, { recursive: true }) } catch (_) { } }
      return PREVIEW_DIR
    }

    // FNV-1a twice with different seeds; good enough to name cache files and
    // avoids pulling node:crypto into the injected import list.
    function cacheKey(parts) {
      const text = parts.join('|')
      let a = 0x811c9dc5, b = 0x01000193
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        a = Math.imul(a ^ c, 16777619) >>> 0
        b = Math.imul(b + c, 2246822519) >>> 0
      }
      return (a.toString(16) + b.toString(16)).padStart(16, '0')
    }

    function mediaUrl(name) { return harness.apiBase + '/media?name=' + encodeURIComponent(name) }

    function projectMtime(p) {
      try { return Math.round(statSync(p).mtimeMs) } catch (_) { return 0 }
    }

    function clampScale(v, d) {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return d
      return Math.min(1, Math.max(0.05, n))
    }

    function prunePreview() {
      try {
        const all = readdirSync(PREVIEW_DIR).filter(n => /\.(jpg|png|mp4)$/i.test(n))
        if (all.length <= PREVIEW_KEEP) return
        const stamped = all.map((n) => {
          let t = 0
          try { t = statSync(PREVIEW_DIR + '\\' + n).mtimeMs } catch (_) { }
          return { n, t }
        }).sort((x, y) => x.t - y.t)
        for (const f of stamped.slice(0, stamped.length - PREVIEW_KEEP)) {
          try { rmSync(PREVIEW_DIR + '\\' + f.n, { force: true }) } catch (_) { }
        }
      } catch (_) { }
    }

    function renderFrame(body) {
      const p = guardPath(body.project)
      if (!existsSync(p)) throw new Error('工程不存在：' + p)
      const seconds = Number(body.seconds)
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('时间点无效')
      const scale = clampScale(body.scale, 0.25)
      const t = Math.round(seconds * 1000) / 1000
      // `render` always writes PNG whatever the extension says, so name it
      // honestly — declaring image/jpeg over PNG bytes is a lie the browser
      // only tolerates because it sniffs.
      const name = 'f_' + cacheKey([p, projectMtime(p), String(t), String(scale)]) + '.png'
      const out = previewDir() + '\\' + name
      if (existsSync(out)) {
        return { ok: true, cached: true, name, url: mediaUrl(name), bytes: statSync(out).size, seconds: t, scale }
      }
      const t0 = Date.now()
      const r = cli(['--project', p, 'render', '--seconds', String(t), '--out', out, '--scale', String(scale)], 180000)
      if (!existsSync(out)) {
        throw new Error('渲染失败：' + (r.err || r.out || '未知错误').trim().slice(0, 300))
      }
      prunePreview()
      return { ok: true, cached: false, name, url: mediaUrl(name), bytes: statSync(out).size, seconds: t, scale, ms: Date.now() - t0 }
    }

    function exportProxy(body) {
      const p = guardPath(body.project)
      if (!existsSync(p)) throw new Error('工程不存在：' + p)
      const start = Number(body.start)
      const end = Number(body.end)
      if (!Number.isFinite(start) || start < 0) throw new Error('起始时间无效')
      if (!Number.isFinite(end) || end <= start) throw new Error('结束时间必须晚于起始时间')
      if (end - start > PROXY_MAX_SECONDS) throw new Error('预览片段最长 ' + PROXY_MAX_SECONDS + ' 秒')
      const scale = clampScale(body.scale, 0.25)
      const quality = Math.min(90, Math.max(20, Number(body.quality) || 60))
      const name = 'p_' + cacheKey([p, projectMtime(p), start.toFixed(3), end.toFixed(3), String(scale), String(quality)]) + '.mp4'
      const out = previewDir() + '\\' + name
      if (existsSync(out)) {
        return { ok: true, cached: true, name, url: mediaUrl(name), bytes: statSync(out).size, seconds: end - start }
      }
      const t0 = Date.now()
      const r = cli(['--project', p, 'export', out, '--format', 'h264',
        '--start', String(start), '--end', String(end),
        '--scale', String(scale), '--quality', String(quality), '--no-audio'], 600000)
      if (!existsSync(out)) {
        throw new Error('导出失败：' + (r.err || r.out || '未知错误').trim().slice(0, 300))
      }
      prunePreview()
      return { ok: true, cached: false, name, url: mediaUrl(name), bytes: statSync(out).size, seconds: end - start, ms: Date.now() - t0 }
    }

    // Binary read for <img>/<video>.  Only basenames inside PREVIEW_DIR are
    // reachable — no separators, no traversal — and Range is honoured so the
    // browser can seek the proxy clip.
    function serveMedia(req, res) {
      const raw = String(req.url || '')
      const q = raw.indexOf('?')
      const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '')
      const name = params.get('name') || ''
      if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || name.indexOf('..') >= 0) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ error: '文件名非法' }))
      }
      const full = previewDir() + '\\' + name
      let size = 0
      try {
        const s = statSync(full)
        if (!s.isFile()) throw new Error('not a file')
        size = s.size
      } catch (_) {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ error: '文件不存在' }))
      }
      const type = /\.mp4$/i.test(name) ? 'video/mp4' : (/\.png$/i.test(name) ? 'image/png' : 'image/jpeg')
      const range = req.headers ? req.headers.range : null
      const m = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
      if (m !== null) {
        let from = m[1] === '' ? null : Number(m[1])
        let to = m[2] === '' ? null : Number(m[2])
        if (from === null && to !== null) { from = Math.max(0, size - to); to = size - 1 }
        if (from === null) from = 0
        if (to === null || to >= size) to = size - 1
        if (from > to || from >= size) {
          res.writeHead(416, { 'content-range': 'bytes */' + size })
          return res.end()
        }
        const buf = readFileSync(full).subarray(from, to + 1)
        res.writeHead(206, {
          'content-type': type,
          'content-length': String(buf.length),
          'content-range': 'bytes ' + from + '-' + to + '/' + size,
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=600',
        })
        return res.end(buf)
      }
      const buf = readFileSync(full)
      res.writeHead(200, {
        'content-type': type,
        'content-length': String(buf.length),
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=600',
      })
      res.end(buf)
    }

    // filmcraft-cli is one process per call, and concurrent runs against the
    // same project have produced corrupt output before.  The panel opens a
    // project and immediately wants both a thumbnail strip and a preview, so
    // preview work is serialised here rather than trusting callers to be polite.
    let previewChain = Promise.resolve()
    function previewLock(fn) {
      const run = previewChain.then(fn, fn)
      previewChain = run.then(() => { }, () => { })
      return run
    }

    harness.handle('edit.projects', () => ({ ok: true, roots: ROOTS, exportDir: EXPORT_DIR, projects: scanProjects() }))
    harness.handle('edit.open', (body) => openProject(body.path))
    harness.handle('edit.apply', (body) => applyEdits(body.project, body.commands, body.save))
    harness.handle('edit.undo', (body) => restoreSnapshot(guardPath(body.project)))
    harness.handle('edit.export', (body) => startExport(body))
    harness.handle('edit.frame', (body) => previewLock(() => renderFrame(body)))
    harness.handle('edit.proxy', (body) => previewLock(() => exportProxy(body)))
    harness.handle('edit.media', (req, res) => serveMedia(req, res))

    harness.registerTool(ctx, harness.defineTool({
      name: 'filmcraft_edit',
      description: '对 FilmCraft 工程做基础剪辑：列出/打开工程、查看片段、修剪入出点、删除、移动、套调色、撤销、导出。action=projects|open|apply|undo|export|frame|proxy。frame/proxy 会把画面渲染成文件，供预览。',
      parameters: {
        action: { type: 'string', description: 'projects=列出工程, open=打开并查看片段, apply=执行编辑, undo=撤销上一次编辑, export=导出, frame=渲染一帧画面, proxy=导出短预览片段', required: true },
        project: { type: 'string', description: 'open/apply/export/frame/proxy：.fcproj 工程路径' },
        commands: { type: 'array', description: 'apply：[{id,params}] 形式的命令，仅限白名单（timeline.trim / edit.rippleDelete / timeline.move / effects.setParam 等）', items: { type: 'object', additionalProperties: true } },
        out: { type: 'string', description: 'export：输出文件路径' },
        start: { type: 'number', description: 'export/proxy：起始秒' },
        end: { type: 'number', description: 'export/proxy：结束秒' },
        preset: { type: 'string', description: 'export：导出预设名' },
        seconds: { type: 'number', description: 'frame：渲染哪一秒的画面（时间轴秒数）' },
        scale: { type: 'number', description: 'frame/proxy：缩放比例，0.05–1，默认 0.25' },
        quality: { type: 'number', description: 'proxy：H.264 质量 20–90，默认 60' },
      },
      output: {
        schema: { type: 'json' },
        render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      },
      async execute(args) {
        const action = args && args.action
        if (action === 'projects') return { ok: true, roots: ROOTS, exportDir: EXPORT_DIR, projects: scanProjects() }
        if (action === 'open') return openProject(args.project)
        if (action === 'apply') return applyEdits(args.project, args.commands, true)
        if (action === 'undo') return restoreSnapshot(guardPath(args.project))
        if (action === 'export') return startExport(args)
        if (action === 'frame') return renderFrame(args)
        if (action === 'proxy') return exportProxy(args)
        throw new Error('action 必须是 projects|open|apply|undo|export|frame|proxy')
      },
    }))
  },
}
