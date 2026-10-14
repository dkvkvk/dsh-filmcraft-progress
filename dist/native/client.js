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
    var host = {
      call: async function (name, arg) {
        var pathMap = { 'progress.state': '/dsh-filmcraft-progress/api/state' }
        var path = pathMap[name]
        if (path === undefined) throw new Error('unsupported progress call: ' + name)
        var response = await fetch(path, { cache: 'no-store' })
        var value = await response.json()
        if (!response.ok) throw new Error(value && value.error ? value.error : 'progress request failed')
        return value
      },
    }
    function createPlugin() {
      // FilmCraft progress client plugin.
      //
      // Primary surface: a DOCKED TAB in the official right sidebar
      // (`sidebar.right.pane.tab`) — it never covers the main UI and is opened/closed
      // with the sidebar's own controls.
      // Fallback (only when that sidebar service is unavailable): a non-modal,
      // right-docked drawer with no backdrop; Esc or × closes it.
      // Also exposed as a settings section.
      //
      // `React`, `styles` and `host` are injected by scripts/build-native.mjs.
      return {
        name: 'filmcraft-progress-client',
        inject: ['timer'],
        apply(ctx) {
          const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
          if (slots === undefined) return
          const h = React.createElement
      
          const TAB_KIND = 'filmcraft-progress'
          const TAB_ID = 'dsh-filmcraft-progress/panel'
          const TAB_TITLE = '剪辑进度'
      
          // ── panel routing: official sidebar tab when available, drawer otherwise ──
          let sidebarReady = false
          let openPanel = function () { setDrawerOpen(true) }
      
          let drawerOpen = false
          const drawerListeners = new Set()
          function setDrawerOpen(next) {
            drawerOpen = next
            for (const listener of drawerListeners) listener(next)
          }
          function useDrawerOpen() {
            const pair = React.useState(drawerOpen)
            React.useEffect(function () {
              drawerListeners.add(pair[1])
              return function () { drawerListeners.delete(pair[1]) }
            }, [])
            return pair[0]
          }
      
          // ── shared progress store (one poller for every surface) ──────────────────
          const store = { state: null, error: '', listeners: new Set(), timer: null, busy: false }
          function publish() {
            for (const listener of store.listeners) listener({ state: store.state, error: store.error })
          }
          async function poll() {
            if (store.busy) return
            store.busy = true
            try {
              store.state = await host.call('progress.state', {})
              store.error = ''
            } catch (error) {
              store.error = error && error.message ? error.message : String(error)
            } finally {
              store.busy = false
              publish()
            }
          }
          function ensurePolling() {
            if (store.timer !== null) return
            poll()
            store.timer = setInterval(poll, 2000)
          }
          function useProgress() {
            const pair = React.useState({ state: store.state, error: store.error })
            React.useEffect(function () {
              store.listeners.add(pair[1])
              ensurePolling()
              return function () { store.listeners.delete(pair[1]) }
            }, [])
            return pair[0]
          }
      
          // ── styles ───────────────────────────────────────────────────────────────
          ctx.effect(function () {
            return styles.insert([
              '.fc-root{--bg:#fff;--fg:#1f2328;--dim:#656d76;--line:#d0d7de;--soft:#f6f8fa;--ok:#1a7f37;--run:#9a6700;--err:#cf222e;--bar:#0969da;box-sizing:border-box;color:var(--fg);font-family:"SF Mono","JetBrains Mono","Cascadia Code",Consolas,monospace;letter-spacing:-.01em}',
              '@media (prefers-color-scheme:dark){.fc-root{--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--line:#30363d;--soft:#161b22;--ok:#3fb950;--run:#d29922;--err:#f85149;--bar:#2f81f7}}',
              '.fc-root *{box-sizing:border-box;font-family:inherit}',
              '.fc-wrap{width:100%;padding:12px;font-size:12px;line-height:1.55}',
              '.fc-wrap.wide{max-width:1100px;margin:0 auto;padding:20px}',
              '.fc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--line)}',
              '.fc-title{margin:0;font-size:13px;font-weight:700}',
              '.fc-wrap.wide .fc-title{font-size:15px}',
              '.fc-sub{margin-top:3px;color:var(--dim);font-size:10px;word-break:break-word}',
              '.fc-badge{display:inline-flex;align-items:center;gap:5px;min-height:20px;padding:2px 7px;border:1px solid var(--line);border-radius:3px;background:var(--soft);color:var(--dim);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}',
              '.fc-badge.run{color:var(--run);border-color:var(--run)}',
              '.fc-badge.ok{color:var(--ok);border-color:var(--ok)}',
              '.fc-badge.err{color:var(--err);border-color:var(--err)}',
              '.fc-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}',
              '.fc-badge.run .fc-dot{animation:fc-pulse 1.2s ease-in-out infinite}',
              '@keyframes fc-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
              '.fc-bar{position:relative;height:18px;margin:12px 0 6px;border:1px solid var(--line);border-radius:4px;background:var(--soft);overflow:hidden}',
              '.fc-bar-fill{height:100%;background:var(--bar);transition:width .6s ease}',
              '.fc-bar-txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}',
              '.fc-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:10px 0}',
              '.fc-wrap.wide .fc-stats{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}',
              '.fc-stat{padding:6px 8px;border:1px solid var(--line);border-radius:4px;background:var(--soft);min-width:0}',
              '.fc-stat-k{color:var(--dim);font-size:9px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
              '.fc-stat-v{margin-top:2px;font-size:12px;font-weight:700;word-break:break-all}',
              '.fc-wrap.wide .fc-stat-v{font-size:14px}',
              '.fc-sec{margin-top:14px}',
              '.fc-sec-h{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:10px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}',
              '.fc-sec-h::after{content:"";flex:1;height:1px;background:var(--line)}',
              '.fc-shots{display:flex;flex-direction:column;gap:3px;max-height:260px;overflow:auto}',
              '.fc-wrap.wide .fc-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px;max-height:none}',
              '.fc-shot{display:flex;align-items:baseline;gap:6px;padding:4px 7px;border:1px solid var(--line);border-radius:3px;background:var(--soft);white-space:nowrap;overflow:hidden}',
              '.fc-cat{width:5px;height:5px;border-radius:50%;flex:0 0 auto}',
              '.fc-shot-n{color:var(--dim);font-size:9px;min-width:16px}',
              '.fc-shot-tag{font-weight:700;font-size:11px}',
              '.fc-shot-t{color:var(--dim);font-size:9px;margin-left:auto}',
              '.fc-crop{margin-left:4px;padding:0 3px;border:1px solid var(--run);border-radius:2px;color:var(--run);font-size:9px;font-weight:700}',
              '.fc-table{width:100%;border-collapse:collapse;table-layout:fixed}',
              '.fc-table th,.fc-table td{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left;font-size:10px;word-break:break-word}',
              '.fc-table th{color:var(--dim);font-size:9px;text-transform:uppercase;letter-spacing:.04em}',
              '.fc-table td.k{color:var(--dim);white-space:nowrap;width:38%}',
              '.fc-note{display:flex;gap:8px;padding:6px 8px;border-left:3px solid var(--line);background:var(--soft);margin-bottom:5px;font-size:10px}',
              '.fc-alert{padding:10px;border:1px solid var(--err);border-radius:4px;color:var(--err);background:var(--soft);margin-top:10px;font-size:10px;word-break:break-word}',
              '.fc-empty{padding:20px 8px;text-align:center;color:var(--dim)}',
              '.fc-path{margin-top:10px;color:var(--dim);font-size:9px;word-break:break-all;line-height:1.5}',
              // fallback drawer: docked right, NO backdrop — the main UI stays usable
              '.fc-drawer{position:fixed;top:44px;right:10px;bottom:10px;z-index:1200;width:min(340px,calc(100vw - 20px));display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;background:var(--bg);box-shadow:0 8px 30px rgba(0,0,0,.28);overflow:hidden}',
              '.fc-drawer-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--soft);flex:0 0 auto}',
              '.fc-drawer-hd b{font-size:11px}',
              '.fc-drawer-bd{flex:1;overflow:auto}',
              '.fc-x{width:24px;height:24px;padding:0;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--dim);font:inherit;font-size:14px;line-height:1;cursor:pointer;flex:0 0 auto}',
              '.fc-x:hover{color:var(--err);border-color:var(--err)}',
              // sidebar entry
              '.fc-entry{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-align:left}',
              '.fc-entry:hover{background:var(--soft)}',
              '.fc-entry.rail{justify-content:center;padding:6px}',
              '.fc-entry-gl{flex:0 0 auto;display:inline-flex}',
              '.fc-entry-lb{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
              '.fc-entry-pct{margin-left:auto;color:var(--bar);font-size:10px;font-weight:700}',
              '.fc-entry.rail .fc-entry-pct{display:none}',
            ].join(''))
          })
      
          // ── helpers ──────────────────────────────────────────────────────────────
          const CAT_COLOR = { trail: '#3fb950', sea: '#2f81f7', cat: '#d29922' }
          const CAT_LABEL = { trail: '山路', sea: '海景', cat: '猫' }
          const PHASE_LABEL = {
            idle: '待机', plan: '规划', import: '导入素材', build: '搭建时间线',
            grade: '调色', crop: '裁剪画面', export: '导出中', done: '已完成', error: '出错',
          }
          function tc(sec) {
            if (typeof sec !== 'number' || !isFinite(sec)) return '—'
            const m = Math.floor(sec / 60)
            const s = sec - m * 60
            return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1)
          }
          function phaseClass(phase) {
            if (phase === 'done') return 'ok'
            if (phase === 'error') return 'err'
            if (phase === 'idle') return ''
            return 'run'
          }
          function Badge(props) {
            return h('span', { className: 'fc-badge ' + (props.state || '') },
              props.pulse ? h('span', { className: 'fc-dot' }) : null,
              props.children)
          }
          function Stat(props) {
            return h('div', { className: 'fc-stat' },
              h('div', { className: 'fc-stat-k' }, props.k),
              h('div', { className: 'fc-stat-v' }, props.v))
          }
      
          // ── panel body (shared by the sidebar tab / drawer / settings page) ───────
          function Panel(props) {
            const wide = !!(props && props.wide)
            const snap = useProgress()
            const st = snap.state
            const wrap = 'fc-wrap' + (wide ? ' wide' : '')
      
            if (snap.error && st === null) {
              return h('div', { className: 'fc-root' }, h('div', { className: wrap },
                h('div', { className: 'fc-alert' }, '无法读取进度：' + snap.error)))
            }
            if (st === null) {
              return h('div', { className: 'fc-root' }, h('div', { className: wrap },
                h('div', { className: 'fc-empty' }, '正在连接…')))
            }
            if (!st.ok) {
              return h('div', { className: 'fc-root' }, h('div', { className: wrap },
                h('div', { className: 'fc-head' },
                  h('div', null,
                    h('h2', { className: 'fc-title' }, 'FilmCraft 剪辑进度'),
                    h('div', { className: 'fc-sub' }, '等待任务开始')),
                  h(Badge, { state: '' }, '待机')),
                h('div', { className: 'fc-empty' }, '当前没有进行中的剪辑任务'),
                h('div', { className: 'fc-path' }, '进度文件：' + st.statusPath),
                st.error ? h('div', { className: 'fc-alert' }, st.error) : null))
            }
      
            const pct = st.percent
            const video = st.video || {}
            const tl = st.timeline || {}
            const shots = st.shots || []
            const grades = st.grades || {}
            const notes = st.notes || []
      
            return h('div', { className: 'fc-root' }, h('div', { className: wrap },
              h('div', { className: 'fc-head' },
                h('div', { style: { minWidth: 0 } },
                  h('h2', { className: 'fc-title' }, st.project || 'FilmCraft 剪辑进度'),
                  h('div', { className: 'fc-sub' },
                    [video.width && video.height ? video.width + '×' + video.height : '',
                      video.fps ? video.fps + 'fps' : '',
                      shots.length ? shots.length + ' 个镜头' : ''].filter(Boolean).join(' · '))),
                h(Badge, { state: phaseClass(st.phase), pulse: st.running },
                  st.phaseLabel || PHASE_LABEL[st.phase] || st.phase)),
      
              pct === null ? null : h('div', null,
                h('div', { className: 'fc-bar' },
                  h('div', { className: 'fc-bar-fill', style: { width: Math.min(100, pct) + '%' } }),
                  h('div', { className: 'fc-bar-txt' }, pct.toFixed(1) + '%')),
                h('div', { className: 'fc-sub' },
                  (st.percentBasis === 'bytes' ? '按输出文件大小估算' : '按耗时估算') +
                  (st.message ? ' · ' + st.message : ''))),
      
              h('div', { className: 'fc-stats' },
                h(Stat, { k: '已用时', v: st.elapsedText }),
                h(Stat, { k: '预计剩余', v: st.etaText }),
                h(Stat, { k: '写入速度', v: st.export.rateText }),
                h(Stat, { k: '输出大小', v: st.export.bytesText })),
      
              shots.length ? h('div', { className: 'fc-sec' },
                h('div', { className: 'fc-sec-h' }, '分镜表 (' + shots.length + ')'),
                h('div', { className: 'fc-shots' }, shots.map(function (s, i) {
                  return h('div', {
                    className: 'fc-shot', key: i,
                    title: (CAT_LABEL[s.cat] || s.cat || '') + ' · 源 ' + s.tag + ' · 成片 ' + tc(s.start) + ' · ' + (s.dur || 0).toFixed(1) + 's',
                  },
                    h('span', { className: 'fc-cat', style: { background: CAT_COLOR[s.cat] || '#888' } }),
                    h('span', { className: 'fc-shot-n' }, '#' + (s.n || i + 1)),
                    h('span', { className: 'fc-shot-tag' }, s.tag),
                    s.crop ? h('span', { className: 'fc-crop' }, '裁') : null,
                    h('span', { className: 'fc-shot-t' }, tc(s.start)))
                }))) : null,
      
              (tl.width || video.codec) ? h('div', { className: 'fc-sec' },
                h('div', { className: 'fc-sec-h' }, '成片规格'),
                h('table', { className: 'fc-table' }, h('tbody', null,
                  h('tr', null, h('td', { className: 'k' }, '分辨率'),
                    h('td', null, (tl.width || video.width || '?') + '×' + (tl.height || video.height || '?'))),
                  h('tr', null, h('td', { className: 'k' }, '帧率'), h('td', null, (tl.fps || video.fps || '?') + ' fps')),
                  tl.durationSeconds ? h('tr', null, h('td', { className: 'k' }, '总时长'),
                    h('td', null, tc(tl.durationSeconds))) : null,
                  tl.shotCount ? h('tr', null, h('td', { className: 'k' }, '镜头数'), h('td', null, String(tl.shotCount))) : null,
                  st.stats ? h('tr', null, h('td', { className: 'k' }, '分类'),
                    h('td', null, Object.keys(st.stats).map(function (k) {
                      return (CAT_LABEL[k] || k) + ' ' + st.stats[k]
                    }).join(' · '))) : null,
                  video.codec ? h('tr', null, h('td', { className: 'k' }, '编码'),
                    h('td', null, video.codec + (video.bitrateMbps ? ' ' + video.bitrateMbps + 'M' : ''))) : null))) : null,
      
              Object.keys(grades).length ? h('div', { className: 'fc-sec' },
                h('div', { className: 'fc-sec-h' }, '调色参数'),
                h('table', { className: 'fc-table' },
                  h('thead', null, h('tr', null, h('th', null, '分类'), h('th', null, '参数'))),
                  h('tbody', null, Object.keys(grades).map(function (cat) {
                    const g = grades[cat] || {}
                    return h('tr', { key: cat },
                      h('td', { className: 'k' }, CAT_LABEL[cat] || cat),
                      h('td', null, Object.keys(g).map(function (k) { return k + ' ' + g[k] }).join(' · ')))
                  })))) : null,
      
              notes.length ? h('div', { className: 'fc-sec' },
                h('div', { className: 'fc-sec-h' }, '备注'),
                notes.map(function (n, i) { return h('div', { className: 'fc-note', key: i }, h('span', null, n)) })) : null,
      
              st.error ? h('div', { className: 'fc-alert' }, st.error) : null,
      
              h('div', { className: 'fc-path' },
                '输出 ' + (st.export.path || '—') +
                ' · 刷新于 ' + new Date(st.now).toLocaleTimeString('zh-CN'))))
          }
      
          // ── fallback drawer (non-modal, no backdrop) ──────────────────────────────
          function Drawer() {
            const open = useDrawerOpen()
            React.useEffect(function () {
              if (!open) return
              function onKey(e) { if (e.key === 'Escape') setDrawerOpen(false) }
              window.addEventListener('keydown', onKey)
              return function () { window.removeEventListener('keydown', onKey) }
            }, [open])
            if (!open) return null
            return h('div', { className: 'fc-root' }, h('div', { className: 'fc-drawer', role: 'complementary' },
              h('div', { className: 'fc-drawer-hd' },
                h('b', null, TAB_TITLE),
                h('button', {
                  className: 'fc-x', type: 'button', title: '关闭 (Esc)',
                  onClick: function () { setDrawerOpen(false) },
                }, '×')),
              h('div', { className: 'fc-drawer-bd' }, h(Panel, null))))
          }
      
          // ── right-sidebar tab install (the official, non-covering surface) ────────
          const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.6" y="3" width="12.8" height="10" rx="2"/><path d="M6.2 6.4l3.4 1.6-3.4 1.6z"/></svg>'
          function TabIcon() {
            return h('span', { style: { display: 'inline-flex' }, dangerouslySetInnerHTML: { __html: ICON } })
          }
      
          ctx.effect(function () {
            if (typeof slots.inject !== 'function') return function () { }
            return slots.inject('sidebar.right.pane.tab', function () {
              let disposed = false
              let poll = 0
              let off = null
      
              function attempt() {
                if (disposed) return
                // The seat is declared before the service is ready, so poll briefly.
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
                    id: TAB_ID,
                    kind: TAB_KIND,
                    keepMounted: true,
                    title: function () { return TAB_TITLE },
                    guide: [{
                      id: 'progress',
                      order: 120,
                      title: function () { return TAB_TITLE },
                      description: function () { return 'FilmCraft 剪辑与调色进度' },
                      icon: TabIcon,
                    }],
                  })
                  disposeBody = slots.register(
                    { name: 'sidebar.right.pane.tab', key: TAB_ID },
                    function () { return h(Panel, null) },
                  )
                } catch (_) {
                  // id clash or shape mismatch: stay on the drawer fallback
                  try { if (disposeTabs) disposeTabs() } catch (e) { }
                  try { if (disposeBody) disposeBody() } catch (e) { }
                  return
                }
                sidebarReady = true
                openPanel = function () { try { ctrl.openTab(TAB_KIND) } catch (_) { setDrawerOpen(true) } }
                off = function () {
                  try { disposeBody() } catch (e) { }
                  try { disposeTabs() } catch (e) { }
                  sidebarReady = false
                  openPanel = function () { setDrawerOpen(true) }
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
      
          // ── sidebar footer entry: opens the docked tab ───────────────────────────
          function FooterAction(props) {
            const wide = !(props && props.wide === false)
            const snap = useProgress()
            const st = snap.state
            const running = !!(st && st.ok && st.running)
            const pct = st && st.ok && st.percent !== null && st.percent !== undefined ? st.percent : null
            return h('button', {
              className: wide ? 'fc-entry' : 'fc-entry rail',
              type: 'button',
              title: running && pct !== null ? '剪辑进行中 ' + pct.toFixed(0) + '%' : TAB_TITLE,
              onClick: function () { openPanel() },
            },
              h('span', { className: 'fc-entry-gl', dangerouslySetInnerHTML: { __html: ICON } }),
              wide ? h('span', { className: 'fc-entry-lb' }, TAB_TITLE) : null,
              running && pct !== null && wide ? h('span', { className: 'fc-entry-pct' }, pct.toFixed(0) + '%') : null)
          }
      
          // ── register ─────────────────────────────────────────────────────────────
          slots.inject('settings.section', function () {
            return slots.register(
              { name: 'settings.section', id: 'filmcraft-progress', order: 13, label: TAB_TITLE },
              function () { return h(Panel, { wide: true }) })
          })
          // Mount point for the fallback drawer. It renders nothing whenever the
          // official right-sidebar tab registered successfully — so in the normal
          // case this plugin never draws anything over the main UI.
          slots.inject('shell.overlay', function () {
            return slots.register(
              { name: 'shell.overlay', id: 'filmcraft-progress', order: 6, label: TAB_TITLE },
              function () { return sidebarReady ? null : h(Drawer, null) })
          })
          slots.inject('sidebar.footer.action', function () {
            return slots.register(
              { name: 'sidebar.footer.action', id: 'filmcraft-progress', order: 91, label: TAB_TITLE },
              FooterAction)
          })
        },
      }
    }
    module.exports = createPlugin()
    return module.exports
  },
})
