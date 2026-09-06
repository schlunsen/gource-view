import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPacing } from '../src/gource/pacing.js'

test('pace is 1× around commits and fast× in the gaps', () => {
  const p = buildPacing([100, 1000], { from: 0, to: 1100, histPerSec: 1, near: 2.5, fast: 4 })
  assert.equal(p.paceAt(100), 1); assert.equal(p.paceAt(102), 1)
  assert.equal(p.paceAt(500), 4)
  assert.ok(p.paceAt(103) > 1 && p.paceAt(103) < 4, 'smooth ramp')
})

test('warp is monotonic, hits both ends, and compresses dead time', () => {
  const p = buildPacing([100, 1000], { from: 0, to: 1100, histPerSec: 1 })
  assert.equal(p.warp(0), 0); assert.equal(p.warp(1), 1100)
  let last = -1
  for (let u = 0; u <= 1; u += 0.01) { const t = p.warp(u); assert.ok(t >= last); last = t }
  // the seconds around a commit take a much bigger share of playback than of history
  const nearShare = (p.elapsed(102.5) - p.elapsed(97.5)) / p.playbackSeconds
  assert.ok(nearShare > 3 * (5 / 1100), `near share ${nearShare}`)
  assert.ok(p.playbackSeconds < 1100 / 3 && p.playbackSeconds > 1100 / 4)
  assert.ok(Math.abs(p.elapsed(1100) - p.playbackSeconds) < 1e-6)
})

test('degenerate histories fall back to linear time', () => {
  const p = buildPacing([5], { from: 5, to: 5, histPerSec: 1 })
  assert.equal(p.paceAt(5), 1); assert.equal(p.warp(0.5), 5)
})
