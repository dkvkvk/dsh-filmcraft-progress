// ── styles ──────────────────────────────────────────────────────────────────
// Injected once by apply(). Two rules of the previous version that must survive:
//
//   · the preview box is sized from a *definite height*, with the width derived
//     from the aspect ratio. Sizing it from the panel width makes the wide
//     (settings) surface 825px tall and pushes everything below it off screen.
//   · lists are capped in vh, so a short window shrinks them instead of burying
//     the export section.
//
// The palette follows the shell: light by default, dark under prefers-color-scheme.

function fcCss() {
  return [
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
    // tabs
    '.fc-tabs{display:flex;gap:4px;margin:0 0 12px}',
    '.fc-tab{flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:5px;background:var(--soft);color:var(--dim);font:inherit;font-size:11px;font-weight:700;cursor:pointer}',
    '.fc-tab.on{color:var(--bar);border-color:var(--bar);background:var(--bg)}',
    // form rows
    '.fc-row{display:flex;align-items:center;gap:6px;margin-bottom:6px}',
    '.fc-lb{color:var(--dim);font-size:10px;min-width:32px;flex:0 0 auto}',
    '.fc-inp,.fc-sel{flex:1;min-width:0;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);font:inherit;font-size:11px}',
    '.fc-btn{padding:4px 8px;border:1px solid var(--line);border-radius:4px;background:var(--soft);color:var(--fg);font:inherit;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap}',
    '.fc-btn:hover:not(:disabled){border-color:var(--bar);color:var(--bar)}',
    '.fc-btn:disabled{opacity:.4;cursor:default}',
    '.fc-btn.primary{border-color:var(--bar);color:var(--bar)}',
    '.fc-btn.danger:hover:not(:disabled){border-color:var(--err);color:var(--err)}',
    '.fc-btns{display:flex;flex-wrap:wrap;gap:4px}',
    // sequences
    '.fc-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}',
    '.fc-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 7px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--dim);font:inherit;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.fc-chip.on{color:var(--bar);border-color:var(--bar);background:var(--bg)}',
    // clips
    '.fc-clips{display:flex;flex-direction:column;gap:3px;max-height:min(230px,26vh);overflow:auto;border:1px solid var(--line);border-radius:5px;padding:4px;background:var(--soft)}',
    '.fc-clip{display:flex;align-items:center;gap:6px;padding:5px 6px;border:1px solid transparent;border-radius:3px;cursor:pointer;flex:0 0 auto;min-height:26px;background:var(--bg)}',
    '.fc-clip:hover{border-color:var(--line)}',
    '.fc-clip.on{border-color:var(--bar);background:var(--soft)}',
    '.fc-clip-n{color:var(--dim);font-size:9px;min-width:18px;flex:0 0 auto}',
    '.fc-clip-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}',
    '.fc-clip-t{color:var(--dim);font-size:9px;flex:0 0 auto}',
    '.fc-g{width:6px;height:6px;border-radius:50%;background:var(--bar);flex:0 0 auto}',
    '.fc-g.none{background:var(--line)}',
    // preview: definite height, width derived from the picture's aspect ratio
    '.fc-prev{position:relative;height:min(26vh,200px);aspect-ratio:4/3;width:auto;max-width:100%;margin:0 auto 6px;background:#000;border:1px solid var(--line);border-radius:5px;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.fc-prev-i,.fc-prev-v{width:100%;height:100%;object-fit:contain;display:block}',
    '.fc-prev-none{color:var(--dim);font-size:10px;text-align:center;padding:0 8px}',
    '.fc-prev-ov{position:absolute;right:5px;top:5px;padding:2px 6px;border-radius:3px;background:rgba(0,0,0,.65);color:#fff;font-size:9px}',
    '.fc-fold{cursor:pointer;border:0;background:none;color:var(--dim);font:inherit;font-size:9px;font-weight:700;padding:0;letter-spacing:.05em}',
    '.fc-fold:hover{color:var(--bar)}',
    '.fc-range{flex:1;min-width:0;height:16px;accent-color:var(--bar)}',
    '.fc-num{width:54px;flex:0 0 auto;padding:2px 4px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg);font:inherit;font-size:10px;text-align:center}',
    // jobs
    '.fc-job{padding:6px 7px;border:1px solid var(--line);border-radius:4px;background:var(--soft);margin-bottom:5px}',
    '.fc-job-h{display:flex;align-items:center;gap:6px;margin-bottom:3px}',
    '.fc-job-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700}',
    '.fc-prog{position:relative;height:10px;margin:4px 0;border:1px solid var(--line);border-radius:3px;background:var(--bg);overflow:hidden}',
    '.fc-prog-fill{height:100%;background:var(--bar);transition:width .5s ease}',
    '.fc-meta{color:var(--dim);font-size:9px;word-break:break-all;line-height:1.5}',
    '.fc-toast{padding:6px 8px;border-left:3px solid var(--ok);background:var(--soft);margin:8px 0;font-size:10px;word-break:break-word}',
    '.fc-toast.err{border-left-color:var(--err);color:var(--err)}',
    '.fc-hint{color:var(--dim);font-size:9px;line-height:1.6;margin-top:6px}',
  ].join('')
}
