import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const context = vm.createContext({ TICKS_PER_SECOND: 254016000000 })
vm.runInContext(readFileSync(new URL('../src/host/45-workflow.js', import.meta.url), 'utf8') + '\nglobalThis.parse = editTimeTicks', context)
const ticks = (value, fps = 25) => context.parse(value, fps)
test('seconds, frames and timecode resolve to the same frame-aligned tick', () => {
  assert.equal(ticks('1f'), ticks('0.04s'))
  assert.equal(ticks('00:00:00:01'), ticks('1f'))
  assert.equal(ticks('1:02.5'), ticks(62.5))
  assert.equal(ticks('-1f'), -ticks('1f'))
})
test('fractional rates preserve integer frame counts across timecode roundtrips', () => {
  assert.equal(ticks('00:01:00:00', 30000 / 1001), ticks('1800f', 30000 / 1001))
  assert.equal(ticks('1f', 30000 / 1001), 8475667200)
})
test('reject malformed, overflowing and ambiguous input before any edit', () => {
  for (const value of ['', 'abc', '1e5', '00:00:00:25', '00:60:00:00', '1:60', 'Infinity', '999999999999999f']) assert.throws(() => ticks(value))
  assert.throws(() => ticks('1f', 0))
})
