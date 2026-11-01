// ── guard ───────────────────────────────────────────────────────────────────
// The MCP server is driven by a model, so it gets a narrower surface than the
// panel: file paths it reads or writes must sit inside an allowed root, and the
// whole write half can be switched off.
//
//   FILMCRAFT_MCP_ROOTS     extra roots, separated by ';' (or ':' on POSIX)
//   FILMCRAFT_MCP_READONLY  1 = only read/preview tools are listed
//   FILMCRAFT_CLI           override cliPath from config.json for this server
//   FILMCRAFT_WORKSPACE     override the workspace root for this server
//
// Default roots: the workspace root plus the folder of every registered project
// (footage usually lives next to the project).

function mcpEnv(name) {
  const value = typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

function mcpNormalize(p) {
  const s = uniqSlashes(p)
  const drive = /^[A-Za-z]:/.test(s) ? s.slice(0, 2) : ''
  const rest = drive ? s.slice(2) : s
  const absolute = rest.startsWith('/')
  const out = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return drive + (absolute ? '/' : '') + out.join('/')
}

function mcpIsAbsolute(p) { const s = uniqSlashes(p); return s.startsWith('/') || /^[A-Za-z]:\//.test(s) }

function mcpConfig() {
  const config = loadConfig()
  const cli = mcpEnv('FILMCRAFT_CLI')
  const root = mcpEnv('FILMCRAFT_WORKSPACE')
  if (cli) config.cliPath = uniqSlashes(cli)
  if (root) config.root = uniqSlashes(root)
  return config
}

function mcpRoots(config, registry) {
  const roots = [mcpNormalize(config.root)]
  for (const project of registry.projects || []) if (project.file) roots.push(mcpNormalize(dirOf(project.file)))
  const extra = mcpEnv('FILMCRAFT_MCP_ROOTS')
  if (extra) {
    const sep = extra.indexOf(';') >= 0 || /^[A-Za-z]:/.test(extra) ? ';' : ':'
    for (const part of extra.split(sep)) if (part.trim() !== '') roots.push(mcpNormalize(part.trim()))
  }
  const seen = new Set()
  return roots.filter((root) => { const key = root.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true })
}

function mcpInside(root, target) {
  const r = root.toLowerCase().replace(/\/+$/, '')
  const t = target.toLowerCase()
  return t === r || t.startsWith(r + '/')
}

function mcpGuardPath(config, registry, p, what) {
  if (typeof p !== 'string' || p.trim() === '') throw new Error((what || '路径') + ' 不能为空')
  if (!mcpIsAbsolute(p)) throw new Error((what || '路径') + ' 必须是绝对路径: ' + p)
  const normalized = mcpNormalize(p)
  const roots = mcpRoots(config, registry)
  for (const root of roots) if (mcpInside(root, normalized)) return normalized
  throw new Error((what || '路径') + ' 不在允许的目录内: ' + winPath(normalized) + '。允许: ' + roots.map(winPath).join(' ; ') + '（可用环境变量 FILMCRAFT_MCP_ROOTS 追加）')
}

function mcpReadOnly() { return mcpEnv('FILMCRAFT_MCP_READONLY') === '1' }
