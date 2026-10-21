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
