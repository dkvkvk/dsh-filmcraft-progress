// ── protocol ────────────────────────────────────────────────────────────────
// MCP over stdio: newline-delimited JSON-RPC 2.0. Hand-rolled on purpose — the
// plugin ships with zero runtime dependencies and the stdio transport is a few
// dozen lines. stdout carries protocol messages only; diagnostics go to stderr.

const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MCP_SERVER_NAME = 'filmcraft'

function mcpLog() {
  const parts = []
  for (let i = 0; i < arguments.length; i += 1) parts.push(typeof arguments[i] === 'string' ? arguments[i] : JSON.stringify(arguments[i]))
  try { process.stderr.write('[filmcraft-mcp] ' + parts.join(' ') + '\n') } catch (_) { }
}

function mcpSend(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}
function mcpReply(id, result) { mcpSend({ jsonrpc: '2.0', id: id, result: result }) }
function mcpFail(id, code, message, data) {
  const error = { code: code, message: message }
  if (data !== undefined) error.data = data
  mcpSend({ jsonrpc: '2.0', id: id, error: error })
}

// Requests are handled strictly one at a time. Every edit is a synchronous CLI
// call anyway, and ordering is what an agent expects from "trim, then preview".
let mcpQueue = Promise.resolve()

function mcpHandle(message, registry) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    if (message && message.id !== undefined) mcpFail(message.id, -32600, 'invalid request')
    return Promise.resolve()
  }
  const isRequest = message.id !== undefined && message.id !== null
  const method = message.method
  const params = message.params || {}

  if (method === 'initialize') {
    const asked = params.protocolVersion
    mcpReply(message.id, {
      protocolVersion: MCP_VERSIONS.indexOf(asked) >= 0 ? asked : MCP_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, title: 'FilmCraft 剪辑', version: PLUGIN_VERSION },
      instructions: MCP_INSTRUCTIONS,
    })
    return Promise.resolve()
  }
  if (!isRequest) return Promise.resolve()                 // notifications/*: nothing to do
  if (method === 'ping') { mcpReply(message.id, {}); return Promise.resolve() }
  if (method === 'tools/list') {
    mcpReply(message.id, { tools: registry.list().map((tool) => tool.spec) })
    return Promise.resolve()
  }
  if (method === 'tools/call') {
    const tool = registry.get(params.name)
    if (!tool) { mcpFail(message.id, -32602, 'unknown tool: ' + String(params.name)); return Promise.resolve() }
    return Promise.resolve()
      .then(() => tool.run(params.arguments || {}))
      .then((value) => mcpReply(message.id, mcpToolResult(value, false)))
      .catch((error) => mcpReply(message.id, mcpToolResult({ ok: false, error: error && error.message ? error.message : String(error) }, true)))
  }
  if (method === 'resources/list') { mcpReply(message.id, { resources: [] }); return Promise.resolve() }
  if (method === 'prompts/list') { mcpReply(message.id, { prompts: [] }); return Promise.resolve() }
  mcpFail(message.id, -32601, 'method not found: ' + method)
  return Promise.resolve()
}

// A tool may return { __images: [{ data, mimeType }], ...json } to attach frames.
function mcpToolResult(value, isError) {
  const content = []
  let body = value
  if (value && typeof value === 'object' && Array.isArray(value.__images)) {
    body = Object.assign({}, value)
    delete body.__images
    for (const image of value.__images) content.push({ type: 'image', data: image.data, mimeType: image.mimeType || 'image/png' })
  }
  content.unshift({ type: 'text', text: JSON.stringify(body, null, 2) })
  const result = { content: content, isError: isError === true }
  if (body && typeof body === 'object' && !Array.isArray(body)) result.structuredContent = body
  return result
}

function mcpServe(registry) {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (line === '') continue
      let message
      try { message = JSON.parse(line) } catch (_) { mcpFail(null, -32700, 'parse error'); continue }
      const batch = Array.isArray(message) ? message : [message]
      for (const entry of batch) {
        mcpQueue = mcpQueue.then(() => mcpHandle(entry, registry)).catch((error) => mcpLog('handler crashed', String(error && error.stack || error)))
      }
    }
  })
  process.stdin.on('end', () => {
    // Queued handlers can finish before their replies reach the stdout pipe.
    mcpQueue.then(() => process.stdout.end(() => process.exit(0)))
  })
}
