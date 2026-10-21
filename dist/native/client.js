window.__ModuleLoader__.load({
  id: 'dsh-filmcraft-progress',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var styles = {
      insert: function (css) {
        var element = document.createElement('style')
        element.setAttribute('data-dsh-filmcraft-progress', '')
        element.textContent = css
        document.head.appendChild(element)
        return function () { element.remove() }
      },
    }
    var routes = {
        'state.read': ['GET', '/dsh-filmcraft-progress/api/state'],
        'workspace.read': ['GET', '/dsh-filmcraft-progress/api/workspace'],
        'workspace.write': ['POST', '/dsh-filmcraft-progress/api/workspace'],
        'projects.list': ['GET', '/dsh-filmcraft-progress/api/projects'],
        'projects.write': ['POST', '/dsh-filmcraft-progress/api/projects'],
        'project.read': ['GET', '/dsh-filmcraft-progress/api/project'],
        'project.write': ['POST', '/dsh-filmcraft-progress/api/project'],
        'assets.read': ['GET', '/dsh-filmcraft-progress/api/assets'],
        'browse.read': ['GET', '/dsh-filmcraft-progress/api/browse'],
        'presets.write': ['POST', '/dsh-filmcraft-progress/api/presets'],
        'import.write': ['POST', '/dsh-filmcraft-progress/api/import'],
        'sequence.write': ['POST', '/dsh-filmcraft-progress/api/sequence'],
        'merge.write': ['POST', '/dsh-filmcraft-progress/api/merge'],
        'edit.write': ['POST', '/dsh-filmcraft-progress/api/edit'],
        'grade.write': ['POST', '/dsh-filmcraft-progress/api/grade'],
        'undo.write': ['POST', '/dsh-filmcraft-progress/api/undo'],
        'export.write': ['POST', '/dsh-filmcraft-progress/api/export'],
        'jobs.read': ['GET', '/dsh-filmcraft-progress/api/jobs'],
        'jobs.write': ['POST', '/dsh-filmcraft-progress/api/jobs'],
        'frame.read': ['POST', '/dsh-filmcraft-progress/api/frame'],
        'proxy.write': ['POST', '/dsh-filmcraft-progress/api/proxy'],
        'media.read': ['GET', '/dsh-filmcraft-progress/api/media'],
      }
    var host = {
      url: function (name, params) {
        var route = routes[name]
        if (route === undefined) throw new Error('unsupported call: ' + name)
        var query = ''
        if (params) {
          var parts = []
          for (var key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined && params[key] !== null) {
              parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
            }
          }
          if (parts.length > 0) query = '?' + parts.join('&')
        }
        return route[1] + query
      },
      call: async function (name, arg) {
        var route = routes[name]
        if (route === undefined) throw new Error('unsupported call: ' + name)
        var init = { cache: 'no-store' }
        if (route[0] === 'POST') {
          init.method = 'POST'
          init.headers = { 'content-type': 'application/json' }
          init.body = JSON.stringify(arg || {})
        } else if (arg) {
          var qs = []
          for (var k in arg) {
            if (Object.prototype.hasOwnProperty.call(arg, k) && arg[k] !== undefined && arg[k] !== null) {
              qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(arg[k]))
            }
          }
          if (qs.length > 0) init.cache = 'no-store'
        }
        var url = route[0] === 'POST' ? route[1] : host.url(name, arg)
        var response = await fetch(url, init)
        var value = await response.json()
        if (!response.ok) throw new Error(value && value.error ? value.error : 'request failed')
        return value
      },
      blob: async function (name, params) {
        var response = await fetch(host.url(name, params), { cache: "no-store" })
        if (!response.ok) {
          var text = await response.text()
          var message = '请求失败 (' + response.status + ')'
          try { var parsed = JSON.parse(text); if (parsed && parsed.error) message = parsed.error } catch (_) { }
          throw new Error(message)
        }
        return await response.blob()
      },
    }
    function createPlugin() {
    // ── 00-setup.js ──────────────────────────────────────────────────
    // ── setup ───────────────────────────────────────────────────────────────────
    // Entry point of the client half.
    //
    // `React`, `styles` and `host` are injected by scripts/build-native.mjs: every
    // module in src/client is concatenated into one `createPlugin()` body, so the
    // body must end by returning the plugin object (see 99-plugin.js) and nothing at
    // module top level may touch `ctx` — it does not exist there. That mistake is
    // what made the previous build fail the whole web boot with
    // "dsh-filmcraft-progress: import failed: ctx is not defined".
    //
    // The panel is a docked tab in the official right sidebar. The drawer is only a
    // fallback for a host that does not expose the sidebar services (or where the tab
    // id is already taken) — without it the panel would be unreachable.

    const h = React.createElement

    let sidebarReady = false
    let openTab = null
    let drawerOpen = false
    const drawerListeners = new Set()

    function setDrawerOpen(next) {
      drawerOpen = next
      const list = Array.from(drawerListeners)
      for (const listener of list) listener(next)
    }

    function useDrawerOpen() {
      const pair = React.useState(drawerOpen)
      React.useEffect(function () {
        drawerListeners.add(pair[1])
        return function () { drawerListeners.delete(pair[1]) }
      }, [])
      return pair[0]
    }

    function openPanel() {
      if (openTab !== null) {
        try { openTab(); return } catch (_) { }
      }
      setDrawerOpen(true)
    }

    function apply(ctx) {
      const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
      if (slots === undefined) return

      ctx.effect(function () { return styles.insert(fcCss()) })

      // The seat is declared before the sidebar services are ready, so poll briefly
      // instead of assuming the order.
      ctx.effect(function () {
        if (typeof slots.inject !== 'function') return function () { }
        return slots.inject('sidebar.right.pane.tab', function () {
          let disposed = false
          let poll = 0
          let off = null

          function attempt() {
            if (disposed) return
            const tabs = typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : undefined
            const ctrl = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
            if (!tabs || typeof tabs.register !== 'function' || !ctrl || typeof ctrl.openTab !== 'function') {
              poll = setTimeout(attempt, 300)
              return
            }
            let disposeTabs = null
            let disposeBody = null
            try {
              disposeTabs = tabs.register({
                id: FC_TAB_ID,
                kind: FC_TAB_KIND,
                keepMounted: true,
                title: function () { return FC_TAB_TITLE },
                guide: [{
                  id: 'filmcraft',
                  order: 120,
                  title: function () { return FC_TAB_TITLE },
                  description: function () { return 'FilmCraft 剪辑、调色与导出' },
                  icon: FcIcon,
                }],
              })
              disposeBody = slots.register(
                { name: 'sidebar.right.pane.tab', key: FC_TAB_ID },
                function () { return h(Panel, null) },
              )
            } catch (_) {
              try { if (disposeTabs) disposeTabs() } catch (e) { }
              try { if (disposeBody) disposeBody() } catch (e) { }
              return
            }
            sidebarReady = true
            openTab = function () {
              try { ctrl.openTab(FC_TAB_KIND) } catch (_) { setDrawerOpen(true) }
            }
            off = function () {
              try { disposeBody() } catch (e) { }
              try { disposeTabs() } catch (e) { }
              sidebarReady = false
              openTab = null
            }
          }

          attempt()
          return function () {
            disposed = true
            if (poll) clearTimeout(poll)
            if (off) off()
          }
        })
      })

      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'filmcraft-progress', order: 13, label: FC_TAB_TITLE },
          function () { return h(Panel, { wide: true }) })
      })

      // Mount point for the fallback drawer. It renders nothing when the official
      // tab registered, so the normal case never draws over the main UI.
      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'filmcraft-progress', order: 6, label: FC_TAB_TITLE },
          function () { return sidebarReady ? null : h(Drawer, null) })
      })

      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'filmcraft-progress', order: 91, label: FC_TAB_TITLE },
          FooterAction)
      })
    }

    // ── 10-store.js ──────────────────────────────────────────────────
    // ── store ───────────────────────────────────────────────────────────────────
    // One store for the whole client half: the panel, the footer status and the
    // fallback drawer all read it. It holds no React state, so every action below is
    // testable without a renderer — `fcEmit()` is the only bridge to the views.
    //
    // The server is the source of truth. Nothing here caches a project or a job:
    // each mutation returns the fresh detail (the host re-reads it), and the store
    // just adopts it. That is what keeps the panel honest after an edit — there is
    // no second copy of the timeline to drift out of date.

    const TICKS = 254016000000
    const PROXY_MAX = 20

    const store = {
      booted: false,
      mounted: false,
      workspace: null,
      projects: [],
      detail: null,
      projectId: '',
      jobs: [],
      legacy: null,
      tab: 'projects',
      clipId: null,
      scrub: 0,
      frameUrl: '',
      frameError: '',
      frameBusy: false,
      frameQueued: null,
      proxyUrl: '',
      proxyError: '',
      proxyBusy: false,
      proxySeconds: 3,
      prevOpen: true,
      out: '',
      format: 'h264',
      scale: 1,
      busy: '',
      error: '',
      notice: '',
      version: 0,
      listeners: new Set(),
      pollTimer: null,
      scrubTimer: null,
      noticeTimer: null,
    }

    function fcEmit() {
      store.version += 1
      const list = Array.from(store.listeners)
      for (const listener of list) {
        try { listener() } catch (_) { }
      }
    }

    function fcErr(error) {
      return error && error.message ? error.message : String(error)
    }

    function fcNotice(text) {
      store.notice = String(text || '')
      if (store.noticeTimer !== null) clearTimeout(store.noticeTimer)
      store.noticeTimer = setTimeout(function () {
        store.noticeTimer = null
        store.notice = ''
        fcEmit()
      }, 2600)
      fcEmit()
    }

    // ── formatting ──────────────────────────────────────────────────────────────
    function fcPad(n) { return String(n).padStart(2, '0') }
    function fcTime(sec) {
      if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—'
      const total = Math.round(sec * 10) / 10
      const minutes = Math.floor(total / 60)
      const rest = total - minutes * 60
      return minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(1)
    }
    function fcSeconds(sec) {
      if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—'
      return sec.toFixed(1) + 's'
    }
    function fcBytes(bytes) {
      const value = Number(bytes) || 0
      if (value <= 0) return '0 B'
      if (value < 1024) return value + ' B'
      if (value < 1048576) return (value / 1024).toFixed(1) + ' KB'
      if (value < 1073741824) return (value / 1048576).toFixed(1) + ' MB'
      return (value / 1073741824).toFixed(2) + ' GB'
    }
    function fcDuration(ms) {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      if (total < 60) return total + 's'
      const minutes = Math.floor(total / 60)
      const rest = total % 60
      if (minutes < 60) return minutes + 'm' + fcPad(rest) + 's'
      return Math.floor(minutes / 60) + 'h' + fcPad(minutes % 60) + 'm'
    }
    function fcAgo(iso) {
      const ms = Date.parse(iso)
      if (!isFinite(ms)) return ''
      const delta = Math.max(0, Date.now() - ms)
      if (delta < 60000) return Math.round(delta / 1000) + ' 秒前'
      if (delta < 3600000) return Math.round(delta / 60000) + ' 分钟前'
      if (delta < 86400000) return Math.round(delta / 3600000) + ' 小时前'
      return Math.round(delta / 86400000) + ' 天前'
    }
    // File names are the only thing that identifies two takes of the same shot, and
    // the panel column is ~30 characters wide, so keep the head and the tail.
    function fcShort(name, limit) {
      const text = String(name || '')
      const max = limit || 34
      if (text.length <= max) return text
      const keep = Math.floor((max - 1) / 2)
      return text.slice(0, keep) + '…' + text.slice(text.length - (max - keep - 1))
    }

    // ── lookups ─────────────────────────────────────────────────────────────────
    function fcProjectRef() {
      if (store.projectId) return store.projectId
      return store.detail ? store.detail.path : ''
    }
    function fcSequence() {
      return store.detail && store.detail.sequence ? store.detail.sequence : null
    }
    function fcClips() {
      const sequence = fcSequence()
      if (!sequence) return []
      return sequence.clips.filter(function (clip) { return clip.kind === 'video' })
    }
    function fcSelectedClip() {
      const clips = fcClips()
      for (const clip of clips) if (clip.clip === store.clipId) return clip
      return null
    }
    function fcPreset(id) {
      const presets = store.workspace && Array.isArray(store.workspace.presets) ? store.workspace.presets : []
      for (const preset of presets) if (preset.id === id) return preset
      return null
    }
    // The engine's colour effect is called `lumetri`; the presets are only parameter
    // values on it. "Has a grade" therefore means "carries that effect", not "carries
    // one of our four recipes".
    function fcHasGrade(clip) {
      if (!clip || !Array.isArray(clip.effects)) return false
      for (const effect of clip.effects) {
        if (String(effect.effect).toLowerCase() === 'lumetri') return true
      }
      return false
    }
    function fcRunningJobs() {
      return store.jobs.filter(function (job) { return job.state === 'running' })
    }

    // ── request helper ──────────────────────────────────────────────────────────
    // Every write goes through here so there is exactly one place that clears the
    // previous error, one place that formats a failure, and one busy flag the views
    // can disable buttons with.
    async function fcRun(label, fn) {
      store.busy = label || ''
      store.error = ''
      fcEmit()
      try {
        return await fn()
      } catch (error) {
        store.error = (label ? label + '：' : '') + fcErr(error)
        return null
      } finally {
        store.busy = ''
        fcEmit()
      }
    }

    // ── data ────────────────────────────────────────────────────────────────────
    async function fcRefreshJobs() {
      const result = await host.call('jobs.read', {})
      store.jobs = result && Array.isArray(result.jobs) ? result.jobs : []
      fcEmit()
    }

    async function fcBoot() {
      if (store.booted) return
      store.booted = true
      await fcRun('加载工作区', async function () {
        store.workspace = await host.call('workspace.read', {})
        const list = await host.call('projects.list', {})
        store.projects = list && Array.isArray(list.projects) ? list.projects : []
      })
      try { store.legacy = await host.call('state.read', {}) } catch (_) { store.legacy = null }
      try { await fcRefreshJobs() } catch (_) { }
      fcEmit()
    }

    function fcDropUrls() {
      if (store.frameUrl) { try { URL.revokeObjectURL(store.frameUrl) } catch (_) { } }
      if (store.proxyUrl) { try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { } }
      store.frameUrl = ''
      store.proxyUrl = ''
    }

    function fcSetDetail(detail, options) {
      const keep = !!(options && options.keep)
      fcDropUrls()
      store.detail = detail || null
      store.projectId = detail && detail.projectId ? detail.projectId : ''
      if (!keep) store.scrub = 0
      // Clip ids are only meaningful inside one project, so a multi-select carried
      // across a project switch would silently point at the wrong clips.
      store.multi = []
      const clips = fcClips()
      let found = false
      for (const clip of clips) if (clip.clip === store.clipId) found = true
      if (!found) store.clipId = clips.length > 0 ? clips[0].clip : null
      fcEmit()
      // Every detail read is a chance that the picture changed (an edit, a sequence
      // switch, a different project). Refreshing it here keeps the preview honest
      // without the views needing to watch mtimes.
      if (store.prevOpen) {
        const clip = fcSelectedClip()
        if (clip && store.detail && store.detail.sequence) fcFrame(clip.start + store.scrub)
      }
    }

    async function fcOpenProject(id) {
      if (!id) return
      const detail = await fcRun('打开工程', function () {
        return host.call('project.read', { project: id })
      })
      if (detail) {
        fcSetDetail(detail)
        fcNotice('已打开「' + (detail.name || detail.projectName || '') + '」')
        fcRefreshAssets().catch(function () { })
      }
    }

    async function fcRefreshProject() {
      if (!store.detail) return
      const detail = await fcRun('刷新工程', function () {
        return host.call('project.read', { project: store.detail.path, force: true })
      })
      if (detail) fcSetDetail(detail, { keep: true })
    }

    async function fcScan() {
      const result = await fcRun('扫描工程', function () {
        return host.call('projects.list', { rescan: true })
      })
      if (!result) return
      store.projects = result.projects || []
      const found = Array.isArray(result.scanned) ? result.scanned.length : 0
      fcNotice('扫描到 ' + found + ' 个工程文件，列表里 ' + store.projects.length + ' 个')
    }

    async function fcNewSequence() {
      if (!store.detail) return
      const sequence = fcSequence()
      const body = {
        action: 'create',
        project: fcProjectRef(),
        name: '序列 ' + (store.detail.sequences ? store.detail.sequences.length + 1 : 1),
        width: sequence && sequence.width ? sequence.width : 1920,
        height: sequence && sequence.height ? sequence.height : 1080,
        fps: sequence && sequence.fps ? sequence.fps : 23.976,
      }
      const result = await fcRun('新建序列', function () {
        return host.call('sequence.write', body)
      })
      if (result && result.detail) fcSetDetail(result.detail)
      if (result) fcNotice('已新建序列')
    }

    async function fcActivateSequence(id) {
      if (!store.detail) return
      const result = await fcRun('切换序列', function () {
        return host.call('project.write', { action: 'activate', project: fcProjectRef(), sequence: id })
      })
      if (result && result.detail) fcSetDetail(result.detail)
    }

    // ── editing ─────────────────────────────────────────────────────────────────
    async function fcEdit(commands, label) {
      const result = await fcRun(label, function () {
        return host.call('edit.write', { project: fcProjectRef(), commands: commands })
      })
      if (!result) return null
      if (result.detail) fcSetDetail(result.detail, { keep: true })
      const failed = Array.isArray(result.failed) ? result.failed : []
      if (failed.length > 0) {
        store.error = label + '失败：' + failed[0].error
        fcEmit()
      } else {
        fcNotice(label + '完成')
      }
      return result
    }

    function fcTrim(edge, deltaSec) {
      const clip = fcSelectedClip()
      if (!clip) return
      const delta = Math.round(deltaSec * TICKS)
      fcEdit([{ id: 'timeline.trim', params: { clip: clip.clip, edge: edge, mode: 'ripple', delta: delta } }],
        (edge === 'in' ? '裁头 ' : '裁尾 ') + (deltaSec > 0 ? '+' : '') + deltaSec + 's ')
    }

    function fcDeleteClip() {
      const clip = fcSelectedClip()
      if (!clip) return
      fcEdit([{ id: 'edit.rippleDelete', params: { clips: [clip.clip] } }], '删除片段 ')
    }

    function fcMoveClip(dir) {
      const clip = fcSelectedClip()
      if (!clip) return
      const clips = fcClips()
      const index = clips.indexOf(clip)
      const next = clips[dir < 0 ? index - 1 : index + 1]
      if (!next) return
      // Swap by moving each clip to the other's start time. Two commands, one
      // snapshot: the host treats the batch as a single undo step.
      fcEdit([
        { id: 'timeline.move', params: { moves: [{ clip: clip.clip, track: clip.track, time: Math.round(next.start * TICKS) }] } },
        { id: 'timeline.move', params: { moves: [{ clip: next.clip, track: next.track, time: Math.round(clip.start * TICKS) }] } },
      ], dir < 0 ? '上移 ' : '下移 ')
    }

    function fcToggleClip() {
      const clip = fcSelectedClip()
      if (!clip) return
      fcEdit([{ id: 'clip.enable', params: { clips: [clip.clip] } }], clip.enabled ? '停用片段 ' : '启用片段 ')
    }

    async function fcApplyGrade(presetId) {
      const clip = fcSelectedClip()
      if (!clip || !presetId) return
      const preset = fcPreset(presetId)
      const result = await fcRun('套用调色', function () {
        return host.call('grade.write', { project: fcProjectRef(), clips: [clip.clip], preset: presetId })
      })
      if (!result) return
      if (result.detail) fcSetDetail(result.detail, { keep: true })
      const failed = Array.isArray(result.failed) ? result.failed : []
      if (failed.length > 0) {
        store.error = '套用调色失败：' + failed[0].error
        fcEmit()
        return
      }
      fcNotice('已套用「' + (preset ? preset.name : presetId) + '」')
    }

    async function fcClearGrade() {
      const clip = fcSelectedClip()
      if (!clip) return
      const result = await fcRun('清空调色', function () {
        return host.call('grade.write', { project: fcProjectRef(), clips: [clip.clip], clear: true })
      })
      if (result && result.detail) fcSetDetail(result.detail, { keep: true })
      if (result) fcNotice('已清空调色')
    }

    async function fcUndo() {
      if (!store.detail) return
      const result = await fcRun('撤销', function () {
        return host.call('undo.write', { project: fcProjectRef() })
      })
      if (result && result.detail) {
        fcSetDetail(result.detail, { keep: true })
        fcNotice('已撤销一步')
      }
    }

    // ── preview ─────────────────────────────────────────────────────────────────
    async function fcFrame(seconds) {
      if (!store.detail || !fcSequence()) return
      if (store.frameBusy) { store.frameQueued = seconds; return }
      store.frameBusy = true
      store.frameError = ''
      fcEmit()
      try {
        const result = await host.call('frame.read', { project: fcProjectRef(), seconds: seconds, scale: 0.25 })
        const blob = await host.blob('media.read', { name: result.name })
        const url = URL.createObjectURL(blob)
        if (store.frameUrl) { try { URL.revokeObjectURL(store.frameUrl) } catch (_) { } }
        store.frameUrl = url
      } catch (error) {
        store.frameError = fcErr(error)
      } finally {
        store.frameBusy = false
        fcEmit()
        if (store.frameQueued !== null) {
          const next = store.frameQueued
          store.frameQueued = null
          fcFrame(next)
        }
      }
    }

    // Scrubbing should not spawn one render process per pixel. 400 ms after the last
    // move is slow enough to coalesce a drag and fast enough to feel immediate.
    function fcScrub(seconds) {
      store.scrub = Math.max(0, Number(seconds) || 0)
      fcEmit()
      if (!store.prevOpen) return
      if (store.scrubTimer !== null) clearTimeout(store.scrubTimer)
      store.scrubTimer = setTimeout(function () {
        store.scrubTimer = null
        const clip = fcSelectedClip()
        if (clip) fcFrame(clip.start + store.scrub)
      }, 400)
    }

    async function fcProxy() {
      const clip = fcSelectedClip()
      if (!clip || store.proxyBusy) return
      const span = Math.max(0.5, Math.min(store.proxySeconds, PROXY_MAX, clip.dur - store.scrub))
      store.proxyBusy = true
      store.proxyError = ''
      fcEmit()
      try {
        const result = await host.call('proxy.write', {
          project: fcProjectRef(),
          start: clip.start + store.scrub,
          seconds: span,
          scale: 0.5,
          quality: 60,
        })
        const blob = await host.blob('media.read', { name: result.name })
        const url = URL.createObjectURL(blob)
        if (store.proxyUrl) { try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { } }
        store.proxyUrl = url
        fcNotice('预览片段已生成（' + span.toFixed(1) + 's）')
      } catch (error) {
        store.proxyError = fcErr(error)
      } finally {
        store.proxyBusy = false
        fcEmit()
      }
    }

    function fcWholeClip() {
      const clip = fcSelectedClip()
      if (!clip) return
      store.proxySeconds = Math.max(0.5, Math.min(clip.dur, PROXY_MAX))
      fcScrub(0)
      fcEmit()
    }

    // ── export ──────────────────────────────────────────────────────────────────
    async function fcExport() {
      if (!store.detail) return
      const body = { project: fcProjectRef(), format: store.format, scale: store.scale }
      if (store.detail.activeSequence !== null && store.detail.activeSequence !== undefined) body.sequence = store.detail.activeSequence
      if (store.out) body.out = store.out
      const result = await fcRun('开始导出', function () {
        return host.call('export.write', body)
      })
      if (!result || !result.job) return
      store.tab = 'jobs'
      fcNotice('导出已开始')
      try { await fcRefreshJobs() } catch (_) { }
      fcEmit()
    }

    async function fcJobAction(action, id) {
      const result = await fcRun(action === 'cancel' ? '取消任务' : '移除任务', function () {
        return host.call('jobs.write', { action: action, id: id })
      })
      if (!result) return
      try { await fcRefreshJobs() } catch (_) { }
    }

    // Polling exists only while a job is in flight: the host samples the output file
    // on read, so there is nothing to gain from asking when nothing is running.
    function fcEnsurePolling() {
      if (store.pollTimer !== null) return
      store.pollTimer = setInterval(function () {
        if (!store.mounted) return
        if (fcRunningJobs().length === 0) return
        fcRefreshJobs().catch(function () { })
      }, 1500)
    }

    function fcSet(patch) {
      for (const key of Object.keys(patch)) store[key] = patch[key]
      fcEmit()
    }

    // ── 15-actions.js ────────────────────────────────────────────────
    // ── actions: projects, media, merge, presets, settings ──────────────────────
    // Second layer of the store. 10-store.js covers "one open project, one selected
    // clip"; this module covers everything that needs to look across projects or
    // create one — which is what makes the panel usable for more than the single
    // project it was originally written for.
    //
    // Every action follows the fcRun convention: one busy label, one error slot, and
    // a notice on success, so the views never manage their own loading state.

    Object.assign(store, {
      // A directory listing for the media picker. Kept separate from `assets`
      // because browsing is a filesystem view and assets is a project view.
      browse: { path: '', parent: '', dirs: [], files: [], projects: [] },
      browseOpen: false,
      // Media currently staged for merge or import (absolute paths, in chosen order).
      staging: [],
      multi: [],
      merge: {
        name: '',
        createName: '',
        createDir: '',
        exportAfter: false,
        settings: null,
        compat: null,
        result: null,
        tabs: 'staging',
      },
      settings: { root: '', cliPath: '', scanDepth: 4, open: false },
      assets: [],
      presets: [],
    })

    // fcErr() only formats a thrown value; it does not touch the store. Validation
    // failures need the error slot filled, so they go through this instead.
    function fcFail(text) {
      store.error = String(text || '')
      fcEmit()
    }

    function fcStagingIndex(path) {
      for (let i = 0; i < store.staging.length; i += 1) if (store.staging[i] === path) return i
      return -1
    }

    function fcStage(path) {
      if (!path) return
      if (fcStagingIndex(path) >= 0) { fcNotice('已经在待合并列表里'); return }
      store.staging.push(path)
      fcEmit()
    }

    function fcUnstage(path) {
      store.staging = store.staging.filter(function (entry) { return entry !== path })
      fcEmit()
    }

    function fcUnstageAll() {
      store.staging = []
      fcEmit()
    }

    // Reordering is the whole point of a merge UI, so both directions are explicit
    // rather than a drag handle — the panel is too narrow for reliable dragging.
    function fcStageMove(path, dir) {
      const index = fcStagingIndex(path)
      const next = index + (dir < 0 ? -1 : 1)
      if (index < 0 || next < 0 || next >= store.staging.length) return
      const list = store.staging.slice()
      const swapped = list[index]
      list[index] = list[next]
      list[next] = swapped
      store.staging = list
      fcEmit()
    }

    // ── browse ──────────────────────────────────────────────────────────────────
    async function fcBrowse(path) {
      const result = await fcRun('读取目录', function () {
        return host.call('browse.read', { path: path || store.browse.path || '' })
      })
      if (!result) return
      store.browse = {
        path: result.path || '',
        parent: result.parent || '',
        dirs: Array.isArray(result.dirs) ? result.dirs : [],
        files: Array.isArray(result.files) ? result.files : [],
        projects: Array.isArray(result.projects) ? result.projects : [],
      }
      store.browseOpen = true
      fcEmit()
    }

    function fcBrowseUp() {
      if (store.browse.parent) fcBrowse(store.browse.parent)
    }

    // ── project registry (multi-project) ────────────────────────────────────────
    async function fcProjectAdd(file, name) {
      const body = { action: 'add', file: file }
      if (name) body.name = name
      const result = await fcRun('登记工程', function () {
        return host.call('projects.write', body)
      })
      if (!result) return null
      store.projects = result.projects || store.projects
      fcNotice('已登记 ' + (result.project ? result.project.name : file))
      if (result.project) await fcOpenProject(result.project.id)
      return result
    }

    async function fcProjectRemove(id) {
      const result = await fcRun('移除工程', function () {
        return host.call('projects.write', { action: 'remove', project: id })
      })
      if (!result) return
      store.projects = result.projects || []
      if (store.detail && store.projectId === id) fcSetDetail(null)
      fcNotice('已从列表移除（文件本身没动）')
    }

    async function fcProjectRename(id, name) {
      if (!name) return
      const result = await fcRun('重命名工程', function () {
        return host.call('projects.write', { action: 'rename', project: id, name: name })
      })
      if (!result) return
      store.projects = result.projects || []
      fcNotice('已重命名')
    }

    async function fcRescan() {
      const result = await fcRun('重新扫描', function () {
        return host.call('projects.write', { action: 'rescan' })
      })
      if (!result) return
      store.projects = result.projects || []
      const found = Array.isArray(result.scanned) ? result.scanned.length : 0
      fcNotice('扫描到 ' + found + ' 个 .fcproj')
    }

    async function fcProjectCreate(file, name) {
      // A project cannot be created out of nothing by this engine: the CLI refuses a
      // path that does not exist yet. `--empty import … --save-as` is the documented
      // way to make one, so creating a project is always "create + import".
      const result = await fcRun('新建工程', function () {
        return host.call('projects.write', { action: 'add', file: file, name: name, create: true })
      })
      if (!result) return null
      store.projects = result.projects || store.projects
      if (result.project) await fcOpenProject(result.project.id)
      return result
    }

    // ── media ───────────────────────────────────────────────────────────────────
    async function fcRefreshAssets() {
      if (!store.detail) return
      const result = await fcRun('读取素材', function () {
        return host.call('assets.read', { project: fcProjectRef() })
      })
      if (!result) return
      store.assets = Array.isArray(result.assets) ? result.assets : []
      fcEmit()
    }

    // Importing adds files to the project bin without touching the timeline. Placing
    // them is a separate intent, so it stays a separate button.
    async function fcImport(files) {
      const list = (files || store.staging).slice()
      if (list.length === 0) { fcFail('请先选素材'); return null }
      if (!store.detail) { fcFail('先打开一个工程'); return null }
      const result = await fcRun('导入素材 ' + list.length + ' 个', function () {
        return host.call('import.write', { project: fcProjectRef(), files: list })
      })
      if (!result) return null
      if (result.detail) fcSetDetail(result.detail, { keep: true })
      else await fcRefreshAssets()
      const errors = Array.isArray(result.errors) ? result.errors : []
      if (errors.length > 0) {
        store.error = '部分导入失败：' + (errors[0].error || errors[0])
        fcEmit()
      } else {
        fcNotice('已导入 ' + list.length + ' 个素材')
      }
      return result
    }

    async function fcPlaceStaging(options) {
      const list = (options && options.files ? options.files : store.staging).slice()
      if (list.length === 0) { fcFail('请先选素材'); return null }
      if (!store.detail) { fcFail('先打开一个工程'); return null }
      const sequence = fcSequence()
      const body = {
        project: fcProjectRef(),
        files: list,
        place: true,
        insert: options && options.insert === true,
        name: (options && options.name) || '序列 ' + ((store.detail.sequences || []).length + 1),
        width: sequence && sequence.width ? sequence.width : 1920,
        height: sequence && sequence.height ? sequence.height : 1080,
        fps: sequence && sequence.fps ? sequence.fps : 25,
      }
      const result = await fcRun('放置 ' + list.length + ' 段', function () {
        return host.call('import.write', body)
      })
      if (!result) return null
      if (result.detail) fcSetDetail(result.detail)
      fcNotice('已按顺序放到时间线')
      return result
    }

    // ── merge ───────────────────────────────────────────────────────────────────
    async function fcMergeRun(options) {
      const request = options || {}
      const sources = store.staging.map(function (file) { return { file: file } })
      if (sources.length === 0) { fcFail('待合并列表是空的'); return null }
      const body = {
        sources: sources,
        name: request.name || store.merge.name || '合并序列',
      }
      if (request.createName) {
        body.create = { name: request.createName, dir: store.merge.createDir || undefined, overwrite: request.overwrite === true }
      } else if (store.merge.createName) {
        body.create = { name: store.merge.createName, dir: store.merge.createDir || undefined, overwrite: request.overwrite === true }
      } else {
        if (!store.detail) { fcFail('要么打开一个工程，要么填一个新工程名'); return null }
        body.project = fcProjectRef()
      }
      if (store.merge.settings) body.settings = store.merge.settings
      if (store.merge.exportAfter) {
        body.export = { scale: store.scale }
      }
      const result = await fcRun('合并 ' + sources.length + ' 段素材', function () {
        return host.call('merge.write', body)
      })
      if (!result) return null
      store.merge.result = result
      store.merge.compat = result.compat || null
      const list = await host.call('projects.list', {})
      store.projects = list && Array.isArray(list.projects) ? list.projects : store.projects
      if (result.detail) fcSetDetail(result.detail)
      if (result.job) {
        store.tab = 'jobs'
        fcNotice('合并完成，已开始导出')
        fcRefreshJobs().catch(function () { })
      } else {
        fcNotice('合并完成：' + (result.sequence ? result.sequence.name : '新序列') + ' · ' + sources.length + ' 段')
      }
      fcEmit()
      return result
    }

    // Merging into a brand-new project is the common case when the sources are not
    // already part of anything, so the default name comes from the first file.
    function fcMergeDefaultName() {
      if (store.staging.length === 0) return ''
      const first = store.staging[0].split(/[\\/]/).pop() || ''
      const stem = first.replace(/\.[^.]+$/, '')
      return store.staging.length === 1 ? stem : stem + ' 等 ' + store.staging.length + ' 段'
    }

    // ── export extras ───────────────────────────────────────────────────────────
    async function fcInterchange(format) {
      if (!store.detail) return
      const result = await fcRun('导出 ' + String(format).toUpperCase(), function () {
        return host.call('project.write', {
          action: 'exportInterchange',
          project: fcProjectRef(),
          format: format,
          sequence: store.detail.activeSequence,
        })
      })
      if (!result) return
      fcNotice('已导出 ' + result.format + '：' + result.out.split(/[\\/]/).pop())
    }

    // ── sequences ───────────────────────────────────────────────────────────────
    async function fcCreateSequence(options) {
      if (!store.detail) return null
      const sequence = fcSequence()
      const body = {
        action: 'create',
        project: fcProjectRef(),
        name: (options && options.name) || '序列 ' + ((store.detail.sequences || []).length + 1),
        width: (options && options.width) || (sequence && sequence.width) || 1920,
        height: (options && options.height) || (sequence && sequence.height) || 1080,
        fps: (options && options.fps) || (sequence && sequence.fps) || 25,
      }
      const result = await fcRun('新建序列', function () {
        return host.call('sequence.write', body)
      })
      if (result && result.detail) fcSetDetail(result.detail)
      if (result) fcNotice('已新建序列')
      return result
    }

    async function fcDeleteSequence(id) {
      const result = await fcRun('删除序列', function () {
        return host.call('sequence.write', { action: 'delete', project: fcProjectRef(), sequence: id })
      })
      if (result && result.detail) fcSetDetail(result.detail)
      if (result) fcNotice('已删除序列')
    }

    async function fcRenameSequence(id, name) {
      if (!name) return
      const result = await fcRun('重命名序列', function () {
        return host.call('sequence.write', { action: 'rename', project: fcProjectRef(), sequence: id, name: name })
      })
      if (result && result.detail) fcSetDetail(result.detail)
      if (result) fcNotice('已重命名')
    }

    // ── presets ─────────────────────────────────────────────────────────────────
    async function fcPresetSave(preset) {
      const result = await fcRun('保存预设', function () {
        return host.call('presets.write', { action: 'save', preset: preset })
      })
      if (!result) return null
      store.workspace = Object.assign({}, store.workspace, { presets: result.presets })
      fcNotice('已保存预设「' + (result.preset ? result.preset.name : '') + '」')
      return result
    }

    async function fcPresetRemove(id) {
      const result = await fcRun('删除预设', function () {
        return host.call('presets.write', { action: 'remove', id: id })
      })
      if (!result) return
      store.workspace = Object.assign({}, store.workspace, { presets: result.presets })
      fcNotice('已删除预设')
    }

    // ── settings ────────────────────────────────────────────────────────────────
    async function fcSetRoot(root) {
      const result = await fcRun('切换工作区', function () {
        return host.call('workspace.write', { action: 'setRoot', root: root })
      })
      if (!result) return
      store.workspace = result.workspace || store.workspace
      store.projects = result.projects || []
      fcSetDetail(null)
      fcNotice('工作区已切换到 ' + (result.workspace ? result.workspace.rootDisplay : root))
    }

    async function fcSetCli(cliPath) {
      const result = await fcRun('设置 CLI 路径', function () {
        return host.call('workspace.write', { action: 'setCli', cliPath: cliPath })
      })
      if (!result) return
      store.workspace = result.workspace || store.workspace
      fcNotice(result.workspace && result.workspace.cli && result.workspace.cli.exists ? 'CLI 可达' : '这个路径下找不到 filmcraft-cli')
    }

    // ── multi-select + batch grade ──────────────────────────────────────────────
    // Batch operations are what "对不同的视频做处理" means in practice: pick several
    // clips, apply one recipe to all of them, in one undo step.
    function fcMultiToggle(clipId) {
      const list = store.multi.slice()
      const at = list.indexOf(clipId)
      if (at >= 0) list.splice(at, 1)
      else list.push(clipId)
      store.multi = list
      fcEmit()
    }

    function fcMultiSet(clipIds) {
      store.multi = (clipIds || []).slice()
      fcEmit()
    }

    function fcMultiAll() {
      const all = fcClips().map(function (clip) { return clip.clip })
      store.multi = store.multi.length === all.length ? [] : all
      fcEmit()
    }

    function fcMultiIds() {
      return store.multi.slice()
    }

    async function fcGradeMany(clipIds, presetId) {
      const ids = (clipIds && clipIds.length > 0 ? clipIds : store.multi).slice()
      if (ids.length === 0) { fcFail('先选片段'); return null }
      const preset = fcPreset(presetId)
      const result = await fcRun('批量调色 ' + ids.length + ' 段', function () {
        return host.call('grade.write', { project: fcProjectRef(), clips: ids, preset: presetId })
      })
      if (!result) return null
      if (result.detail) fcSetDetail(result.detail, { keep: true })
      const failed = Array.isArray(result.failed) ? result.failed : []
      if (failed.length > 0) {
        store.error = '有 ' + failed.length + ' 段失败：' + (failed[0].error || '')
      } else {
        fcNotice('已对 ' + ids.length + ' 段套用「' + (preset ? preset.name : presetId) + '」')
      }
      fcEmit()
      return result
    }

    async function fcGradeClearMany(clipIds) {
      const ids = (clipIds && clipIds.length > 0 ? clipIds : store.multi).slice()
      if (ids.length === 0) return null
      const result = await fcRun('清空调色 ' + ids.length + ' 段', function () {
        return host.call('grade.write', { project: fcProjectRef(), clips: ids, clear: true })
      })
      if (result && result.detail) fcSetDetail(result.detail, { keep: true })
      if (result) fcNotice('已清空 ' + ids.length + ' 段调色')
      return result
    }

    // ── 20-css.js ────────────────────────────────────────────────────
    // ── styles ──────────────────────────────────────────────────────────────────
    // Injected once by apply(). Three rules that must survive any redesign:
    //
    //   · the preview box is sized from a *definite height*, with the width derived
    //     from the aspect ratio. Sizing it from the panel width makes the wide
    //     (settings) surface 825px tall and pushes everything below it off screen.
    //   · lists are capped in vh, so a short window shrinks them instead of burying
    //     the export section.
    //   · no top-level `ctx` access — this file is evaluated at import time.
    //
    // Typography note (0.3.1): the first version set the whole panel in a monospace
    // stack. Monospace is right for paths, byte counts and timecodes, but at 10 px
    // it made every CJK label look cramped and grey. The panel now uses the shell's
    // UI font at 11–12.5 px, keeps mono only for machine text, and gets its palette
    // from the *shell's own* background (detected in fcDetectTheme) instead of
    // prefers-color-scheme — the desktop app's theme is not the OS theme.

    function fcCss() {
      const dark = [
        '--bg:#0d1117', '--surface:#161b22', '--surface2:#1c2430',
        '--line:#30363d', '--line-soft:#21262d',
        '--fg:#e6edf3', '--dim:#9aa4af',
        '--bar:#4493f8', '--ok:#3fb950', '--run:#d29922', '--err:#f85149',
        '--shadow:0 1px 2px rgba(0,0,0,.4)',
      ].join(';')
      const light = [
        '--bg:#ffffff', '--surface:#f6f8fa', '--surface2:#eceff3',
        '--line:#d8dee4', '--line-soft:#eaeef2',
        '--fg:#1f2328', '--dim:#57606a',
        '--bar:#0969da', '--ok:#1a7f37', '--run:#9a6700', '--err:#cf222e',
        '--shadow:0 1px 2px rgba(31,35,40,.12)',
      ].join(';')
      const scale = [
        '--ui:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
        '--mono:"SF Mono","JetBrains Mono","Cascadia Code",Consolas,monospace',
        '--r:8px', '--r-sm:6px', '--r-xs:4px',
      ].join(';')

      return [
        // ── palette ──────────────────────────────────────────────────────────────
        '.fc-root{' + scale + ';' + dark + ';box-sizing:border-box;background:var(--bg);color:var(--fg);font-family:var(--ui);font-size:12.5px;line-height:1.55;letter-spacing:0;-webkit-font-smoothing:antialiased}',
        '.fc-root.light{' + light + '}',
        '.fc-root *{box-sizing:border-box}',
        '.fc-root :focus-visible{outline:2px solid var(--bar);outline-offset:1px;border-radius:var(--r-xs)}',
        '.fc-mono,.fc-path,.fc-meta,.fc-clip-t,.fc-num,.fc-stat-v.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}',

        // ── shell ────────────────────────────────────────────────────────────────
        '.fc-wrap{width:100%;padding:10px;font-size:12.5px;line-height:1.55}',
        '.fc-wrap.wide{max-width:1100px;margin:0 auto;padding:20px;font-size:13px}',
        '.fc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line-soft)}',
        '.fc-title{margin:0;font-size:13.5px;font-weight:650;letter-spacing:-.01em}',
        '.fc-wrap.wide .fc-title{font-size:16px}',
        '.fc-sub{margin-top:3px;color:var(--dim);font-size:11px;word-break:break-word}',

        // ── status badge ─────────────────────────────────────────────────────────
        '.fc-badge{display:inline-flex;align-items:center;gap:5px;min-height:19px;padding:1px 8px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--dim);font-size:10.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}',
        '.fc-badge.run{color:var(--run);border-color:color-mix(in srgb,var(--run) 45%,transparent)}',
        '.fc-badge.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 45%,transparent)}',
        '.fc-badge.err{color:var(--err);border-color:color-mix(in srgb,var(--err) 45%,transparent)}',
        '.fc-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}',
        '.fc-badge.run .fc-dot{animation:fc-pulse 1.2s ease-in-out infinite}',
        '@keyframes fc-pulse{0%,100%{opacity:1}50%{opacity:.25}}',

        // ── progress ─────────────────────────────────────────────────────────────
        '.fc-bar{position:relative;height:18px;margin:10px 0 6px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);overflow:hidden}',
        '.fc-bar-fill{height:100%;background:var(--bar);transition:width .6s ease}',
        '.fc-bar-txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:600}',

        // ── KPI grid: hairline-divided cells, not four bordered boxes ────────────
        '.fc-stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin:10px 0;background:var(--line-soft);border-radius:var(--r-sm);overflow:hidden}',
        '.fc-wrap.wide .fc-stats{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}',
        '.fc-stat{padding:7px 9px;background:var(--surface);min-width:0}',
        '.fc-stat-k{color:var(--dim);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.fc-stat-v{margin-top:1px;font-size:12.5px;font-weight:650;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}',
        '.fc-wrap.wide .fc-stat-v{font-size:15px}',

        // ── sections: a rule + a label, never a nested panel ─────────────────────
        '.fc-sec{margin-top:13px}',
        '.fc-sec-h{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:10.5px;font-weight:650;color:var(--dim);letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}',
        '.fc-sec-h::after{content:"";flex:1;min-width:8px;height:1px;background:var(--line-soft)}',
        '.fc-note{display:flex;gap:8px;align-items:baseline;padding:6px 9px;border-radius:var(--r-sm);background:var(--surface);margin-bottom:6px;font-size:11.5px;min-width:0}',
        '.fc-alert{padding:9px 10px;border:1px solid var(--err);border-radius:var(--r-sm);color:var(--err);background:color-mix(in srgb,var(--err) 10%,transparent);margin-top:9px;font-size:11.5px;word-break:break-word}',
        '.fc-empty{padding:18px 8px;text-align:center;color:var(--dim);font-size:11.5px}',
        '.fc-path{margin-top:8px;color:var(--dim);font-size:10.5px;word-break:break-all;line-height:1.5}',
        '.fc-hint{color:var(--dim);font-size:11px;line-height:1.65;margin-top:6px}',
        '.fc-meta{color:var(--dim);font-size:10.5px;word-break:break-all;line-height:1.55}',
        '.fc-toast{padding:6px 9px;border-left:3px solid var(--ok);border-radius:0 var(--r-xs) var(--r-xs) 0;background:var(--surface);margin:8px 0;font-size:11.5px;word-break:break-word}',
        '.fc-toast.err{border-left-color:var(--err);color:var(--err)}',

        // ── tabs: one pill row, never wraps (the 「任务 · 1」 badge used to break it) ─
        '.fc-tabs{display:flex;gap:2px;padding:2px;margin:0 0 10px;background:var(--surface);border-radius:var(--r);position:sticky;top:0;z-index:5}',
        '.fc-tab{flex:1 1 0;min-width:0;height:27px;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0 4px;border:0;border-radius:6px;background:transparent;color:var(--dim);font-family:inherit;font-size:11.5px;font-weight:600;white-space:nowrap;cursor:pointer}',
        '.fc-tab:hover{color:var(--fg);background:var(--surface2)}',
        '.fc-tab.on{background:var(--bg);color:var(--fg);box-shadow:var(--shadow)}',
        '.fc-tab-lb{overflow:hidden;text-overflow:ellipsis}',
        '.fc-tab-n{flex:0 0 auto;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--run);color:#161b22;font-family:var(--mono);font-size:9.5px;font-weight:700;line-height:15px;text-align:center}',

        // ── forms ────────────────────────────────────────────────────────────────
        '.fc-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0}',
        '.fc-lb{color:var(--dim);font-size:11px;min-width:34px;flex:0 0 auto}',
        '.fc-inp,.fc-sel{flex:1;min-width:0;height:25px;padding:0 7px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);color:var(--fg);font-family:inherit;font-size:11.5px}',
        '.fc-sel{appearance:none;padding-right:22px;background-image:linear-gradient(45deg,transparent 50%,var(--dim) 50%),linear-gradient(135deg,var(--dim) 50%,transparent 50%);background-position:calc(100% - 13px) 11px,calc(100% - 9px) 11px;background-size:4px 4px,4px 4px;background-repeat:no-repeat}',
        '.fc-inp:focus,.fc-sel:focus{outline:none;border-color:var(--bar);box-shadow:0 0 0 2px color-mix(in srgb,var(--bar) 22%,transparent)}',
        '.fc-btn{display:inline-flex;align-items:center;justify-content:center;height:23px;padding:0 8px;border:1px solid var(--line);border-radius:var(--r-sm);background:transparent;color:var(--fg);font-family:inherit;font-size:11.5px;font-weight:500;white-space:nowrap;cursor:pointer}',
        '.fc-btn:hover:not(:disabled){background:var(--surface2)}',
        '.fc-btn:disabled{opacity:.38;cursor:default}',
        '.fc-btn.primary{background:var(--bar);border-color:var(--bar);color:#fff;font-weight:600}',
        '.fc-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--bar) 86%,#fff)}',
        '.fc-btn.danger{color:var(--err)}',
        '.fc-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--err) 12%,transparent);border-color:var(--err)}',
        '.fc-btns{display:flex;flex-wrap:wrap;gap:5px}',
        '.fc-range{flex:1;min-width:0;height:16px;accent-color:var(--bar)}',
        '.fc-num{width:56px;flex:0 0 auto;height:23px;padding:0 4px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);color:var(--fg);font-size:11px;text-align:center}',
        '.fc-fold{cursor:pointer;border:0;background:none;color:var(--dim);font-family:inherit;font-size:10.5px;font-weight:650;padding:0;letter-spacing:.06em}',
        '.fc-fold:hover{color:var(--bar)}',

        // ── chips ────────────────────────────────────────────────────────────────
        '.fc-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}',
        '.fc-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--dim);font-family:inherit;font-size:10.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
        '.fc-chip:hover{color:var(--fg)}',
        '.fc-chip.on{color:var(--bar);border-color:color-mix(in srgb,var(--bar) 55%,transparent);background:color-mix(in srgb,var(--bar) 12%,transparent)}',

        // ── lists: flat rows on one surface, selected row gets an accent edge ─────
        '.fc-clips{display:flex;flex-direction:column;max-height:min(240px,26vh);overflow:auto;border-radius:var(--r-sm);background:var(--surface)}',
        '.fc-clip{display:flex;align-items:center;gap:7px;min-height:27px;padding:4px 8px;border:0;border-left:2px solid transparent;border-bottom:1px solid var(--line-soft);background:transparent;cursor:pointer;flex:0 0 auto;min-width:0}',
        '.fc-clip:last-child{border-bottom:0}',
        '.fc-clip:hover{background:var(--surface2)}',
        '.fc-clip.on{border-left-color:var(--bar);background:var(--surface2)}',
        '.fc-clip-n{color:var(--dim);font-family:var(--mono);font-size:10px;min-width:16px;flex:0 0 auto;text-align:center}',
        '.fc-clip-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}',
        '.fc-clip-t{color:var(--dim);font-size:10px;flex:0 0 auto;white-space:nowrap}',
        '.fc-g{width:6px;height:6px;border-radius:50%;background:var(--bar);flex:0 0 auto}',
        '.fc-g.none{background:var(--line)}',

        // ── preview: definite height, width from aspect ratio ────────────────────
        '.fc-prev{position:relative;height:min(26vh,200px);aspect-ratio:4/3;width:auto;max-width:100%;margin:0 auto 6px;background:#000;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden;display:flex;align-items:center;justify-content:center}',
        '.fc-prev-i,.fc-prev-v{width:100%;height:100%;object-fit:contain;display:block}',
        '.fc-prev-none{color:#8b949e;font-size:11px;text-align:center;padding:0 10px}',
        '.fc-prev-ov{position:absolute;right:6px;top:6px;padding:1px 6px;border-radius:var(--r-xs);background:rgba(0,0,0,.7);color:#fff;font-family:var(--mono);font-size:10px}',

        // ── jobs ─────────────────────────────────────────────────────────────────
        '.fc-job{padding:7px 9px;border-radius:var(--r-sm);background:var(--surface);margin-bottom:6px}',
        '.fc-job-h{display:flex;align-items:center;gap:6px;margin-bottom:2px}',
        '.fc-job-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:600}',
        '.fc-prog{position:relative;height:6px;margin:6px 0;border-radius:999px;background:var(--surface2);overflow:hidden}',
        '.fc-prog-fill{height:100%;background:var(--bar);border-radius:999px;transition:width .5s ease}',

        // ── scrollbars ───────────────────────────────────────────────────────────
        '.fc-root ::-webkit-scrollbar{width:9px;height:9px}',
        '.fc-root ::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px;border:2px solid var(--bg)}',
        '.fc-root ::-webkit-scrollbar-thumb:hover{background:var(--dim)}',
        '.fc-root ::-webkit-scrollbar-track{background:transparent}',

        // ── fallback drawer: docked right, NO backdrop — the main UI stays usable ─
        '.fc-drawer{position:fixed;top:44px;right:10px;bottom:10px;z-index:1200;width:min(348px,calc(100vw - 20px));display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:var(--bg);box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden}',
        '.fc-drawer-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line-soft);background:var(--surface);flex:0 0 auto}',
        '.fc-drawer-hd b{font-size:12px}',
        '.fc-drawer-bd{flex:1;overflow:auto}',
        '.fc-x{width:24px;height:24px;padding:0;border:1px solid var(--line);border-radius:var(--r-sm);background:transparent;color:var(--dim);font-family:inherit;font-size:14px;line-height:1;cursor:pointer;flex:0 0 auto}',
        '.fc-x:hover{color:var(--err);border-color:var(--err)}',

        // ── sidebar entry ────────────────────────────────────────────────────────
        '.fc-entry{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:var(--r-sm);background:transparent;color:inherit;font-family:inherit;font-size:12px;cursor:pointer;text-align:left}',
        '.fc-entry:hover{background:var(--surface2)}',
        '.fc-entry.rail{justify-content:center;padding:6px}',
        '.fc-entry-gl{flex:0 0 auto;display:inline-flex}',
        '.fc-entry-lb{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.fc-entry-pct{margin-left:auto;color:var(--bar);font-family:var(--mono);font-size:10px;font-weight:600}',
        '.fc-entry.rail .fc-entry-pct{display:none}',

        // ── motion preferences ───────────────────────────────────────────────────
        '@media (prefers-reduced-motion:reduce){.fc-root *,.fc-root *::before,.fc-root *::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}}',
      ].join('')
    }

    // ── 30-ui.js ─────────────────────────────────────────────────────
    // ── ui ──────────────────────────────────────────────────────────────────────
    // The panel body. It reads the store directly and calls the actions from
    // 10-store.js; there is no second state layer, so a repaint shows exactly what
    // the host reported after the last call.
    //
    // Two surfaces share it: the docked sidebar tab and the wide settings page. The
    // `wide` flag only changes the wrapper class — every list below is vh-capped so
    // neither surface can push the export controls out of reach.

    const FC_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="3" width="12.8" height="10" rx="2"/><path d="M6.2 6.4l3.4 1.6-3.4 1.6z"/></svg>'
    const FC_TAB_KIND = 'filmcraft-progress'
    const FC_TAB_ID = 'dsh-filmcraft-progress/panel'
    const FC_TAB_TITLE = '剪辑'

    const FC_STATE_TEXT = { queued: '排队', running: '导出中', done: '已完成', failed: '失败', cancelled: '已取消' }
    const FC_STATE_CLASS = { running: 'run', done: 'ok', failed: 'err', cancelled: 'err', queued: '' }

    function FcIcon() {
      return h('span', { className: 'fc-entry-gl', dangerouslySetInnerHTML: { __html: FC_ICON } })
    }

    function useFcStore() {
      const pair = React.useState(0)
      React.useEffect(function () {
        const listener = function () { pair[1](function (n) { return n + 1 }) }
        store.listeners.add(listener)
        return function () { store.listeners.delete(listener) }
      }, [])
    }

    // The pane body does not scroll by itself, so the panel caps its own height at
    // the viewport below its top edge and scrolls inside. Measured, never hard-coded:
    // the top moves with the header, the tab strip and the sidebar width.
    function usePanelFill(ref) {
      const pair = React.useState(0)
      const setHeight = pair[1]
      React.useEffect(function () {
        let last = -1
        function measure() {
          const element = ref.current
          if (element === null || element === undefined) return
          if (typeof element.getBoundingClientRect !== 'function') return
          const viewport = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 0
          if (!viewport) return
          const top = element.getBoundingClientRect().top
          const height = Math.max(220, Math.round(viewport - top - 10))
          // Guard: an unchanged value would re-render forever once a ResizeObserver
          // is watching the element whose size this changes.
          if (height !== last) { last = height; setHeight(height) }
        }
        measure()
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', measure)
        let observer = null
        if (typeof ResizeObserver !== 'undefined' && ref.current) {
          observer = new ResizeObserver(measure)
          observer.observe(ref.current)
        }
        return function () {
          if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', measure)
          if (observer !== null) observer.disconnect()
        }
      }, [])
      return pair[0]
    }

    // Which palette to paint with. prefers-color-scheme is the OS, and the desktop
    // app's own theme is a separate setting — so read the background of the surface
    // this panel was mounted into instead, and walk up to the first opaque layer.
    function fcDetectTheme(node) {
      try {
        if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return 'dark'
        // Start outside our own tree: .fc-root paints a background of its own, so
        // reading it would just echo the palette we picked last time.
        let element = node.parentElement
        while (element && String(element.className || '').indexOf('fc-root') >= 0) element = element.parentElement
        let color = ''
        for (let depth = 0; depth < 8 && element; depth++) {
          color = window.getComputedStyle(element).backgroundColor || ''
          const parsed = color.match(/rgba?\(([^)]+)\)/)
          if (parsed) {
            const parts = parsed[1].split(',').map(Number)
            if (parts.length < 4 || !(parts[3] < 0.5)) break
          }
          element = element.parentElement
        }
        const parsed = color.match(/rgba?\(([^)]+)\)/)
        if (!parsed) return 'dark'
        const parts = parsed[1].split(',').map(Number)
        if (parts.length < 3) return 'dark'
        const luminance = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255
        return luminance > 0.5 ? 'light' : 'dark'
      } catch (_) { return 'dark' }
    }

    function FcBtn(props) {
      const cls = 'fc-btn' + (props.primary ? ' primary' : '') + (props.danger ? ' danger' : '')
      return h('button', {
        className: cls,
        type: 'button',
        title: props.title,
        disabled: props.disabled === true,
        onClick: props.onClick,
      }, props.children)
    }

    function FcBadge(props) {
      return h('span', { className: 'fc-badge' + (props.kind ? ' ' + props.kind : '') },
        h('span', { className: 'fc-dot' }), props.children)
    }

    function FcSection(props) {
      return h('div', { className: 'fc-sec' },
        h('div', { className: 'fc-sec-h' }, props.title, props.extra || null),
        props.children)
    }

    function FcStat(props) {
      return h('div', { className: 'fc-stat' },
        h('div', { className: 'fc-stat-k' }, props.label),
        h('div', { className: 'fc-stat-v' }, props.children))
    }

    // ── preview ─────────────────────────────────────────────────────────────────
    function PreviewBlock() {
      const clip = fcSelectedClip()
      const busy = store.busy !== ''
      const span = clip ? Math.max(0.5, Math.min(store.proxySeconds, PROXY_MAX, clip.dur - store.scrub)) : 0
      return h('div', { className: 'fc-sec' },
        h('div', { className: 'fc-sec-h' },
          '预览' + (clip === null ? '' : ' · ' + clip.trackLabel + ' ' + fcShort(clip.name, 22)),
          h('button', {
            className: 'fc-fold', type: 'button',
            title: store.prevOpen ? '收起画面，给片段列表腾地方' : '展开画面',
            onClick: function () { store.prevOpen = !store.prevOpen; fcEmit() },
          }, store.prevOpen ? '收起画面' : '展开画面')),

        store.prevOpen ? h('div', { className: 'fc-prev' },
          store.proxyUrl
            ? h('video', { className: 'fc-prev-v', src: store.proxyUrl, controls: true, autoPlay: true, loop: true, playsInline: true })
            : (store.frameUrl
              ? h('img', { className: 'fc-prev-i', src: store.frameUrl, alt: '预览画面' })
              : h('div', { className: 'fc-prev-none' },
                store.frameBusy ? '渲染中…' : (clip === null ? '选一个片段' : '准备中…'))),
          store.frameBusy && store.frameUrl ? h('div', { className: 'fc-prev-ov' }, '渲染中…') : null) : null,

        clip === null ? null : h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '时间'),
          h(FcBtn, {
            disabled: busy || store.frameBusy, title: '往前 0.5 秒',
            onClick: function () { fcScrub(Math.max(0, store.scrub - 0.5)) },
          }, '◀'),
          h('input', {
            className: 'fc-range', type: 'range', min: 0, max: Math.max(0.001, clip.dur), step: 0.05,
            value: store.scrub, onChange: function (event) { fcScrub(Number(event.target.value)) },
          }),
          h(FcBtn, {
            disabled: busy || store.frameBusy, title: '往后 0.5 秒',
            onClick: function () { fcScrub(Math.min(clip.dur, store.scrub + 0.5)) },
          }, '▶'),
          h('span', { className: 'fc-clip-t' }, store.scrub.toFixed(2) + ' / ' + clip.dur.toFixed(2) + 's')),

        clip === null ? null : h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '视频'),
          h('input', {
            className: 'fc-num', type: 'number', min: 0.5, max: PROXY_MAX, step: 0.5,
            value: String(store.proxySeconds),
            title: '预览片段长度，0.5 – ' + PROXY_MAX + ' 秒',
            onChange: function (event) { store.proxySeconds = event.target.value; fcEmit() },
            // Typing "1" on the way to "15" must not be clamped mid-keystroke.
            onBlur: function () {
              store.proxySeconds = Math.max(0.5, Math.min(PROXY_MAX, Number(store.proxySeconds) || 0.5))
              fcEmit()
            },
          }),
          h('span', { className: 'fc-clip-t' }, '秒'),
          h('button', {
            className: 'fc-fold', type: 'button', title: '从头预览整段（最长 ' + PROXY_MAX + ' 秒）',
            onClick: fcWholeClip,
          }, '整段'),
          h(FcBtn, { disabled: busy || store.proxyBusy, onClick: fcProxy }, store.proxyBusy ? '导出中…' : '生成预览片段'),
          store.proxyUrl ? h(FcBtn, {
            onClick: function () {
              try { URL.revokeObjectURL(store.proxyUrl) } catch (_) { }
              store.proxyUrl = ''
              fcEmit()
            },
          }, '关闭视频') : null),

        store.frameError ? h('div', { className: 'fc-toast err' }, store.frameError) : null,
        store.proxyError ? h('div', { className: 'fc-toast err' }, store.proxyError) : null,

        store.prevOpen ? h('div', { className: 'fc-hint' },
          '画面是套过调色的成片效果；拖动时间轴看任意一帧。',
          h('br'), '「生成预览片段」渲染真实视频，长度自己填（0.5–' + PROXY_MAX + ' 秒），约 ' +
            span.toFixed(1) + ' 秒 ≈ ' + Math.max(1, Math.round(span * 50 * 0.13)) + ' 秒渲染时间，结果会缓存。') : null)
    }

    // ── clips ───────────────────────────────────────────────────────────────────
    // Two selection concepts, deliberately separate: `clipId` is the clip the editor
    // acts on (preview, trim), `store.multi` is the set a batch grade applies to.
    // Mixing them would make every single-clip action quietly a batch action.
    function ClipList() {
      const clips = fcClips()
      const multi = store.multi || []
      return h('div', null,
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '多选'),
          h(FcBtn, { disabled: clips.length === 0, onClick: fcMultiAll }, multi.length === clips.length && clips.length > 0 ? '取消全选' : '全选'),
          h(FcBtn, { disabled: multi.length === 0, onClick: function () { fcMultiSet([]) } }, '清空'),
          h('span', { className: 'fc-clip-t' }, multi.length === 0 ? '点序号可多选' : '已选 ' + multi.length + ' 段')),
        h('div', { className: 'fc-clips' },
          clips.map(function (clip, index) {
            const on = clip.clip === store.clipId
            const picked = multi.indexOf(clip.clip) >= 0
            return h('div', {
              className: 'fc-clip' + (on ? ' on' : ''),
              key: 'clip-' + clip.clip,
              title: clip.name,
              onClick: function () {
                if (store.clipId === clip.clip) return
                store.clipId = clip.clip
                store.scrub = 0
                store.proxyUrl = ''
                fcEmit()
                if (store.prevOpen) fcFrame(clip.start)
              },
            },
              h('span', {
                className: 'fc-clip-n',
                style: { cursor: 'pointer', color: picked ? 'var(--bar)' : undefined, fontWeight: picked ? 700 : 400 },
                title: picked ? '移出多选' : '加入多选',
                onClick: function (event) {
                  event.stopPropagation()
                  fcMultiToggle(clip.clip)
                },
              }, (picked ? '✓' : '') + (index + 1)),
              h('span', { className: 'fc-g' + (fcHasGrade(clip) ? '' : ' none') }),
              h('span', { className: 'fc-clip-name' }, fcShort(clip.name, 30)),
              h('span', { className: 'fc-clip-t' }, clip.trackLabel + ' ' + fcTime(clip.start) + '–' + fcTime(clip.end)),
              clip.enabled ? null : h('span', { className: 'fc-clip-t' }, '停用'))
          })))
    }

    // ── edit actions ────────────────────────────────────────────────────────────
    function EditActions() {
      const clip = fcSelectedClip()
      const clips = fcClips()
      const index = clip === null ? -1 : clips.indexOf(clip)
      const busy = store.busy !== ''
      const presets = store.workspace && Array.isArray(store.workspace.presets) ? store.workspace.presets : []
      return h('div', null,
        h('div', { className: 'fc-sec-h' },
          '编辑' + (clip === null ? '' : ' · ' + clip.trackLabel + ' #' + (index + 1) + ' · ' + clip.dur.toFixed(2) + 's')),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '裁头'),
          h(FcBtn, { disabled: busy || clip === null, title: '把入点往左拉 0.5 秒（变长）', onClick: function () { fcTrim('in', -0.5) } }, '−0.5s'),
          h(FcBtn, { disabled: busy || clip === null, title: '裁掉开头 0.5 秒', onClick: function () { fcTrim('in', 0.5) } }, '+0.5s'),
          h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('in', 1) } }, '+1s'),
          h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('in', 3) } }, '+3s')),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '裁尾'),
          h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', -0.5) } }, '−0.5s'),
          h(FcBtn, { disabled: busy || clip === null, title: '裁掉结尾 0.5 秒', onClick: function () { fcTrim('out', 0.5) } }, '+0.5s'),
          h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', 1) } }, '+1s'),
          h(FcBtn, { disabled: busy || clip === null, onClick: function () { fcTrim('out', 3) } }, '+3s')),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '排序'),
          h(FcBtn, { disabled: busy || clip === null || index <= 0, onClick: function () { fcMoveClip(-1) } }, '◀ 上移'),
          h(FcBtn, { disabled: busy || clip === null || index >= clips.length - 1, onClick: function () { fcMoveClip(1) } }, '下移 ▶'),
          h(FcBtn, { danger: true, disabled: busy || clip === null, onClick: fcDeleteClip }, '删除')),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '调色'),
          presets.map(function (preset) {
            return h(FcBtn, {
              key: 'preset-' + preset.id,
              disabled: busy || clip === null,
              title: preset.builtin ? '内置预设' : '自定义预设',
              onClick: function () { fcApplyGrade(preset.id) },
            }, preset.name)
          }),
          h(FcBtn, { disabled: busy || clip === null || !fcHasGrade(clip), onClick: fcClearGrade }, '清空')),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '其他'),
          h(FcBtn, { disabled: busy || clip === null, onClick: fcToggleClip }, clip === null || clip.enabled ? '停用' : '启用'),
          h(FcBtn, { disabled: busy, title: '还原到上一次编辑前的工程快照', onClick: fcUndo }, '↩ 撤销')),

        // Batch is its own block: when nothing is checked it falls back to every clip,
        // which is the "整条片子统一调色" gesture the old version hard-coded.
        h('div', { className: 'fc-sec-h' }, '批量'),
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '范围'),
          h('span', { className: 'fc-clip-t' },
            (store.multi || []).length > 0 ? '选中的 ' + store.multi.length + ' 段' : '全部 ' + clips.length + ' 段')),
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '调色'),
          presets.map(function (preset) {
            return h(FcBtn, {
              key: 'batch-' + preset.id,
              disabled: busy || clips.length === 0,
              title: '对' + ((store.multi || []).length > 0 ? '选中的片段' : '全部片段') + '套用「' + preset.name + '」',
              onClick: function () { fcGradeMany(null, preset.id) },
            }, preset.name)
          })),
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '操作'),
          h(FcBtn, { disabled: busy || clips.length === 0, onClick: function () { fcGradeClearMany(null) } }, '清空这批调色')))
    }

    // ── export ──────────────────────────────────────────────────────────────────
    function ExportBlock() {
      const busy = store.busy !== ''
      const running = fcRunningJobs()
      const job = running.length > 0 ? running[0] : null
      const ratio = job && job.progress && typeof job.progress.ratio === 'number' ? job.progress.ratio : null
      return h(FcSection, { title: '导出' },
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '输出'),
          h('input', {
            className: 'fc-inp', type: 'text', value: store.out,
            placeholder: '留空 = 工作区 exports/工程名-时间.mp4',
            onChange: function (event) { store.out = event.target.value; fcEmit() },
          })),

        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '格式'),
          h('select', {
            className: 'fc-sel', value: store.format,
            onChange: function (event) { store.format = event.target.value; fcEmit() },
          },
            ['h264', 'hevc', 'prores'].map(function (name) { return h('option', { value: name, key: name }, name) })),
          h('span', { className: 'fc-lb' }, '缩放'),
          h('select', {
            className: 'fc-sel', value: String(store.scale),
            onChange: function (event) { store.scale = Number(event.target.value); fcEmit() },
          },
            [['1', '100%'], ['0.5', '50%'], ['0.25', '25%']].map(function (pair) {
              return h('option', { value: pair[0], key: pair[0] }, pair[1])
            }))),

        h('div', { className: 'fc-btns' },
          h(FcBtn, { primary: true, disabled: busy, onClick: fcExport }, '导出当前序列')),

        job === null ? null : h('div', null,
          h('div', { className: 'fc-meta' }, '正在导出：' + fcShort(job.project ? job.project.name : '', 24) +
            ' · ' + (ratio === null ? '采样中' : Math.round(ratio * 100) + '%')),
          h('div', { className: 'fc-prog' },
            h('div', { className: 'fc-prog-fill', style: { width: (ratio === null ? 0 : ratio * 100) + '%' } })),
          h('div', { className: 'fc-btns' }, h(FcBtn, { onClick: function () { fcJobAction('cancel', job.id) } }, '取消任务'))),

        h('div', { className: 'fc-hint' }, '导出在后台跑，进度在「任务」页实时刷新；同一工程可随时再剪辑。'))
    }

    // ── project / sequence header ───────────────────────────────────────────────
    function ProjectBlock() {
      const detail = store.detail
      const sequences = detail && Array.isArray(detail.sequences) ? detail.sequences : []
      const busy = store.busy !== ''
      return h('div', null,
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-lb' }, '工程'),
          h('select', {
            className: 'fc-sel', value: store.projectId || '',
            onChange: function (event) { if (event.target.value) fcOpenProject(event.target.value) },
          },
            h('option', { value: '' }, store.projects.length > 0 ? '选择工程…' : '还没有工程'),
            store.projects.map(function (project) {
              return h('option', { key: project.id, value: project.id }, (project.exists ? '' : '⚠ ') + project.name)
            })),
          h(FcBtn, { disabled: busy, title: '在工作区里重新扫描 .fcproj', onClick: fcScan }, '扫描')),

        detail === null ? null : h('div', { className: 'fc-row' },
          h('span', { className: 'fc-clip-t', title: detail.path }, (detail.name || '未命名工程') + ' · ' + sequences.length + ' 序列' + (detail.revision === undefined || detail.revision === null ? '' : ' · rev ' + detail.revision)),
          h(FcBtn, { disabled: busy, onClick: fcRefreshProject }, '刷新')),

        detail === null ? null : h('div', { className: 'fc-chips' },
          sequences.map(function (sequence) {
            return h('button', {
              key: 'seq-' + sequence.id,
              className: 'fc-chip' + (sequence.active ? ' on' : ''),
              type: 'button',
              title: (sequence.clipCount === null || sequence.clipCount === undefined ? '' : sequence.clipCount + ' 段 · ') + fcTime(sequence.duration),
              onClick: function () { if (!sequence.active) fcActivateSequence(sequence.id) },
            }, (sequence.active ? '● ' : '') + fcShort(sequence.name, 18))
          }),
          h(FcBtn, { disabled: busy, onClick: fcNewSequence }, '+ 序列')))
    }

    // ── edit view ───────────────────────────────────────────────────────────────
    function EditView() {
      const detail = store.detail
      if (detail === null) {
        return h('div', null,
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '工程'),
            h(FcBtn, { disabled: store.busy !== '', onClick: fcScan }, '扫描'),
            h(FcBtn, { disabled: store.busy !== '', onClick: function () { fcRefreshJobs().catch(function () { }) } }, '刷新')),

          store.projects.length === 0
            ? h('div', { className: 'fc-empty' }, '工作区里还没有登记工程。点「扫描」找 .fcproj。')
            : h('div', { className: 'fc-clips', style: { maxHeight: '180px' } },
              store.projects.map(function (project) {
                return h('div', {
                  key: 'p-' + project.id,
                  className: 'fc-clip',
                  title: project.display,
                  onClick: function () { fcOpenProject(project.id) },
                },
                  h('span', { className: 'fc-clip-name' }, (project.exists ? '' : '⚠ ') + project.name),
                  h('span', { className: 'fc-clip-t' }, project.exists ? fcBytes(project.bytes) : '文件缺失'))
              })),

          h('div', { className: 'fc-hint' },
            '工作区：' + (store.workspace ? store.workspace.rootDisplay : '…'),
            h('br'), '选中工程后可以：预览画面、裁头裁尾、删除、上下移、调色、导出。'))
      }

      const sequence = fcSequence()
      const clip = fcSelectedClip()
      return h('div', null,
        h(ProjectBlock, null),

        store.workspace === null || store.workspace.cli.exists
          ? null
          : h('div', { className: 'fc-alert' }, '找不到 filmcraft-cli：' + store.workspace.cli.path),

        detail === null ? null : h('div', { className: 'fc-path' }, detail.path),

        sequence === null
          ? h('div', { className: 'fc-empty' }, '这个工程没有激活的序列。新建一条序列再开始。')
          : h('div', null,
            h('div', { className: 'fc-stats' },
              h(FcStat, { label: '序列' }, fcShort(sequence.name, 20)),
              h(FcStat, { label: '时长' }, fcTime(sequence.duration)),
              h(FcStat, { label: '规格' }, (sequence.width || '?') + '×' + (sequence.height || '?') + ' · ' + (sequence.fps ? sequence.fps.toFixed(2) : '?') + 'fps'),
              h(FcStat, { label: '片段' }, String(fcClips().length))),

            h(PreviewBlock, null),

            h(FcSection, { title: '片段 (' + fcClips().length + ')' }, h(ClipList, null)),

            h(FcSection, { title: '素材' },
              h('div', { className: 'fc-btns' },
                h(FcBtn, { disabled: store.busy !== '', onClick: fcRefreshAssets }, '读取素材'),
                h(FcBtn, {
                  disabled: store.busy !== '',
                  onClick: function () { store.browseOpen = !store.browseOpen; fcEmit(); if (store.browseOpen) fcBrowse('') },
                }, store.browseOpen ? '收起目录' : '选素材'),
                h(FcBtn, {
                  disabled: store.busy !== '' || (store.staging || []).length === 0,
                  title: '只导入到工程素材箱，不动时间线',
                  onClick: function () { fcImport(null) },
                }, '导入 (' + (store.staging || []).length + ')'),
                h(FcBtn, {
                  disabled: store.busy !== '' || (store.staging || []).length === 0,
                  title: '新建一条序列并把这批素材按顺序摆上去',
                  onClick: function () { fcPlaceStaging(null) },
                }, '放到新序列')),
              (store.assets || []).length > 0 ? h('div', { className: 'fc-chips' },
                store.assets.map(function (asset) {
                  if (!asset.path) return null
                  const staged = fcStagingIndex(asset.path) >= 0
                  return h('button', {
                    key: 'asset-' + asset.item, type: 'button',
                    className: 'fc-chip' + (staged ? ' on' : ''),
                    title: asset.path + ' · ' + (asset.width || '?') + '×' + (asset.height || '?') + ' · ' + (asset.fps || '?') + 'fps' + (asset.online === false ? '（离线）' : ''),
                    disabled: store.busy !== '',
                    onClick: function () { if (staged) fcUnstage(asset.path); else fcStage(asset.path) },
                  }, (asset.online === false ? '⚠ ' : '') + fcShort(asset.name, 14))
                }).filter(Boolean)) : null,
              store.browseOpen ? h(FcBrowsePicker, { kind: 'media', onPick: fcStage }) : null),

            clip === null ? h('div', { className: 'fc-hint' }, '选一个片段就能剪。') : h(EditActions, null),

            h(ExportBlock, null)))
    }

    // ── jobs ────────────────────────────────────────────────────────────────────
    function JobCard(props) {
      const job = props.job
      const progress = job.progress || {}
      const ratio = typeof progress.ratio === 'number' ? progress.ratio : null
      const expected = job.expected || {}
      return h('div', { className: 'fc-job' },
        h('div', { className: 'fc-job-h' },
          h('span', { className: 'fc-job-n', title: job.out }, (job.project ? job.project.name : '（无工程）') +
            (job.sequence ? ' · ' + job.sequence.name : '')),
          h(FcBadge, { kind: FC_STATE_CLASS[job.state] || '' }, FC_STATE_TEXT[job.state] || job.state)),

        h('div', { className: 'fc-prog' },
          h('div', { className: 'fc-prog-fill', style: { width: (ratio === null ? 0 : Math.round(ratio * 1000) / 10) + '%' } })),

        h('div', { className: 'fc-meta' },
          (ratio === null ? '进度未知' : Math.round(ratio * 1000) / 10 + '%'),
          ' · ' + fcBytes(progress.bytes) + (expected.bytes ? ' / ' + fcBytes(expected.bytes) : ''),
          typeof progress.etaMs === 'number' ? ' · 剩余 ' + fcDuration(progress.etaMs) : '',
          progress.bytesPerSecond ? ' · ' + fcBytes(progress.bytesPerSecond) + '/s' : ''),

        h('div', { className: 'fc-meta' }, job.display || job.out || ''),
        job.error && job.state === 'failed' ? h('div', { className: 'fc-toast err' }, job.error) : null,
        job.state === 'done' && job.result ? h('div', { className: 'fc-meta' },
          job.result.frames + ' 帧 · ' + fcDuration(job.result.seconds * 1000) + ' · ' + fcBytes(job.result.bytes)) : null,

        h('div', { className: 'fc-btns', style: { marginTop: '4px' } },
          job.state === 'running' ? h(FcBtn, { onClick: function () { fcJobAction('cancel', job.id) } }, '取消') : null,
          job.state !== 'running' ? h(FcBtn, { danger: true, onClick: function () { fcJobAction('remove', job.id) } }, '清除记录') : null))
    }

    function LegacyBlock() {
      const legacy = store.legacy
      if (!legacy || legacy.present !== true) return null
      const state = legacy.state || {}
      return h('div', { className: 'fc-note' },
        h('span', null, '旧版状态文件：'),
        h('span', null, (state.phase || '未知') + (state.percent === null || state.percent === undefined ? '' : ' ' + Math.round(state.percent) + '%')),
        h('span', { style: { color: 'var(--dim)' } }, legacy.alive ? '（' + fcAgo(legacy.updatedAt) + '）' : '（已停止更新）'))
    }

    function JobsView() {
      const running = fcRunningJobs()
      const done = store.jobs.filter(function (job) { return job.state !== 'running' })
      return h('div', null,
        h('div', { className: 'fc-row' },
          h('span', { className: 'fc-clip-t' }, running.length + ' 个进行中 · ' + done.length + ' 条历史'),
          h(FcBtn, { onClick: function () { fcRefreshJobs().catch(function () { }) } }, '刷新')),

        LegacyBlock(),

        running.length === 0
          ? h('div', { className: 'fc-empty' }, '没有正在导出的任务。')
          : running.map(function (job) { return h(JobCard, { job: job, key: job.id }) }),

        done.length === 0 ? null : h(FcSection, { title: '历史' },
          done.slice(0, 12).map(function (job) { return h(JobCard, { job: job, key: job.id }) })),

        h('div', { className: 'fc-path' }, '任务记录保存在工作区的 jobs/ 目录，重启后仍在。'))
    }

    // ── panel ───────────────────────────────────────────────────────────────────
    function Panel(props) {
      const wide = !!(props && props.wide)
      useFcStore()
      const wrapRef = React.useRef(null)
      const fillHeight = usePanelFill(wrapRef)
      React.useEffect(function () {
        store.mounted = true
        fcBoot()
        fcEnsurePolling()
        // The desktop app's theme is a setting, not necessarily the OS theme, so the
        // palette is read off the surface the panel is mounted into.
        const theme = fcDetectTheme(wrapRef.current)
        if (theme !== store.theme) { store.theme = theme; fcEmit() }
        return function () { store.mounted = false }
      }, [])
      const wrap = 'fc-wrap' + (wide ? ' wide' : '')
      const tabs = [
        { id: 'projects', label: '项目' },
        { id: 'edit', label: '剪辑' },
        { id: 'merge', label: '合并' },
        { id: 'jobs', label: '任务' },
        { id: 'settings', label: '设置' },
      ]
      return h('div', { className: 'fc-root' + (store.theme === 'light' ? ' light' : '') },
        h('div', {
          className: wrap,
          ref: wrapRef,
          style: fillHeight > 0 ? { maxHeight: fillHeight + 'px', overflowY: 'auto' } : null,
        },
          h('div', { className: 'fc-tabs' },
            tabs.map(function (tab) {
              const running = tab.id === 'jobs' ? fcRunningJobs().length : 0
              return h('button', {
                key: tab.id,
                className: 'fc-tab' + (store.tab === tab.id ? ' on' : ''), type: 'button',
                onClick: function () {
                  store.tab = tab.id
                  fcEmit()
                  if (tab.id === 'jobs') fcRefreshJobs().catch(function () { })
                  if (tab.id === 'merge' && store.browse.path === '') fcBrowse('')
                },
                // The count badge is its own element: inside the label text it wrapped
                // 「任务 · 1」 onto two lines and made the whole strip uneven.
              }, h('span', { className: 'fc-tab-lb' }, tab.label),
                running > 0 ? h('span', { className: 'fc-tab-n' }, String(running)) : null)
            })),

          store.notice ? h('div', { className: 'fc-toast' }, store.notice) : null,
          store.error ? h('div', { className: 'fc-toast err' }, store.error) : null,
          store.busy ? h('div', { className: 'fc-hint' }, store.busy + '…') : null,

          store.tab === 'edit' ? h(EditView, null) : null,
          store.tab === 'projects' ? h(ProjectsView, null) : null,
          store.tab === 'merge' ? h(MergeView, null) : null,
          store.tab === 'jobs' ? h(JobsView, null) : null,
          store.tab === 'settings' ? h(SettingsView, null) : null))
    }

    // ── fallback drawer (non-modal, no backdrop) ────────────────────────────────
    function Drawer() {
      const open = useDrawerOpen()
      React.useEffect(function () {
        if (!open) return
        function onKey(event) { if (event.key === 'Escape') setDrawerOpen(false) }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [open])
      if (!open) return null
      return h('div', { className: 'fc-root' },
        h('div', { className: 'fc-drawer', role: 'complementary' },
          h('div', { className: 'fc-drawer-hd' },
            h('b', null, FC_TAB_TITLE),
            h('button', { className: 'fc-x', type: 'button', title: '关闭', onClick: function () { setDrawerOpen(false) } }, '×')),
          h('div', { className: 'fc-drawer-bd' }, h(Panel, null))))
    }

    function FooterAction(props) {
      const wide = !(props && props.wide === false)
      useFcStore()
      React.useEffect(function () { fcBoot(); fcEnsurePolling() }, [])
      const running = fcRunningJobs()
      const job = running.length > 0 ? running[0] : null
      const ratio = job && job.progress && typeof job.progress.ratio === 'number' ? Math.round(job.progress.ratio * 100) : null
      return h('button', {
        className: wide ? 'fc-entry' : 'fc-entry rail',
        type: 'button',
        title: job === null ? FC_TAB_TITLE + ' · 空闲' : '正在导出 ' + (ratio === null ? '' : ratio + '%'),
        onClick: function () { openPanel() },
      },
        h(FcIcon, null),
        wide ? h('span', { className: 'fc-entry-lb' }, FC_TAB_TITLE) : null,
        ratio !== null && wide ? h('span', { className: 'fc-entry-pct' }, ratio + '%') : null)
    }

    // ── 40-views.js ──────────────────────────────────────────────────
    // ── views: projects, merge, settings ────────────────────────────────────────
    // The edit view (30-ui.js) works inside one already-open project. These three
    // cover everything around it: which project is open, how several sources become
    // one sequence, and where the workspace lives.

    // ── shared: directory picker ────────────────────────────────────────────────
    // One component serves two jobs (picking .fcproj files and picking media) because
    // the host returns both from the same listing — the difference is only which
    // entries are clickable.
    function FcBrowsePicker(props) {
      const kind = props.kind === 'project' ? 'project' : 'media'
      const browse = store.browse
      const busy = store.busy !== ''
      const rows = []
      if (browse.parent) {
        rows.push(h('div', {
          key: 'up', className: 'fc-clip', title: browse.parent,
          onClick: function () { if (!busy) fcBrowse(browse.parent) },
        }, h('span', { className: 'fc-clip-n' }, '↑'), h('span', { className: 'fc-clip-name' }, '..'), h('span', { className: 'fc-clip-t' }, '上级')))
      }
      for (const dir of browse.dirs) {
        rows.push(h('div', {
          key: 'd-' + dir.path, className: 'fc-clip', title: dir.path,
          onClick: function () { if (!busy) fcBrowse(dir.path) },
        }, h('span', { className: 'fc-clip-n' }, '▸'), h('span', { className: 'fc-clip-name' }, dir.name), h('span', { className: 'fc-clip-t' }, '')))
      }
      if (kind === 'project') {
        for (const path of browse.projects) {
          rows.push(h('div', {
            key: 'p-' + path, className: 'fc-clip', title: path,
            onClick: function () { if (!busy && props.onPick) props.onPick(path) },
          }, h('span', { className: 'fc-clip-n' }, '+'), h('span', { className: 'fc-clip-name' }, path.split(/[\\/]/).pop()), h('span', { className: 'fc-clip-t' }, '工程')))
        }
      } else {
        for (const file of browse.files) {
          const staged = fcStagingIndex(file.path) >= 0
          rows.push(h('div', {
            key: 'f-' + file.path, className: 'fc-clip' + (staged ? ' on' : ''), title: file.path,
            onClick: function () { if (!busy) { if (props.onPick) props.onPick(file.path); else fcStage(file.path) } },
          },
            h('span', { className: 'fc-clip-n' }, staged ? '✓' : '+'),
            h('span', { className: 'fc-clip-name' }, file.name),
            h('span', { className: 'fc-clip-t' }, fcBytes(file.bytes))))
        }
      }
      return h('div', null,
        h('div', { className: 'fc-row' },
          h(FcBtn, { onClick: fcBrowseUp, disabled: busy || !browse.parent, title: '上级目录' }, '↑'),
          h('span', { className: 'fc-clip-name', title: browse.path }, browse.path || '（未选择目录）'),
          h(FcBtn, { onClick: function () { fcBrowse(browse.path) }, disabled: busy }, '刷新')),
        rows.length === 0
          ? h('div', { className: 'fc-empty' }, kind === 'project' ? '这个目录里没有 .fcproj' : '这个目录里没有可导入的素材')
          : h('div', { className: 'fc-clips' }, rows))
    }

    // ── projects ────────────────────────────────────────────────────────────────
    function ProjectsView() {
      const workspace = store.workspace
      const busy = store.busy !== ''
      const pair = React.useState({ mode: '', text: '', name: '' })
      const form = pair[0]
      const setForm = function (patch) { pair[1](Object.assign({}, pair[0], patch)) }
      if (workspace === null) return h('div', { className: 'fc-empty' }, '正在读取工作区…')

      const projects = store.projects || []
      const existing = projects.filter(function (project) { return project.exists })
      const missing = projects.filter(function (project) { return !project.exists })

      return h('div', null,
        h('div', { className: 'fc-stats' },
          h(FcStat, { label: '工程' }, String(existing.length)),
          h(FcStat, { label: '缺失' }, String(missing.length)),
          h(FcStat, { label: '任务' }, String(workspace.counts ? workspace.counts.jobs : 0)),
          h(FcStat, { label: '版本' }, workspace.version || '?')),

        h('div', { className: 'fc-path' }, '工作区：' + (workspace.rootDisplay || '?')),
        workspace.cli && workspace.cli.exists === false
          ? h('div', { className: 'fc-alert' }, '找不到 filmcraft-cli：' + workspace.cli.path)
          : null,

        h(FcSection, { title: '工程 (' + projects.length + ')' },
          h('div', { className: 'fc-btns', style: { marginBottom: '6px' } },
            h(FcBtn, { onClick: fcRescan, disabled: busy }, '重新扫描'),
            h(FcBtn, {
              onClick: function () {
                const next = form.mode === 'add' ? '' : 'add'
                setForm({ mode: next })
                if (next === 'add') fcBrowse(store.browse.path || '')
              },
            }, '+ 登记已有工程'),
            h(FcBtn, {
              onClick: function () {
                const next = form.mode === 'new' ? '' : 'new'
                setForm({ mode: next })
                if (next === 'new' && !store.browse.path) fcBrowse(workspace.paths ? workspace.paths.projects : '')
              },
            }, '+ 新建工程')),

          form.mode === '' ? null : h('div', { className: 'fc-note', style: { display: 'block' } },
            h('div', { className: 'fc-row' },
              h('span', { className: 'fc-lb' }, '路 径'),
              h('input', {
                className: 'fc-inp', value: form.text, placeholder: 'D:\\work\\新工程.fcproj',
                onChange: function (event) { setForm({ text: event.target.value }) },
              })),
            h('div', { className: 'fc-row' },
              h('span', { className: 'fc-lb' }, '名 称'),
              h('input', {
                className: 'fc-inp', value: form.name, placeholder: form.mode === 'new' ? '留空则用文件名' : '可选',
                onChange: function (event) { setForm({ name: event.target.value }) },
              })),
            h('div', { className: 'fc-btns' },
              h(FcBtn, {
                primary: true, disabled: busy,
                onClick: async function () {
                  const path = form.text.trim()
                  if (!path) { fcFail('先填一个路径'); return }
                  if (form.mode === 'new') await fcProjectCreate(path, form.name.trim());
                  else await fcProjectAdd(path, form.name.trim())
                  setForm({ mode: '', text: '', name: '' })
                },
              }, form.mode === 'new' ? '创建并打开' : '登记并打开'),
              h(FcBtn, { onClick: function () { setForm({ mode: '' }) } }, '取消')),
            h('div', { className: 'fc-hint' },
              form.mode === 'new'
                ? '引擎不能凭空创建工程文件，」新建」实际是「建空工程 + 立刻导入素材」。建好后到「合并」页放素材。'
                : '指到一个已存在的 .fcproj 就行。也可以从下面的目录里点选。'),
            h(FcBrowsePicker, {
              kind: 'project',
              onPick: function (path) { setForm({ text: path }) },
            })),

          projects.length === 0
            ? h('div', { className: 'fc-empty' }, '还没有工程。点「重新扫描」或「登记已有工程」。')
            : h('div', { className: 'fc-clips' },
              projects.map(function (project) {
                const on = store.detail && store.detail.path && store.detail.path === project.file
                return h('div', {
                  key: project.id,
                  className: 'fc-clip' + (on ? ' on' : ''),
                  title: project.display,
                  onClick: function () { if (!busy) fcOpenProject(project.id) },
                },
                  h('span', { className: 'fc-clip-n' }, on ? '●' : ''),
                  h('span', { className: 'fc-clip-name' }, (project.exists ? '' : '⚠ ') + project.name),
                  h('span', { className: 'fc-clip-t' }, project.exists ? fcBytes(project.bytes) + ' · ' + fcAgo(project.savedAt) : '文件缺失'))
              }))),

        store.detail === null ? null : h(FcSection, { title: '已打开' },
          h('div', { className: 'fc-note' },
            h('span', null, store.detail.name),
            h('span', { style: { color: 'var(--dim)' } }, (store.detail.sequences || []).length + ' 序列' + (store.detail.revision === undefined || store.detail.revision === null ? '' : ' · rev ' + store.detail.revision))),
          h('div', { className: 'fc-path' }, store.detail.path),
          h('div', { className: 'fc-btns' },
            h(FcBtn, { onClick: function () { store.tab = 'edit'; fcEmit() } }, '进入剪辑'),
            h(FcBtn, {
              danger: true, disabled: busy,
              onClick: function () { fcProjectRemove(store.projectId) },
              title: '只从列表移除，不删文件',
            }, '从列表移除'))),

        h('div', { className: 'fc-hint' },
          '工程按 id 登记在工作区里，编辑时只用 id，不再写死路径 —— 这就是换项目不用改代码的原因。'))
    }

    // ── merge ───────────────────────────────────────────────────────────────────
    function MergeView() {
      const busy = store.busy !== ''
      const staging = store.staging || []
      const merge = store.merge
      const compat = merge.compat
      const detail = store.detail
      const mode = merge.createName ? 'new' : (detail ? 'current' : 'new')

      return h('div', null,
        h(FcSection, { title: '待合并 (' + staging.length + ')' },
          staging.length === 0
            ? h('div', { className: 'fc-empty' }, '还没有素材。下面选一段，或从工程素材里加。')
            : h('div', { className: 'fc-clips' },
              staging.map(function (path, index) {
                return h('div', { key: path + index, className: 'fc-clip', title: path },
                  h('span', { className: 'fc-clip-n' }, String(index + 1)),
                  h('span', { className: 'fc-clip-name' }, path.split(/[\\/]/).pop()),
                  h('span', { className: 'fc-btns' },
                    h(FcBtn, { disabled: busy || index === 0, title: '上移', onClick: function () { fcStageMove(path, -1) } }, '↑'),
                    h(FcBtn, { disabled: busy || index === staging.length - 1, title: '下移', onClick: function () { fcStageMove(path, 1) } }, '↓'),
                    h(FcBtn, { danger: true, disabled: busy, title: '移出', onClick: function () { fcUnstage(path) } }, '×')))
              })),
          h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
            h(FcBtn, { disabled: busy || staging.length === 0, onClick: fcUnstageAll }, '清空'))),

        h(FcSection, { title: '添加素材' },
          h('div', { className: 'fc-btns', style: { marginBottom: '6px' } },
            h(FcBtn, { disabled: busy, onClick: function () { fcBrowse(store.browse.path || '') } }, '浏览目录'),
            h(FcBtn, { disabled: busy, title: '用「添加素材」选中的文件' }, '添加到列表')),
          store.assets.length > 0 ? h('div', null,
            h('div', { className: 'fc-sub' }, '当前工程素材（点一下加入）：'),
            h('div', { className: 'fc-chips' },
              store.assets.map(function (asset) {
                if (!asset.path) return null
                const staged = fcStagingIndex(asset.path) >= 0
                return h('button', {
                  key: 'a-' + asset.item, className: 'fc-chip' + (staged ? ' on' : ''), type: 'button',
                  title: asset.path + (asset.online === false ? '（离线）' : ''),
                  disabled: busy,
                  onClick: function () { if (staged) fcUnstage(asset.path); else fcStage(asset.path) },
                }, (asset.online === false ? '⚠ ' : '') + fcShort(asset.name, 16))
              }).filter(Boolean))) : null,
          h(FcBrowsePicker, { kind: 'media', onPick: fcStage })),

        h(FcSection, { title: '输出' },
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '目 标'),
            h('select', {
              className: 'fc-sel', value: mode, disabled: busy,
              onChange: function (event) {
                const next = event.target.value
                if (next === 'new') { store.merge.createName = merge.createName || fcMergeDefaultName(); store.merge.settings = null }
                else { store.merge.createName = ''; store.merge.settings = null }
                fcEmit()
              },
            },
              detail ? h('option', { value: 'current' }, '合并进当前工程：' + fcShort(detail.name, 14)) : null,
              h('option', { value: 'new' }, '新建工程（推荐）'))),

          mode === 'new' ? h('div', null,
            h('div', { className: 'fc-row' },
              h('span', { className: 'fc-lb' }, '工程名'),
              h('input', {
                className: 'fc-inp', value: merge.createName, disabled: busy,
                placeholder: fcMergeDefaultName() || '合并工程',
                onChange: function (event) { store.merge.createName = event.target.value; fcEmit() },
              })),
            h('div', { className: 'fc-row' },
              h('span', { className: 'fc-lb' }, '目 录'),
              h('input', {
                className: 'fc-inp', value: merge.createDir, disabled: busy,
                placeholder: store.workspace && store.workspace.paths ? store.workspace.paths.projects : '',
                onChange: function (event) { store.merge.createDir = event.target.value; fcEmit() },
              }))) : null,

          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '序列名'),
            h('input', {
              className: 'fc-inp', value: merge.name, disabled: busy, placeholder: '合并序列',
              onChange: function (event) { store.merge.name = event.target.value; fcEmit() },
            })),

          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '导 出'),
            h('label', { className: 'fc-clip-name', style: { display: 'flex', alignItems: 'center', gap: '5px' } },
              h('input', {
                type: 'checkbox', checked: merge.exportAfter === true,
                onChange: function (event) { store.merge.exportAfter = event.target.checked; fcEmit() },
              }),
              '合并完直接导出成片（' + Math.round(store.scale * 100) + '% 缩放）')),

          h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
            h(FcBtn, {
              primary: true, disabled: busy || staging.length === 0,
              onClick: function () {
                fcMergeRun({
                  name: merge.name,
                  createName: mode === 'new' ? (merge.createName || fcMergeDefaultName()) : '',
                  overwrite: false,
                })
              },
            }, '开始合并 (' + staging.length + ' 段)')),

          h('div', { className: 'fc-hint' },
            '合并 = 把 N 段素材按这个顺序摆到同一条视频轨上（音轨联动），一次 undo 落位。',
            '引擎没有 ffmpeg 那种无损拼接，所以「合并」的可编辑形态是时间线上的排列，成片靠导出渲染。')),

        compat === null ? null : h(FcSection, { title: '兼容性' },
          compat.warnings && compat.warnings.length > 0
            ? compat.warnings.map(function (text, index) {
              return h('div', { key: 'w' + index, className: 'fc-toast err' }, text)
            })
            : h('div', { className: 'fc-toast' }, '检查了 ' + compat.checked + ' 段，尺寸与帧率一致，不会被动缩放。'),
          compat.rows && compat.rows.length > 0 ? h('div', { className: 'fc-clips' },
            compat.rows.map(function (row) {
              return h('div', { key: 'c' + row.index, className: 'fc-clip' },
                h('span', { className: 'fc-clip-n' }, String(row.index + 1)),
                h('span', { className: 'fc-clip-name' }, row.name),
                h('span', { className: 'fc-clip-t' }, row.width + '×' + row.height + ' · ' + row.fps + 'fps'))
            })) : null),

        merge.result === null ? null : h(FcSection, { title: '结果' },
          h('div', { className: 'fc-note' },
            h('span', null, merge.result.project ? merge.result.project.name : ''),
            h('span', { style: { color: 'var(--dim)' } },
              (merge.result.sequence ? merge.result.sequence.name : '') +
              ' · ' + (Array.isArray(merge.result.itemIds) ? merge.result.itemIds.length : 0) + ' 段')),
          h('div', { className: 'fc-btns' },
            h(FcBtn, { onClick: function () { store.tab = 'edit'; store.staging = []; store.merge.result = null; fcEmit() } }, '去剪辑'))))
    }

    // ── settings ────────────────────────────────────────────────────────────────
    function SettingsView() {
      const workspace = store.workspace
      const busy = store.busy !== ''
      const pair = React.useState({ root: '', cli: '', name: '' })
      const form = pair[0]
      const setForm = function (patch) { pair[1](Object.assign({}, pair[0], patch)) }
      if (workspace === null) return h('div', { className: 'fc-empty' }, '正在读取工作区…')
      const presets = (workspace.presets || [])

      return h('div', null,
        h(FcSection, { title: '工作区' },
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '目 录'),
            h('input', {
              className: 'fc-inp', value: form.root || workspace.rootDisplay, disabled: busy,
              onChange: function (event) { setForm({ root: event.target.value }) },
            })),
          h('div', { className: 'fc-btns' },
            h(FcBtn, { primary: true, disabled: busy, onClick: function () { fcSetRoot(form.root || workspace.rootDisplay) } }, '保存并切换'),
            h(FcBtn, { disabled: busy, onClick: function () { fcSetRoot(workspace.rootDisplay) } }, '还原'),
            h(FcBtn, { onClick: function () { fcBrowse(form.root || workspace.rootDisplay) } }, '浏览')),
          h('div', { className: 'fc-hint' },
            '切换工作区会重建注册表位置（projects/ exports/ jobs/ work/ 都在它下面），已登记的工程不会自动带过去 —— 换回来即可。')),

        h(FcSection, { title: 'CLI' },
          h('div', { className: 'fc-row' },
            h('span', { className: 'fc-lb' }, '路 径'),
            h('input', {
              className: 'fc-inp', value: form.cli || (workspace.cli ? workspace.cli.path : ''), disabled: busy,
              onChange: function (event) { setForm({ cli: event.target.value }) },
            })),
          h('div', { className: 'fc-btns' },
            h(FcBtn, { disabled: busy, onClick: function () { fcSetCli(form.cli || (workspace.cli ? workspace.cli.path : '')) } }, '保存'),
            h(FcBadge, { kind: workspace.cli && workspace.cli.exists ? 'ok' : 'err' },
              workspace.cli && workspace.cli.exists ? '可达' : '找不到')),
          h('div', { className: 'fc-hint' }, '每次编辑都会启动一个 filmcraft-cli 进程，改完立即生效。')),

        h(FcSection, { title: '调色预设 (' + presets.length + ')' },
          h('div', { className: 'fc-clips' },
            presets.map(function (preset) {
              return h('div', { key: preset.id, className: 'fc-clip' },
                h('span', { className: 'fc-g' + (preset.builtin ? ' none' : ''), style: { background: preset.color || 'var(--bar)' } }),
                h('span', { className: 'fc-clip-name' }, preset.name),
                h('span', { className: 'fc-clip-t' }, preset.builtin ? '内置' : '自定义'),
                preset.builtin ? null : h(FcBtn, {
                  danger: true, disabled: busy, title: '删除这个预设',
                  onClick: function () { fcPresetRemove(preset.id) },
                }, '删除'))
            })),
          h('div', { className: 'fc-row', style: { marginTop: '6px' } },
            h('span', { className: 'fc-lb' }, '新预设'),
            h('input', {
              className: 'fc-inp', value: form.name, placeholder: '把选中片段的调色另存为…',
              onChange: function (event) { setForm({ name: event.target.value }) },
            }),
            h(FcBtn, {
              disabled: busy, onClick: async function () {
                const clip = fcSelectedClip()
                if (!clip) { fcFail('先到「剪辑」页选一个已调色的片段'); return }
                let lumetri = null
                for (const effect of clip.effects || []) if (effect.effect === 'lumetri') lumetri = effect
                if (!lumetri) { fcFail('这个片段没有调色效果，先套一个预设'); return }
                const params = {}
                for (const key of Object.keys(lumetri.params || {})) {
                  const value = lumetri.params[key]
                  if (typeof value === 'number' || typeof value === 'boolean') params[key] = value
                }
                await fcPresetSave({ name: form.name || '自定义 ' + (presets.length + 1), params: params, color: '#8b949e' })
                setForm({ name: '' })
              },
            }, '另存为')),
          h('div', { className: 'fc-hint' },
            '内置预设不可改也不可删。想调整就从片段「另存为」出一个自己的。')),

        h(FcSection, { title: '信息' },
          h('div', { className: 'fc-path' },
            '版本 ' + (workspace.version || '?'),
            h('br'), '注册表 ' + (workspace.paths ? workspace.paths.registry : '?'),
            h('br'), '导出 ' + (workspace.paths ? workspace.paths.exports : '?'),
            h('br'), '任务 ' + (workspace.paths ? workspace.paths.jobs : '?'),
            workspace.legacyRoot ? h('br') : null,
            workspace.legacyRoot ? '旧版目录 ' + workspace.legacyRoot + '（只读兼容，不再写入）' : null),
          h('div', { className: 'fc-btns', style: { marginTop: '6px' } },
            h(FcBtn, { onClick: function () { store.booted = false; fcBoot() } }, '重新读取工作区'))))
    }

    // ── 99-plugin.js ─────────────────────────────────────────────────
    // ── plugin ──────────────────────────────────────────────────────────────────
    // Last module of the client half: this is what `createPlugin()` returns to the
    // module loader. `apply` is the only entry point — registration happens there and
    // nowhere at module scope, because the loader evaluates the module before any
    // context exists.

    return {
      name: 'filmcraft-progress-client',
      inject: ['timer'],
      apply: apply,
    }
    }
    module.exports = createPlugin()
    return module.exports
  },
})
