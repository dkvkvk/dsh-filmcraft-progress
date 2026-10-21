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
  // 'tools' 必须声明：读 ctx.tools 时 Cordis 校验 inject，缺了会抛
  // "cannot get property \"tools\" without inject"，整个条目挂载失败
  // （已注册的路由和工具一起被回收，症状是全部 404）。
  inject: ['tools'],
  apply: apply,
}
