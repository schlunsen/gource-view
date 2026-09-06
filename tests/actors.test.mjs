import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActors, actorState, TRAVEL, IDLE, FADE } from '../src/gource/actors.js'

const commit = (ts, name, n = 3) => ({ ts, name, email: name + '@x.io', files: Array.from({ length: n }, (_, i) => ({ p: `d${ts}/${i}` })) })
const where = v => [v.index * 10, 0]

test('one actor per author, visits in order, act length grows with commit size', () => {
  const actors = buildActors([commit(0, 'ada'), commit(5, 'bob', 200), commit(9, 'ada')], { histPerSec: 1, colorOf: () => [1, 2, 3] })
  assert.deepEqual(actors.map(a => a.name), ['ada', 'bob'])
  assert.deepEqual(actors[0].visits.map(v => v.ts), [0, 9])
  assert.ok(actors[1].visits[0].actSeconds > actors[0].visits[0].actSeconds)
})

test('state: absent before first commit, arrives from outside, then flies between folders', () => {
  const [ada] = buildActors([commit(10, 'ada'), commit(12, 'ada')], { histPerSec: 1, colorOf: () => [0, 0, 0] })
  assert.equal(actorState(ada, 9, 1, where), null)
  const a = actorState(ada, 10.2, 1, where)
  assert.equal(a.fromPos, null); assert.ok(a.travel > 0 && a.travel < 1); assert.ok(a.acting > 0)
  const b = actorState(ada, 12.1, 1, where)
  assert.deepEqual(b.fromPos, [0, 0]); assert.deepEqual(b.target, [10, 0])
  assert.equal(actorState(ada, 12 + TRAVEL + 1, 1, where).travel, 1)
})

test('state: acting ends, then fades out after IDLE and leaves', () => {
  const [ada] = buildActors([commit(0, 'ada')], { histPerSec: 1, colorOf: () => [0, 0, 0] })
  assert.equal(actorState(ada, 5, 1, where).acting, 0)
  const fading = actorState(ada, IDLE + FADE / 2, 1, where)
  assert.ok(fading.alpha > 0 && fading.alpha < 1)
  assert.equal(actorState(ada, IDLE + FADE + 0.1, 1, where), null)
})

test('an author who returns after leaving arrives from outside again', () => {
  const [ada] = buildActors([commit(0, 'ada'), commit(100, 'ada')], { histPerSec: 1, colorOf: () => [0, 0, 0] })
  assert.equal(actorState(ada, 100.1, 1, where).fromPos, null)
})

test('histPerSec scales all timings', () => {
  const [ada] = buildActors([commit(0, 'ada')], { histPerSec: 1000, colorOf: () => [0, 0, 0] })
  assert.ok(actorState(ada, 500, 1000, where).acting > 0)
  assert.equal(actorState(ada, (IDLE + FADE + 1) * 1000, 1000, where), null)
})
