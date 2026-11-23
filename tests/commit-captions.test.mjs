import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCaptions, captionAt, wrapLines } from '../src/gource/commit-captions.js'

const commit = (ts, subject, n = 1) => ({ ts, hash: 'abcdef1234', name: 'Ada', subject, files: Array.from({ length: n }, (_, i) => ({ p: `f${i}`, a: 2, d: 1 })) })

test('one caption at a time, each held for its full life', () => {
  const commits = [commit(0, 'first'), commit(1, 'crowded out'), commit(10, 'second')]
  const caps = buildCaptions(commits, { histPerSec: 1, lifeSeconds: 3, gapSeconds: 0.5 })
  assert.deepEqual(caps.map(c => c.subject), ['first', 'second'])
  assert.equal(captionAt(caps, 2.9).subject, 'first')
  assert.equal(captionAt(caps, 3.1), null)
  assert.equal(captionAt(caps, -1), null)
  assert.equal(captionAt(caps, 10).subject, 'second')
})

test('of commits landing together the largest speaks, and blank subjects never do', () => {
  const commits = [commit(0, '  '), commit(1, 'small'), commit(1.5, 'big\n import', 40), commit(1.6, '', 90)]
  const [cap, ...rest] = buildCaptions(commits, { histPerSec: 1, lifeSeconds: 3 })
  assert.equal(rest.length, 0)
  assert.deepEqual([cap.subject, cap.showTs, cap.files, cap.added, cap.removed, cap.hash], ['big import', 1.5, 40, 80, 40, 'abcdef1'])
})

test('long subjects wrap to two lines and end in an ellipsis', () => {
  const measure = s => s.length
  assert.deepEqual(wrapLines('short one', 20, measure), ['short one'])
  assert.deepEqual(wrapLines('aaaa bbbb cccc dddd eeee', 10, measure), ['aaaa bbbb', 'cccc dddd…'])
  assert.deepEqual(wrapLines('averyveryverylongword tail', 10, measure), ['averyvery…', 'tail'])
})
