import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const host = readFileSync(join(root, 'src', 'dynamic', 'host.js'), 'utf8').trimEnd()
const client = readFileSync(join(root, 'src', 'dynamic', 'client.js'), 'utf8').trimEnd()
const nativeDir = join(root, 'dist', 'native')
const indent = (value, spaces) => value.split('\n').map((line) => ' '.repeat(spaces) + line).join('\n')

const PKG = 'dsh-filmcraft-progress'
const STATE_PATH = '/dsh-filmcraft-progress/api/state'

// `type: 'json'` is not a valid JSON-Schema type — widen it.
const hostBody = host.replaceAll("schema: { type: 'json' }", "schema: { type: 'object', additionalProperties: true }")

const nativeHost = [
  "import { readFileSync, statSync, existsSync } from 'node:fs'",
  '',
  'function defineTool(options) {',
  '  const properties = {}',
  '  const required = []',
  '  for (const [key, value] of Object.entries(options.parameters)) {',
  '    const { required: isRequired, ...schema } = value',
  '    properties[key] = schema',
  '    if (isRequired) required.push(key)',
  '  }',
  '  return {',
  '    ...options,',
  "    parameters: { type: 'object', properties, required, additionalProperties: false },",
  '  }',
  '}',
  '',
  'function createPlugin(harness) {',
  indent(hostBody, 2),
  '}',
  '',
  'const plugin = createPlugin({})',
  'export const name = plugin.name',
  "export const inject = [...new Set([...plugin.inject, 'webServer'])]",
  '',
  'function registerRoute(ctx, path, handler, label) {',
  '  return ctx.effect(() => ctx.webServer.register({',
  "    kind: 'exact',",
  '    path,',
  '    async handler(req, res) {',
  "      if (req.method !== 'GET') {",
  '        res.writeHead(405)',
  '        res.end()',
  '        return',
  '      }',
  '      try {',
  '        const value = await handler()',
  "        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })",
  '        res.end(JSON.stringify(value))',
  '      } catch (error) {',
  '        res.writeHead(500, { \'content-type\': \'application/json; charset=utf-8\' })',
  "        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))",
  '      }',
  '    },',
  '  }), label)',
  '}',
  '',
  'export function apply(ctx) {',
  '  const harness = {',
  '    defineTool,',
  '    registerTool(_context, tool) {',
  "      return ctx.effect(() => ctx.tools.register(tool), '" + PKG + ": tool ' + tool.name)",
  '    },',
  '    handle(key, handler) {',
  "      if (key === 'progress.state') return registerRoute(ctx, '" + STATE_PATH + "', () => handler({}), '" + PKG + ": state')",
  "      throw new Error('unsupported progress handler: ' + key)",
  '    },',
  '  }',
  '  return createPlugin(harness).apply(ctx)',
  '}',
  '',
].join('\n')

const nativeClient = [
  'window.__ModuleLoader__.load({',
  "  id: '" + PKG + "',",
  '  factory: function (require) {',
  '    var module = { exports: {} }',
  "    var React = require('react')",
  '    var styles = {',
  '      insert: function (css) {',
  "        var element = document.createElement('style')",
  "        element.setAttribute('data-" + PKG + "', '')",
  '        element.textContent = css',
  '        document.head.appendChild(element)',
  '        return function () { element.remove() }',
  '      },',
  '    }',
  '    var host = {',
  '      call: async function (name, arg) {',
  "        var pathMap = { 'progress.state': '" + STATE_PATH + "' }",
  '        var path = pathMap[name]',
  "        if (path === undefined) throw new Error('unsupported progress call: ' + name)",
  "        var response = await fetch(path, { cache: 'no-store' })",
  '        var value = await response.json()',
  "        if (!response.ok) throw new Error(value && value.error ? value.error : 'progress request failed')",
  '        return value',
  '      },',
  '    }',
  '    function createPlugin() {',
  indent(client, 6),
  '    }',
  '    module.exports = createPlugin()',
  '    return module.exports',
  '  },',
  '})',
  '',
].join('\n')

mkdirSync(nativeDir, { recursive: true })
writeFileSync(join(nativeDir, 'index.js'), nativeHost, 'utf8')
writeFileSync(join(nativeDir, 'client.js'), nativeClient, 'utf8')
console.log('Built ' + PKG)
console.log('  dist/native/index.js   ' + nativeHost.length + ' B')
console.log('  dist/native/client.js  ' + nativeClient.length + ' B')