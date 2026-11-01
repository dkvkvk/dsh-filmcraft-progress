// ── main ────────────────────────────────────────────────────────────────────
function mcpRegistry() {
  const list = MCP_TOOLS.filter((tool) => !(mcpReadOnly() && tool.write && tool.name !== 'filmcraft_list_projects' && tool.name !== 'filmcraft_presets' && tool.name !== 'filmcraft_jobs'))
  const byName = new Map(list.map((tool) => [tool.name, tool]))
  return { list: () => list, get: (name) => byName.get(name) }
}

if (process.argv.includes('--list-tools')) {
  for (const tool of mcpRegistry().list()) process.stdout.write(tool.name + '\t' + tool.spec.title + '\n')
  process.exit(0)
}
if (process.argv.includes('--version')) { process.stdout.write(PLUGIN_VERSION + '\n'); process.exit(0) }
mcpLog('v' + PLUGIN_VERSION + ' ready, cli=' + winPath(mcpConfig().cliPath) + ', tools=' + mcpRegistry().list().length + (mcpReadOnly() ? ' (read-only)' : ''))
mcpServe(mcpRegistry())
