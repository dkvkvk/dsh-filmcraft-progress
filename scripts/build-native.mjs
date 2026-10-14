import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const host = readFileSync(join(root, 'src', 'dynamic', 'host.js'), 'utf8').trimEnd()
const client = readFileSync(join(root, 'src', 'dynamic', 'client.js'), 'utf8').trimEnd()
const nativeDir = join(root, 'dist', 'native')
const indent = (value, spaces) => value.split('\n').map((line) => ' '.repeat(spaces) + line).join('\n')

const PKG = 'dsh-filmcraft-progress'
const BASE = '/dsh-filmcraft-progress/api'

// Every host handler and the HTTP route that exposes it.  GET for reads,
// POST for anything that edits a project or starts work.
const ROUTES = [
  ['progress.state', 'GET', BASE + '/state'],
  ['edit.projects', 'GET', BASE + '/projects'],
  ['edit.open', 'POST', BASE + '/open'],
  ['edit.apply', 'POST', BASE + '/apply'],
  ['edit.undo', 'POST', BASE + '/undo'],
  ['edit.export', 'POST', BASE + '/export'],
]

// `type: 'json'` is not a valid JSON-Schema type — widen it.
const hostBody = host.replaceAll("schema: { type: 'json' }", "schema: { type: 'object', additionalProperties: true }")

const routeTable = '{\n' + ROUTES
  .map(([key, method, path]) => `      '${key}': { method: '${method}', path: '${path}' },`)
  .join('\n') + '\n    }'

const nativeHost = [
  "import { readFileSync, statSync, existsSync, readdirSync, openSync, closeSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'",
  "import { spawnSync, spawn } from 'node:child_process'",
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
  'function readBody(req) {',
  '  return new Promise((resolve, reject) => {',
  "    let raw = ''",
  "    req.on('data', (chunk) => {",
  '      raw += chunk',
  "      if (raw.length > 4e6) { reject(new Error('request body too large')); req.destroy() }",
  '    })',
  "    req.on('end', () => {",
  "      if (!raw) return resolve(null)",
  "      try { resolve(JSON.parse(raw)) } catch (_) { reject(new Error('invalid JSON body')) }",
  '    })',
  "    req.on('error', reject)",
  '  })',
  '}',
  '',
  'function registerRoute(ctx, route, handler, label) {',
  '  return ctx.effect(() => ctx.webServer.register({',
  "    kind: 'exact',",
  '    path: route.path,',
  '    async handler(req, res) {',
  '      const send = (code, value) => {',
  "        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })",
  '        res.end(JSON.stringify(value))',
  '      }',
  "      if (req.method !== route.method) return send(405, { error: 'method not allowed' })",
  '      try {',
  "        const body = req.method === 'POST' ? await readBody(req) : null",
  '        send(200, await handler(body))',
  '      } catch (error) {',
  "        send(500, { error: error instanceof Error ? error.message : String(error) })",
  '      }',
  '    },',
  '  }), label)',
  '}',
  '',
  'export function apply(ctx) {',
  '  const routes = ' + routeTable,
  '  const harness = {',
  '    defineTool,',
  '    registerTool(_context, tool) {',
  "      return ctx.effect(() => ctx.tools.register(tool), '" + PKG + ": tool ' + tool.name)",
  '    },',
  '    handle(key, handler) {',
  '      const route = routes[key]',
  "      if (route === undefined) throw new Error('unsupported handler: ' + key)",
  "      return registerRoute(ctx, route, (body) => handler(body || {}), '" + PKG + ": ' + key)",
  '    },',
  '  }',
  '  return createPlugin(harness).apply(ctx)',
  '}',
  '',
].join('\n')

const clientRoutes = '{\n' + ROUTES
  .map(([key, method, path]) => `        '${key}': ['${method}', '${path}'],`)
  .join('\n') + '\n      }'

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
  '        var routes = ' + clientRoutes,
  '        var route = routes[name]',
  "        if (route === undefined) throw new Error('unsupported call: ' + name)",
  "        var init = { cache: 'no-store' }",
  "        if (route[0] === 'POST') {",
  "          init.method = 'POST'",
  "          init.headers = { 'content-type': 'application/json' }",
  '          init.body = JSON.stringify(arg || {})',
  '        }',
  '        var response = await fetch(route[1], init)',
  '        var value = await response.json()',
  "        if (!response.ok) throw new Error(value && value.error ? value.error : 'request failed')",
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
console.log('  routes:')
for (const [key, method, path] of ROUTES) console.log('    ' + method.padEnd(5) + path + '   (' + key + ')')
