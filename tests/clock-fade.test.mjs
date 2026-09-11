import test from 'node:test'
import assert from 'node:assert/strict'
import { createClockFade, CLOCK_HIDE_RATE, CLOCK_SHOW_RATE } from '../src/gource/clock-fade.js'

const run = (fade, rate, seconds, fps = 60) => { for (let i = 0; i < seconds * fps; i++) { fade.note(rate, 1 / fps); fade.ease(1 / fps) } }
const HOUR = 3600, DAY = 86400

test('starts from the nominal playback rate, with no fade-in on the first frame', () => {
  assert.equal(createClockFade(3 * HOUR).alpha, 1)
  assert.equal(createClockFade(3 * DAY).alpha, 0)
})

test('hides once history runs faster than a day a second, and returns when it slows', () => {
  const fade = createClockFade(3 * HOUR)
  run(fade, 5 * DAY, 4)
  assert.ok(fade.fast); assert.equal(fade.alpha, 0)
  run(fade, 2 * HOUR, 4)
  assert.ok(!fade.fast); assert.equal(fade.alpha, 1)
})

test('does not flicker on brief bursts or between the thresholds', () => {
  const fade = createClockFade(6 * HOUR)
  run(fade, 4 * 6 * HOUR, 0.3) // a quarter-second auto-pace skip
  assert.ok(!fade.fast, 'a short skip is smoothed out')
  const shown = createClockFade(18 * HOUR), hidden = createClockFade(CLOCK_HIDE_RATE * 1.5)
  run(hidden, 18 * HOUR, 10) // between SHOW and HIDE: each keeps its state
  run(shown, 18 * HOUR, 10)
  assert.ok(hidden.fast && !shown.fast)
  assert.ok(CLOCK_SHOW_RATE < 18 * HOUR && 18 * HOUR < CLOCK_HIDE_RATE)
})

test('pauses, holds and seeks carry no rate and change nothing', () => {
  const fade = createClockFade(5 * DAY)
  for (const rate of [0, -1, NaN, Infinity]) fade.note(rate, 1)
  fade.ease(10)
  assert.ok(fade.fast); assert.equal(fade.alpha, 0)
})

test('is a pure function of the frames it is given (deterministic exports)', () => {
  const a = createClockFade(DAY), b = createClockFade(DAY)
  for (const f of [a, b]) { run(f, 3 * DAY, 1, 30); run(f, HOUR, 0.7, 30) }
  assert.equal(a.alpha, b.alpha); assert.equal(a.rate, b.rate)
})
