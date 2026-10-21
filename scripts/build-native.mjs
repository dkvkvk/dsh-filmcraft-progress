// Assembles src/host/*.js and src/client/*.js into dist/native/{index,client}.js.
//
// The plugin runs inside the DSH host process, so it cannot import anything but
// node builtins, and the client half is loaded by the Web GUI's module loader.
// Rather than force each half into one giant file, the halves are written as
// numbered modules that are concatenated **in filename order** and share one
// scope.  That keeps modules file-scoped for editing while producing the single
// function body the loader needs.
//
// Rules for module authors:
//   · top-level `const`/`function` in a module is visible to every later module
//     of the same half — do not redeclare a name in two modules
//   · no `import`/`export` inside a module; the injected names below are already
//     in scope on the host side
//   · module order is the dependency order
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG = 'dsh-filmcraft-progress'
const BASE = '/dsh-filmcraft-progress/api'

const indent = (value, spaces) => value.split('\n').map((line) => (line ? ' '.repeat(spaces) + line : line)).join('\n')

function readModules(dir) {
  const abs = join(root, 'src', dir)
  let names
  try {
    names = readdirSync(abs).filter((n) => n.endsWith('.js')).sort()
  } catch (_) {
    throw new Error('missing module directory: src/' + dir)
  }
  if (names.length === 0) throw new Error('no modules in src/' + dir)
  return names.map((name) => {
    const body = readFileSync(join(abs, name), 'utf8').trimEnd()
    return { name, body }
  })
}

// Every host handler and the HTTP route that exposes it.  GET for reads, POST
// for anything that edits a project or starts work.  kind 'raw' means the
// handler writes the response itself (binary media).
const ROUTES = [
  // ── legacy progress contract ────────────────────────────────────────────
  ['state.read', 'GET', BASE + '/state', 'json'],
  // ── workspace / registry ────────────────────────────────────────────────
  ['workspace.read', 'GET', BASE + '/workspace', 'json'],
  ['workspace.write', 'POST', BASE + '/workspace', 'json'],
  ['projects.list', 'GET', BASE + '/projects', 'json'],
  ['projects.write', 'POST', BASE + '/projects', 'json'],
  // ── one project ─────────────────────────────────────────────────────────
  ['project.read', 'GET', BASE + '/project', 'json'],
  ['project.write', 'POST', BASE + '/project', 'json'],
  ['assets.read', 'GET', BASE + '/assets', 'json'],
  ['browse.read', 'GET', BASE + '/browse', 'json'],
  ['presets.write', 'POST', BASE + '/presets', 'json'],
  // ── editing ─────────────────────────────────────────────────────────────
  ['import.write', 'POST', BASE + '/import', 'json'],
  ['sequence.write', 'POST', BASE + '/sequence', 'json'],
  ['merge.write', 'POST', BASE + '/merge', 'json'],
  ['edit.write', 'POST', BASE + '/edit', 'json'],
  ['grade.write', 'POST', BASE + '/grade', 'json'],
  ['undo.write', 'POST', BASE + '/undo', 'json'],
  // ── jobs ────────────────────────────────────────────────────────────────
  ['export.write', 'POST', BASE + '/export', 'json'],
  ['jobs.read', 'GET', BASE + '/jobs', 'json'],
  ['jobs.write', 'POST', BASE + '/jobs', 'json'],
  // ── preview / binary ────────────────────────────────────────────────────
  ['frame.read', 'POST', BASE + '/frame', 'json'],
  ['proxy.write', 'POST', BASE + '/proxy', 'json'],
  ['media.read', 'GET', BASE + '/media', 'raw'],
]

const routeTable = '{\n' + ROUTES
  .map(([key, method, path, kind]) => `      '${key}': { method: '${method}', path: '${path}', kind: '${kind}' },`)
  .join('\n') + '\n    }'

const hostModules = readModules('host')
// `type: 'json'` is not a valid JSON-Schema type — widen it.
const hostBody = hostModules
  .map((m) => '// ── ' + m.name + ' '.padEnd(Math.max(2, 66 - m.name.length), '─') + '\n' + m.body)
  .join('\n\n')
  .replaceAll("schema: { type: 'json' }", "schema: { type: 'object', additionalProperties: true }")

