import test from 'node:test'
import assert from 'node:assert/strict'
import { createDescriptionLoader, shortDescription } from '../server/repo-description.js'

test('description metadata is bounded, cached, and restricted to known sources', async () => {
  let calls = 0
  const load = createDescriptionLoader({ fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.github.com/repos/acme/app'); assert.equal(options.redirect, 'error')
    return { ok: true, json: async () => ({ description: '  A small\n application. ' }) }
  } })
  assert.equal(await load({ source: 'github', repo: 'acme/app' }), 'A small application.')
  assert.equal(await load({ source: 'github', repo: 'acme/app' }), 'A small application.')
  assert.equal(await load({ source: 'url', repo: 'internal/app' }), '')
  assert.equal(calls, 1)
  assert.equal(shortDescription('x'.repeat(500)).length, 300)
})
test('metadata failures are optional and Gitea descriptions use the configured lookup', async () => {
  const load = createDescriptionLoader({ fetchImpl: async () => { throw new Error('offline') }, giteaLookup: async () => 'Team notebook' })
  assert.equal(await load({ source: 'github', repo: 'acme/app' }), '')
  assert.equal(await load({ source: 'gitea', repo: 'acme/app' }), 'Team notebook')
})
