import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weeklyLeaders } from '../src/landing-data.js'
test('weekly leaders rank star gains, deduplicate and limit to four without mutating the feed', () => {
  const repos = [8, 3, 20, 10, 6].map((gained, i) => ({ name: `owner/repo${i}`, gained, stars: 100 - gained }))
  const feed = { periods: { weekly: { source: 'github.com/trending', repos: [...repos, repos[2]] } } }
  assert.deepEqual(weeklyLeaders(feed).map(r => r.gained), [20, 10, 8, 6])
  assert.equal(feed.periods.weekly.repos[0].gained, 8)
})
test('search fallback never masquerades as weekly star gains', () => {
  assert.throws(() => weeklyLeaders({ periods: { weekly: { source: 'search · created this week', repos: [] } } }), /unavailable/)
})