const nativeHost = [
  "import { readFileSync, statSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, copyFileSync, renameSync, rmSync, unlinkSync } from 'node:fs'",
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
  '    method: route.method,',
  '    path: route.path,',
  '    async handler(req, res) {',
  "      if (route.kind === 'raw') {",
  '        try { return await handler(req, res) } catch (error) {',
  '          try {',
  "            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })",
  "            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))",
  '          } catch (_) { }',
  '          return',
  '        }',
  '      }',
  '      const send = (code, value) => {',
  "        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })",
  '        res.end(JSON.stringify(value))',
  '      }',
  "      if (req.method !== route.method) return send(405, { error: 'method not allowed' })",
  '      try {',
  "        const body = req.method === 'POST' ? await readBody(req) : null",
  "        const query = new URLSearchParams((req.url || '').split('?')[1] || '')",
  '        const merged = Object.assign({}, body || {})',
  '        for (const [k, v] of query.entries()) if (merged[k] === undefined) merged[k] = v',
  '        send(200, await handler(merged))',
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
  "    apiBase: '" + BASE + "',",
  '    registerTool(_context, tool) {',
  "      return ctx.effect(() => ctx.tools.register(tool), '" + PKG + ": tool ' + tool.name)",
  '    },',
  '    handle(key, handler) {',
  '      const route = routes[key]',
  "      if (route === undefined) throw new Error('unsupported handler: ' + key)",
  "      const label = '" + PKG + ": ' + key",
  '      // Raw routes write the response themselves and need (req, res); JSON',
  '      // routes only ever get the merged body/query object.  Wrapping the raw',
  "      // ones in (body) => handler(body || {}) would hand them res === undefined.",
  "      if (route.kind === 'raw') return registerRoute(ctx, route, handler, label)",
  '      return registerRoute(ctx, route, (body) => handler(body || {}), label)',
  '    },',
  '  }',
  '  return createPlugin(harness).apply(ctx)',
  '}',
  '',
].join('\n')

const clientRoutes = '{\n' + ROUTES
  .map(([key, method, path]) => `        '${key}': ['${method}', '${path}'],`)
  .join('\n') + '\n      }'

const clientModules = readModules('client')
const clientBody = clientModules
  .map((m) => '    // ── ' + m.name + ' '.padEnd(Math.max(2, 62 - m.name.length), '─') + '\n' + indent(m.body, 4))
  .join('\n\n')

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
  '    var routes = ' + clientRoutes,
  '    var host = {',
  '      url: function (name, params) {',
  '        var route = routes[name]',
  "        if (route === undefined) throw new Error('unsupported call: ' + name)",
  "        var query = ''",
  '        if (params) {',
  '          var parts = []',
  '          for (var key in params) {',
  '            if (Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined && params[key] !== null) {',
  "              parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))",
  '            }',
  '          }',
  "          if (parts.length > 0) query = '?' + parts.join('&')",
  '        }',
  '        return route[1] + query',
  '      },',
  '      call: async function (name, arg) {',
  '        var route = routes[name]',
  "        if (route === undefined) throw new Error('unsupported call: ' + name)",
  "        var init = { cache: 'no-store' }",
  "        if (route[0] === 'POST') {",
  "          init.method = 'POST'",
  "          init.headers = { 'content-type': 'application/json' }",
  '          init.body = JSON.stringify(arg || {})',
  '        } else if (arg) {',
  '          var qs = []',
  '          for (var k in arg) {',
  '            if (Object.prototype.hasOwnProperty.call(arg, k) && arg[k] !== undefined && arg[k] !== null) {',
  "              qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(arg[k]))",
  '            }',
  '          }',
  "          if (qs.length > 0) init.cache = 'no-store'",
  '        }',
  '        var url = route[0] === \'POST\' ? route[1] : host.url(name, arg)',
  '        var response = await fetch(url, init)',
  '        var value = await response.json()',
  "        if (!response.ok) throw new Error(value && value.error ? value.error : 'request failed')",
  '        return value',
  '      },',
  '      blob: async function (name, params) {',
  '        var response = await fetch(host.url(name, params), { cache: "no-store" })',
  '        if (!response.ok) {',
  '          var text = await response.text()',
  "          var message = '请求失败 (' + response.status + ')'",
  '          try { var parsed = JSON.parse(text); if (parsed && parsed.error) message = parsed.error } catch (_) { }',
  '          throw new Error(message)',
  '        }',
  '        return await response.blob()',
  '      },',
  '    }',
  '    function createPlugin() {',
  clientBody,
  '    }',
  '    module.exports = createPlugin()',
  '    return module.exports',
  '  },',
  '})',
  '',
].join('\n')

const nativeDir = join(root, 'dist', 'native')
mkdirSync(nativeDir, { recursive: true })
writeFileSync(join(nativeDir, 'index.js'), nativeHost, 'utf8')
writeFileSync(join(nativeDir, 'client.js'), nativeClient, 'utf8')
console.log('Built ' + PKG)
console.log('  dist/native/index.js    ' + nativeHost.length + ' B  (' + hostModules.length + ' modules)')
console.log('  dist/native/client.js   ' + nativeClient.length + ' B  (' + clientModules.length + ' modules)')
console.log('  routes:')
for (const [key, method, path] of ROUTES) console.log('    ' + method.padEnd(5) + path + '   (' + key + ')')
