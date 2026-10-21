// ── plugin ──────────────────────────────────────────────────────────────────
// The last module in the host half: it returns the object the loader wants.
//
// `apply` is where registration happens. Doing it at module top-level instead
// would run during the loader's probe pass (`createPlugin({})`, used only to read
// `name`) with no ctx at all.

function apply(ctx) {
  buildHandlers(harness)
  registerTools(harness, ctx)
}

return {
  name: 'filmcraft-progress',
  inject: [],
  apply: apply,
}
