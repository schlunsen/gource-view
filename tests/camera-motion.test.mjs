import test from 'node:test'
import assert from 'node:assert/strict'
import { motion, glide, nearestAngle } from '../src/gource/camera-motion.js'

test('camera target jumps are speed limited and start gently', () => {
  const s = motion(0), dt = 1 / 60
  const first = glide(s, 10000, dt, 1.2, 100)
  assert.ok(first < 0.1, 'no first-frame kick')
  for (let i = 0; i < 600; i++) {
    const old = s.value
    glide(s, i < 300 ? 10000 : -10000, dt, 1.2, 100)
    assert.ok(Math.abs(s.value - old) <= 100 * dt, 'bounded motion even when the target reverses')
  }
})
test('camera settles without overshooting and is independent of frame rate', () => {
  const ends = [30, 60, 144].map(fps => {
    const s = motion(0)
    for (let i = 0; i < fps * 5; i++) { glide(s, 1, 1 / fps, 1); assert.ok(s.value <= 1) }
    return s.value
  })
  assert.ok(ends.every(v => Math.abs(v - 1) < 0.001))
  assert.ok(Math.max(...ends) - Math.min(...ends) < 1e-10)
})
test('paused frames preserve the pose and long frames cannot cause a jump', () => {
  const s = motion(0)
  assert.equal(glide(s, 100, 0), 0)
  assert.equal(glide(s, 100, -1), 0)
  const other = motion(0)
  assert.equal(glide(s, 100, 20, 1, 10), glide(other, 100, 0.1, 1, 10))
})
test('orbit transitions use the shortest angle across a full rotation', () => {
  assert.ok(Math.abs(nearestAngle(0.01, 2 * Math.PI - 0.01) - (2 * Math.PI + 0.01)) < 1e-10)
})
