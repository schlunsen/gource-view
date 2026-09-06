import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvents, aliveAt, deletedAt, lastEventIndex } from '../src/gource/lifecycle.js'

const commits = [
  { ts: 10, files: [{ p: 'a.js' }, { p: 'b.js' }] },
  { ts: 20, files: [{ p: 'a.js' }] },
  { ts: 30, files: [{ p: 'a.js', s: 'D' }] },
  { ts: 40, files: [{ p: 'a.js' }] }, // re-created
]
const ev = buildEvents(commits)

test('files are alive after a change and dead after a deletion until re-created', () => {
  const a = ev.get('a.js')
  assert.equal(aliveAt(a, 5), false)
  assert.equal(aliveAt(a, 10), true)
  assert.equal(aliveAt(a, 29), true)
  assert.equal(aliveAt(a, 30), false)
  assert.equal(deletedAt(a, 35), 30)
  assert.equal(aliveAt(a, 40), true)
  assert.equal(deletedAt(a, 45), null)
  assert.equal(aliveAt(ev.get('b.js'), 100), true)
  assert.equal(aliveAt(undefined, 0), true)
})

test('lastEventIndex is a stable binary search', () => {
  const a = ev.get('a.js')
  assert.deepEqual([0, 10, 25, 40, 99].map(t => lastEventIndex(a, t)), [-1, 0, 1, 3, 3])
})
