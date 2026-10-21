// ── plugin ──────────────────────────────────────────────────────────────────
// Last module of the client half: this is what `createPlugin()` returns to the
// module loader. `apply` is the only entry point — registration happens there and
// nowhere at module scope, because the loader evaluates the module before any
// context exists.

return {
  name: 'filmcraft-progress-client',
  inject: ['timer'],
  apply: apply,
}
