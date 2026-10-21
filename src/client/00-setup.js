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
