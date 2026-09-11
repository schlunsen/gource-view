import test from 'node:test'
import assert from 'node:assert/strict'
import { repoLink, repoHost, safeRepoUrl } from '../src/repo-link.js'

test('links a visualized repository to its real home', () => {
  assert.equal(repoLink({ repo: 'mrdoob/three.js', source: 'github', sourceUrl: 'https://github.com/mrdoob/three.js' }), 'https://github.com/mrdoob/three.js')
  assert.equal(repoLink({ repo: 'a/b', source: 'url', sourceUrl: 'https://gitlab.com/g/sub/p.git' }), 'https://gitlab.com/g/sub/p')
  // Older cached histories predate sourceUrl; only GitHub ones may be guessed.
  assert.equal(repoLink({ repo: 'nuxt/nuxt', source: 'github' }), 'https://github.com/nuxt/nuxt')
  assert.equal(repoLink({ repo: 'org/app', source: 'gitea' }), null)
})

test('privacy mode hides the link along with the name', () => {
  for (const privacy of ['names', 'people', 'all']) assert.equal(repoLink({ repo: 'a/b', sourceUrl: 'https://github.com/a/b' }, privacy), null)
})

test('never hands the user an unsafe address', () => {
  for (const raw of ['javascript:alert(1)', 'http://github.com/a/b', 'https://user:tok@github.com/a/b', 'https://localhost/a', '', null, 'not a url'])
    assert.equal(safeRepoUrl(raw), null, String(raw))
  assert.equal(safeRepoUrl('https://github.com/a/b?tab=x#readme'), 'https://github.com/a/b')
})

test('names the destination', () => {
  assert.equal(repoHost('https://github.com/a/b'), 'GitHub')
  assert.equal(repoHost('https://www.gitlab.com/a/b'), 'GitLab')
  assert.equal(repoHost('https://gitea-lunarrails.apps.moon.nzero.pro/o/r'), 'gitea-lunarrails.apps.moon.nzero.pro')
  assert.equal(repoHost('javascript:alert(1)'), '')
})
