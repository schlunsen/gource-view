import test from 'node:test'
import assert from 'node:assert/strict'
import { collectApiCommits, chooseMode, fetchRepo, RateLimitError, API_REPO_SIZE_MB } from '../src/browser-git/github-api.js'

const res = (json, { status = 200, remaining = 50 } = {}) => ({ ok: status < 400, status, headers: new Map([['x-ratelimit-remaining', String(remaining)], ['x-ratelimit-reset', '1700000000']]), json: async () => json })
const commit = (sha, files, parents = 1, date = '2024-01-0' + sha) => ({ sha, parents: Array.from({ length: parents }, () => ({})), commit: { author: { name: 'Ada', email: 'a@x', date: `${date}T00:00:00Z` }, message: `msg ${sha}\nbody` }, files })
const listOf = (...shas) => shas.map(s => ({ sha: s, parents: [{}] }))

function mockFetch({ list, details, remaining = 50, limit = 60 }) {
  const calls = []
  return { calls, fetch: async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization || '' })
    if (url.endsWith('/rate_limit')) return res({ resources: { core: { remaining, limit, reset: 1700000000 } } })
    const m = url.match(/\/commits\/([^/?]+)$/)
    if (m) return typeof details[m[1]] === 'function' ? details[m[1]]() : res(details[m[1]])
    const page = Number(new URL(url).searchParams.get('page'))
    return res(list[page - 1] || [])
  } }
}

test('collects non-merge commits with per-file line counts, maps deletes and renames', async () => {
  const details = {
    1: commit('1', [{ filename: 'a.js', additions: 3, deletions: 1, status: 'modified' }]),
    2: commit('2', [{ filename: 'b.js', additions: 0, deletions: 4, status: 'removed' }, { filename: 'new.js', previous_filename: 'old.js', additions: 1, deletions: 0, status: 'renamed' }]),
    3: commit('3', [{ filename: 'c.js', additions: 1, deletions: 0 }], 2),
  }
  const list = [[...listOf('3', '2', '1').map((c, i) => i === 0 ? { ...c, parents: [{}, {}] } : c)]]
  const { fetch, calls } = mockFetch({ list, details })
  const r = await collectApiCommits({ repo: 'o/r', ref: 'main', maxCommits: 300, fetchImpl: fetch })
  assert.deepEqual(r.commits.map(c => c.hash), ['1', '2'], 'oldest first, merge skipped without a detail request')
  assert.deepEqual(r.commits[1].files, [{ p: 'b.js', a: 0, d: 4, s: 'D' }, { p: 'old.js', a: 0, d: 0, s: 'D' }, { p: 'new.js', a: 1, d: 0 }])
  assert.equal(r.commits[0].subject, 'msg 1'); assert.equal(r.commits[0].ts, Date.UTC(2024, 0, 1) / 1000)
  assert.equal(r.hasMore, false); assert.equal(r.rateLimited, false)
  assert.equal(r.requestsUsed, 3, 'one list page and two details'); assert.ok(!calls.some(c => c.url.includes('/commits/3')))
  assert.ok(calls[0].url.endsWith('/rate_limit')); assert.ok(calls[1].url.includes('sha=main'))
})

test('paginates the list, stops at the limit and reports more history', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ sha: `p${i}`, parents: [{}] }))
  const details = Object.fromEntries(page1.slice(0, 5).map(c => [c.sha, commit(c.sha, [{ filename: 'f', additions: 1, deletions: 0 }], 1, '2024-01-01')]))
  const { fetch } = mockFetch({ list: [page1, page1], details })
  const r = await collectApiCommits({ repo: 'o/r', maxCommits: 5, fetchImpl: fetch })
  assert.equal(r.commits.length, 5); assert.equal(r.hasMore, true)
})

test('stops cleanly when the budget runs out and flags the rate limit', async () => {
  const list = [listOf('1', '2', '3', '4', '5', '6', '7', '8')]
  const details = Object.fromEntries(list[0].map(c => [c.sha, commit(c.sha, [{ filename: 'f', additions: 1, deletions: 0 }], 1, '2024-01-01')]))
  const { fetch, calls } = mockFetch({ list, details, remaining: 6 }) // 6 - 2 reserve = 4: one list + three details
  const r = await collectApiCommits({ repo: 'o/r', maxCommits: 300, fetchImpl: fetch })
  assert.equal(r.commits.length, 3); assert.equal(r.rateLimited, true); assert.equal(r.hasMore, true)
  assert.equal(calls.length, 1 + 1 + 3); assert.equal(r.remaining, 2)
})

test('a 403 with no remaining requests mid-run keeps what was read', async () => {
  const list = [listOf('1', '2', '3')]
  let served = 0
  const details = { 1: commit('1', [{ filename: 'f', additions: 1, deletions: 0 }]), 2: () => { served++; return res({ message: 'rate limited' }, { status: 403, remaining: 0 }) }, 3: () => res({ message: 'rate limited' }, { status: 403, remaining: 0 }) }
  const { fetch } = mockFetch({ list, details })
  const r = await collectApiCommits({ repo: 'o/r', maxCommits: 300, fetchImpl: fetch })
  assert.equal(r.commits.length, 1); assert.equal(r.rateLimited, true); assert.ok(served >= 1)
})

test('an exhausted budget before starting is a rate-limit error', async () => {
  const { fetch } = mockFetch({ list: [[]], details: {}, remaining: 2 })
  await assert.rejects(collectApiCommits({ repo: 'o/r', fetchImpl: fetch }), e => e instanceof RateLimitError && /5,000 requests/.test(e.message))
})

test('the token is sent as a bearer header to the API only', async () => {
  const { fetch, calls } = mockFetch({ list: [listOf('1')], details: { 1: commit('1', [{ filename: 'f', additions: 1, deletions: 0 }]) } })
  await collectApiCommits({ repo: 'o/r', token: 'github_pat_abc', fetchImpl: fetch })
  assert.ok(calls.length >= 3); assert.ok(calls.every(c => c.url.startsWith('https://api.github.com/') && c.auth === 'Bearer github_pat_abc'))
})

test('repository metadata decides the path; explicit modes win', async () => {
  const big = await fetchRepo('o/big', async () => res({ size: 3764 * 1024, default_branch: 'main', description: ' Big  repo ' }))
  assert.equal(big.sizeMb, 3764); assert.equal(big.defaultRef, 'main'); assert.equal(big.description, 'Big repo')
  assert.equal(chooseMode(big), 'api'); assert.equal(chooseMode({ sizeMb: API_REPO_SIZE_MB }), 'clone'); assert.equal(chooseMode(null), 'clone')
  assert.equal(chooseMode(big, 'clone'), 'clone'); assert.equal(chooseMode({ sizeMb: 1 }, 'api'), 'api')
  await assert.rejects(fetchRepo('o/missing', async () => res({}, { status: 404 })), /not found/)
  await assert.rejects(fetchRepo('o/x', async () => res({}, { status: 401 })), /rejected the token/)
  await assert.rejects(fetchRepo('o/x', async () => res({}, { status: 403, remaining: 0 })), RateLimitError)
})
