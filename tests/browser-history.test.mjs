import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { collectBrowserCommits, lineChanges } from '../src/browser-git/history.js'
import { parseRepository, browserLimit } from '../src/browser-git/options.js'
import { summarize } from '../src/history-summary.js'
import { collectCommits } from '../server/history.js'

test('browser Git accepts public GitHub names and refuses credentials and other hosts', () => {
  for (const input of ['nuxt/nuxt', 'https://github.com/nuxt/nuxt.git', 'github.com/nuxt/nuxt/tree/main']) assert.equal(parseRepository(input), 'nuxt/nuxt')
  for (const input of ['https://token@github.com/nuxt/nuxt', 'https://github.com.evil.test/a/b', 'http://github.com/a/b', 'https://github.com:4430/a/b', '../repo', 'owner/..', 'git@git.example:a/b', 'gitea:a/b']) assert.throws(() => parseRepository(input))
  for (const n of [0, -1, 3001, NaN, 2.5]) assert.throws(() => browserLimit(n))
  assert.equal(browserLimit(1000), 1000)
})

test('text changes preserve counts while binary and oversized changes remain bounded', () => {
  const b = s => new TextEncoder().encode(s)
  assert.deepEqual(lineChanges(b('one\ntwo\n'), b('one\nthree\nfour\n')), { a: 2, d: 1 })
  assert.deepEqual(lineChanges(b('one\ntwo\n')), { a: 0, d: 2 })
  assert.deepEqual(lineChanges(b('a\0b'), b('a\0c')), { a: 0, d: 0 })
  assert.equal(lineChanges(undefined, new Uint8Array(1024 * 1024 + 1).fill(65)).countsOmitted, true)
})

test('browser history agrees with native Git for additions, edits, deletions, binary files and merges', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-browser-test-')), dir = path.join(root, 'repo')
  fs.mkdirSync(dir)
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let sequence = 0
  const commit = message => {
    run('add', '-A')
    const stamp = new Date(1700000000000 + sequence++ * 86400000).toISOString()
    execFileSync('git', ['commit', '-qm', message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })
  }
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.name', 'Test Author'); run('config', 'user.email', 'author@example.test')
    fs.mkdirSync(path.join(dir, 'src')); fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.writeFileSync(path.join(dir, 'src/main.js'), 'one\ntwo\n'); fs.writeFileSync(path.join(dir, 'removed.txt'), 'old\n')
    fs.writeFileSync(path.join(dir, 'node_modules/ignored.js'), 'ignored\n'); fs.writeFileSync(path.join(dir, 'binary.dat'), Buffer.from([0, 1, 2]))
    commit('initial')
    fs.writeFileSync(path.join(dir, 'src/main.js'), 'one\nthree\nfour\n'); fs.unlinkSync(path.join(dir, 'removed.txt')); fs.writeFileSync(path.join(dir, 'binary.dat'), Buffer.from([0, 3, 4])); commit('edit and remove')
    run('checkout', '-qb', 'feature'); fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature\n'); commit('feature work')
    run('checkout', '-q', 'main'); fs.writeFileSync(path.join(dir, 'main.txt'), 'main\n'); commit('main work')
    run('merge', '-q', '--no-ff', 'feature', '-m', 'merge branch')
    const actual = await collectBrowserCommits({ fs, dir, maxCommits: 300 })
    const expected = await collectCommits(dir)
    const normalize = list => list.map(c => ({ ...c, files: c.files.sort((a, b) => a.p.localeCompare(b.p)) })).sort((a, b) => a.hash.localeCompare(b.hash))
    assert.deepEqual(normalize(actual.commits), normalize(expected))
    assert.ok(actual.commits.every(c => !c.subject.startsWith('merge')))
    assert.equal(actual.countsOmitted, 0)
    // A missing shallow parent is never interpreted as adding an entire repository.
    const shallowDir = path.join(root, 'shallow')
    execFileSync('git', ['clone', '-q', '--depth=2', '--branch=feature', `file://${dir}`, shallowDir])
    const shallow = await collectBrowserCommits({ fs, dir: shallowDir, maxCommits: 300 })
    assert.equal(shallow.commits.length, 1)
    assert.equal(shallow.commits[0].subject, 'feature work')
    assert.equal(shallow.hasMore, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('history summaries safely count author and directory names that match object properties', () => {
  const summary = summarize([{ name: '__proto__', ts: 1, files: [{ p: 'constructor/file', a: 2, d: 1 }] }])
  assert.deepEqual(summary.stats.topAuthors, [['__proto__', 1]])
  assert.deepEqual(summary.stats.topPaths, [['constructor', 3]])
})

test('an old patch merged today is placed when it landed, not when it was written', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-landing-')), dir = path.join(root, 'repo')
  fs.mkdirSync(dir)
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (message, authored, committed) => {
    run('add', '-A')
    execFileSync('git', ['commit', '-qm', message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed } })
  }
  const iso = t => new Date(t * 1000).toISOString()
  const LANDED = 1700000000, WRITTEN_LONG_BEFORE = LANDED - 30 * 86400
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.name', 'Test Author'); run('config', 'user.email', 'author@example.test')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    commit('landed first', iso(LANDED), iso(LANDED))
    // Written a month earlier (an old PR), but merged a day after the commit above.
    fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n')
    commit('old patch, merged late', iso(WRITTEN_LONG_BEFORE), iso(LANDED + 86400))
    const { commits } = await collectBrowserCommits({ fs, dir, maxCommits: 10 })
    assert.deepEqual(commits.map(c => c.files[0].p), ['a.txt', 'b.txt'], 'stays in the order the changes landed')
    assert.equal(commits[1].ts, LANDED + 86400, 'placed at its landing time, not a month earlier')
    assert.equal(commits[1].ts - commits[0].ts, 86400, 'no phantom month of empty timeline')
    assert.equal(commits[1].name, 'Test Author', 'the author still gets the credit')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
