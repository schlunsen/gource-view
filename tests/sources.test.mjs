import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRepo, isSafeHost, authHeaders, isValidRef, jobKeyFor } from '../server/sources.js'

const gitea = { url: 'https://gitea.example.com', host: 'gitea.example.com', org: 'acme' }

test('parses GitHub shorthand and URLs', () => {
  assert.deepEqual(parseRepo('torvalds/linux'), { source: 'github', repo: 'torvalds/linux', url: 'https://github.com/torvalds/linux.git' })
  assert.equal(parseRepo('https://github.com/vercel/next.js/tree/canary').repo, 'vercel/next.js')
  assert.equal(parseRepo('git@github.com:expressjs/express.git').repo, 'expressjs/express')
})

test('parses the configured Gitea instance', () => {
  assert.equal(parseRepo('gitea:acme/app', gitea).source, 'gitea')
  assert.equal(parseRepo('https://gitea.example.com/acme/app.git', gitea).url, 'https://gitea.example.com/acme/app.git')
  assert.equal(parseRepo('acme/app', gitea).source, 'gitea')
  assert.equal(parseRepo('other/app', gitea).source, 'github')
  assert.equal(parseRepo('gitea:acme/app'), null)
})

test('parses any public https host including nested GitLab groups', () => {
  const gl = parseRepo('https://gitlab.com/group/sub/project')
  assert.deepEqual(gl, { source: 'url', repo: 'gitlab.com/group/sub/project', url: 'https://gitlab.com/group/sub/project.git' })
  assert.equal(parseRepo('https://bitbucket.org/team/repo.git').source, 'url')
  assert.equal(parseRepo('https://codeberg.org/user'), null, 'needs owner and name')
})

test('refuses hosts that could reach cluster-internal services', () => {
  for (const bad of ['http://localhost/x/y', 'https://10.0.0.5/x/y', 'https://gitea.internal-ns.svc/x/y', 'https://[::1]/x/y', 'https://metadata.google.internal/x/y', 'https://x.local/a/b', 'https://user@evil.com/x/y'])
    assert.equal(parseRepo(bad), null, bad)
  assert.equal(isSafeHost('gitlab.com'), true)
  assert.equal(isSafeHost('127.0.0.1'), false)
})

test('credentials become URL-scoped headers only for the matching host', () => {
  const gh = authHeaders({ source: 'github', url: 'https://github.com/a/b.git' }, { githubToken: 'T' })
  assert.equal(gh.GIT_CONFIG_COUNT, '2'); assert.equal(gh.GIT_CONFIG_KEY_0, 'http.followRedirects'); assert.equal(gh.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraHeader')
  const none = authHeaders({ source: 'url', url: 'https://evil.com/a/b.git' }, { githubToken: 'T', gitlabToken: 'G' })
  assert.equal(none.GIT_CONFIG_COUNT, '1', 'only the redirect guard, no token for a foreign host')
  assert.equal(authHeaders({ source: 'url', url: 'https://gitlab.com/a/b.git' }, { gitlabToken: 'G' }).GIT_CONFIG_COUNT, '2')
})

test('ref names are validated', () => {
  for (const ok of ['main', 'release/1.2', 'feature-x', 'v1.0']) assert.ok(isValidRef(ok), ok)
  for (const bad of ['-foo', '../x', 'a..b', '', 'x'.repeat(130), 'x.lock']) assert.ok(!isValidRef(bad), bad)
})

test('job keys are URL-path safe and distinct per branch and limit', () => {
  const keys = [jobKeyFor('gitea', 'acme/notes'), jobKeyFor('gitea', 'acme/notes', { maxCommits: 0 }), jobKeyFor('github', 'a/b', { ref: 'release/1.0' }), jobKeyFor('url', 'gitlab.com/g/s/p', { ref: 'dev', maxCommits: 3000 })]
  assert.equal(new Set(keys).size, keys.length)
  for (const k of keys) assert.match(k, /^[a-z0-9.-]+$/, k)
  assert.equal(keys[1], 'gitea--acme-notes--max0')
})
