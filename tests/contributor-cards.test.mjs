import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContributorCards, initials, dateParts, commitsBefore } from '../src/gource/contributor-cards.js'

const col = () => [1, 2, 3]
const commit = (ts, name, n = 2) => ({ ts, name, files: Array.from({ length: n }, (_, i) => ({ p: `${name}/${ts}/${i}` })) })

test('every author gets a debut card and milestones fire on the Nth commit', () => {
  const commits = []
  for (let i = 0; i < 12; i++) commits.push(commit(1000 + i * 100, 'Ada'))
  commits.push(commit(1050, 'Bob'))
  commits.sort((a, b) => a.ts - b.ts) // the server always hands the renderer a sorted history
  const cards = buildContributorCards(commits, { histPerSec: 1, colorOf: col })
  const debuts = cards.filter(c => c.kind === 'debut').map(c => c.name)
  assert.deepEqual(debuts, ['Ada', 'Bob'])
  const ms = cards.find(c => c.kind === 'milestone')
  assert.equal(ms.commits, 10); assert.equal(ms.name, 'Ada'); assert.equal(ms.ts, 1900)
  assert.equal(cards.find(c => c.name === 'Bob').join, 2)
})

test('simultaneous debuts are queued into lanes, never stacked on one frame', () => {
  const commits = Array.from({ length: 6 }, (_, i) => commit(5000, `Dev ${i}`))
  const cards = buildContributorCards(commits, { histPerSec: 1, colorOf: col, lanes: 3, lifeSeconds: 2 })
  assert.equal(cards.length, 6)
  const shows = cards.map(c => c.showTs)
  assert.equal(new Set(shows).size, 6)
  assert.deepEqual(cards.map(c => c.lane), [0, 1, 2, 0, 1, 2])
  assert.ok(cards[3].showTs >= cards[0].showTs + cards[0].life)
})

test('cards that would lag too far behind the action are dropped', () => {
  const commits = Array.from({ length: 40 }, (_, i) => commit(5000, `Dev ${i}`))
  const cards = buildContributorCards(commits, { histPerSec: 1, colorOf: col, lanes: 3, lifeSeconds: 4.6 })
  assert.ok(cards.length < 40 && cards.length >= 3)
  for (const c of cards) assert.ok(c.showTs - c.ts <= 10)
})

test('schedule is deterministic', () => {
  const commits = Array.from({ length: 30 }, (_, i) => commit(1000 + (i * 37) % 500, `Dev ${i % 7}`))
  const a = buildContributorCards(commits, { histPerSec: 2, colorOf: col })
  const b = buildContributorCards(commits, { histPerSec: 2, colorOf: col })
  assert.deepEqual(a, b)
})

test('initials and date helpers', () => {
  assert.equal(initials('Ada Lovelace'), 'AL')
  assert.equal(initials('torvalds'), 'TO')
  assert.equal(initials('jean-luc.picard'), 'JP')
  assert.equal(initials(''), '?')
  assert.deepEqual(dateParts(1700000000), { day: '14', month: 'NOV', year: '2023', weekday: 'Tuesday' })
  assert.equal(commitsBefore([1, 2, 3, 10], 3), 3)
  assert.equal(commitsBefore([1, 2, 3, 10], 0), 0)
  assert.equal(commitsBefore([1, 2, 3, 10], 99), 4)
})
