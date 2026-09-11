import test from 'node:test'
import assert from 'node:assert/strict'
import { gitCityUrl, loginFromEmail, githubRepoOf, ownerOf, resolveAuthorLogins } from '../src/git-city.js'

// A fake fetch that answers by path and records every call.
function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    const path = url.replace('https://api.github.com', '')
    calls.push(path)
    const hit = Object.entries(routes).find(([p]) => path.startsWith(p))
    if (!hit) return { ok: false, status: 404, json: async () => ({}) }
    const [, body] = hit
    if (body instanceof Error) throw body
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  return { impl, calls }
}
const commit = (login, name, email, type = 'User') => ({ author: login ? { login, type } : null, commit: { author: { name, email } } })

test('gitCityUrl points at the profile city', () => {
  assert.equal(gitCityUrl('torvalds'), 'https://schlunsen.github.io/git-city/?user=torvalds')
  assert.equal(gitCityUrl('a b'), 'https://schlunsen.github.io/git-city/?user=a%20b')
})

test('noreply e-mails name the login outright', () => {
  assert.equal(loginFromEmail('117190+schlunsen@users.noreply.github.com'), 'schlunsen')
  assert.equal(loginFromEmail('octocat@users.noreply.github.com'), 'octocat')
  assert.equal(loginFromEmail('  12+Some-User@Users.NoReply.GitHub.com '), 'Some-User')
  assert.equal(loginFromEmail('ada@example.com'), '')
  assert.equal(loginFromEmail(''), '')
})

test('only GitHub repositories get a city link', () => {
  assert.equal(githubRepoOf({ repo: 'torvalds/linux' }), 'torvalds/linux')
  assert.equal(githubRepoOf({ repo: 'torvalds/linux', source: 'github' }), 'torvalds/linux')
  assert.equal(githubRepoOf({ repo: 'group/proj', source: 'gitlab' }), '')
  assert.equal(githubRepoOf({ repo: 'gitea:org/app' }), '')
  assert.equal(githubRepoOf(null), '')
  assert.equal(ownerOf({ repo: 'expressjs/express' }), 'expressjs')
  assert.equal(ownerOf({ repo: 'gitea:org/app' }), '')
})

test('noreply authors resolve without spending any API calls', async () => {
  const { impl, calls } = fakeFetch({})
  const m = await resolveAuthorLogins('o/r', [{ name: 'Ann', email: '1+ann@users.noreply.github.com' }], { fetchImpl: impl, token: '' })
  assert.deepEqual([...m], [['Ann', 'ann']])
  assert.equal(calls.length, 0)
})

test('one commits call maps recent authors by name or e-mail and skips bots', async () => {
  const { impl, calls } = fakeFetch({
    '/repos/o/r/commits?per_page=100': [
      commit('bob-gh', 'Bob', 'bob@x.io'),
      commit('carol-gh', 'C. Carol', 'Carol@X.io'),
      commit('dependabot[bot]', 'dependabot[bot]', 'bot@x.io', 'Bot'),
      commit(null, 'Nobody', 'nobody@x.io'),
    ],
  })
  const m = await resolveAuthorLogins('o/r', [
    { name: 'Bob', email: 'other@x.io' },
    { name: 'Carol', email: 'carol@x.io' },
    { name: 'dependabot[bot]', email: 'bot@x.io' },
  ], { fetchImpl: impl, token: '' })
  assert.equal(m.get('Bob'), 'bob-gh')
  assert.equal(m.get('Carol'), 'carol-gh')
  assert.equal(m.has('dependabot[bot]'), false)
  assert.equal(calls[0], '/repos/o/r/commits?per_page=100')
})

test('authors missing from recent commits fall back to a per-author lookup', async () => {
  const { impl, calls } = fakeFetch({
    '/repos/o/r/commits?per_page=100': [],
    '/repos/o/r/commits?author=dan%40x.io': [commit('dan-gh', 'Dan', 'dan@x.io')],
  })
  const m = await resolveAuthorLogins('o/r', [{ name: 'Dan', email: 'dan@x.io' }, { name: 'Eve', email: '' }], { fetchImpl: impl, token: '' })
  assert.equal(m.get('Dan'), 'dan-gh')
  assert.equal(m.has('Eve'), false)
  assert.equal(calls.length, 2, 'no lookup for an author without an e-mail')
})

test('a rate-limited or failing API leaves authors unlinked instead of throwing', async () => {
  const limited = fakeFetch({ '/repos/o/r/commits': 403 })
  assert.equal((await resolveAuthorLogins('o/r', [{ name: 'Ann', email: 'a@x.io' }], { fetchImpl: limited.impl, token: '' })).size, 0)
  assert.equal(limited.calls.length, 1, 'stops after the first refusal')
  const offline = fakeFetch({ '/repos/o/r/commits': new TypeError('network down') })
  assert.equal((await resolveAuthorLogins('o/r', [{ name: 'Ann', email: 'a@x.io' }], { fetchImpl: offline.impl, token: '' })).size, 0)
})

test('per-author lookups are capped', async () => {
  const { impl, calls } = fakeFetch({ '/repos/o/r/commits?per_page=100': [], '/repos/o/r/commits?author=': [] })
  const authors = Array.from({ length: 10 }, (_, i) => ({ name: `a${i}`, email: `a${i}@x.io` }))
  await resolveAuthorLogins('o/r', authors, { fetchImpl: impl, token: '', maxLookups: 3 })
  assert.equal(calls.length, 1 + 3)
})
