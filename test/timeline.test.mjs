import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const context = vm.createContext({})
vm.runInContext(readFileSync(new URL('../src/client/25-timeline.js', import.meta.url), 'utf8') + '\nglobalThis.layout = fcTimelineLayout', context)
const layout = (sequence) => JSON.parse(JSON.stringify(context.layout(sequence)))
const clip = (id, start, dur) => ({ clip: id, start, dur })
const sequence = (items, duration = 0) => ({ duration, tracks: { video: [{ id: 'v1', label: 'V1', items }], audio: [] } })

test('empty and unusable clips produce an empty timeline', () => {
  assert.deepEqual(layout(null), { duration: 0, rows: [] })
  assert.equal(layout(sequence([clip(1, NaN, 2), clip(2, 0, 0), clip(3, -3, 1)])).rows.length, 0)
})
test('gaps include the head and tail and use the full sequence extent', () => {
  const result = layout(sequence([clip(2, 5, 2), clip(1, 1, 2)], 10))
  assert.equal(result.duration, 10)
  assert.deepEqual(result.rows[0].gaps, [{ start: 0, end: 1 }, { start: 3, end: 5 }, { start: 7, end: 10 }])
})
test('overlaps occupy separate lanes, without inventing gaps inside nested clips', () => {
  const result = layout(sequence([clip(1, 0, 10), clip(2, 2, 2), clip(3, 5, 3)]))
  assert.deepEqual(result.rows[0].clips.map((span) => span.lane), [0, 1, 1])
  assert.deepEqual(result.rows[0].overlaps, [{ start: 2, end: 4 }, { start: 5, end: 8 }])
  assert.deepEqual(result.rows[0].gaps, [])
})
test('a longer audio track expands every row and leaves caller data intact', () => {
  const input = sequence([clip(2, 2, 2), clip(1, 0, 2)])
  input.tracks.audio = [{ id: 'a1', label: 'A1', muted: true, items: [clip(3, 0, 8)] }]
  const before = JSON.stringify(input)
  const result = layout(input)
  assert.equal(result.duration, 8)
  assert.deepEqual(result.rows[0].gaps, [{ start: 4, end: 8 }])
  assert.equal(result.rows[1].track.muted, true)
  assert.equal(JSON.stringify(input), before)
})
