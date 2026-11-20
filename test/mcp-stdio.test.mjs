import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../dist/mcp/filmcraft-mcp.mjs', import.meta.url))

test('MCP flushes all piped replies when stdin closes', () => {
  // Keep requests small and their replies large enough to fill an async pipe.
  const ids = Array.from({ length: 128 }, (_, id) => id)
  const input = ids.map((id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }) + '\n').join('')
  const child = spawnSync(process.execPath, [entry], {
    input,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  })

  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  const lines = child.stdout.split('\n')
  assert.equal(lines.length - 1, ids.length, 'expected one complete line per request')
  assert.equal(lines.pop(), '')
  const replies = lines.map((line) => JSON.parse(line))
  assert.deepEqual(replies.map((reply) => reply.id), ids)
  assert.ok(replies.every((reply) => reply.jsonrpc === '2.0' && Array.isArray(reply.result?.tools)))
})
