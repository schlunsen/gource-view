import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todaysLeaders } from '../src/landing-data.js'
const window = repos => ({ source: 'github.com/trending', repos })
const feed = periods => ({ periods })

test('the day leads: ranked by stars gained, deduplicated, leader first, feed untouched', () => {
  const repos = [8, 3, 20, 10, 6].map((gained, i) => ({ name: `owner/repo${i}`, gained, stars: 100 - gained }))
  const daily = feed({ daily: window([...repos, repos[2]]), weekly: window(repos) })
  const leaders = todaysLeaders(daily)
  assert.equal(leaders.period, 'daily')
  assert.equal(leaders.label, 'today')
  assert.deepEqual(leaders.repos.map(r => r.gained), [20, 10, 8, 6])
  assert.equal(daily.periods.daily.repos[0].gained, 8)
})
test('the week stands in when GitHub serves no daily list', () => {
  const leaders = todaysLeaders(feed({ weekly: window([{ name: 'owner/repo', gained: 5 }]) }))
  assert.deepEqual([leaders.period, leaders.label, leaders.repos.length], ['weekly', 'this week', 1])
})
test('search fallback never masquerades as star gains', () => {
  assert.throws(() => todaysLeaders({ periods: { daily: { source: 'search · created today', repos: [{ name: 'owner/repo', gained: 9 }] } } }), /unavailable/)
})
test('the showcase asks for as many subjects as it can offer', () => {
  const repos = Array.from({ length: 9 }, (_, i) => ({ name: `owner/repo${i}`, gained: i }))
  assert.equal(todaysLeaders(feed({ daily: window(repos) })).repos.length, 4)
  assert.equal(todaysLeaders(feed({ daily: window(repos) }), 1).repos.length, 1)
})
