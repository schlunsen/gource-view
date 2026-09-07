// Large repositories load through the GitHub API in the browser build; api.github.com is mocked here.
// BASE=http://127.0.0.1:8821/gource-view/ node checks/check-api-history.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const BASE = process.env.BASE, S = process.env.S
assert.ok(BASE, 'Set BASE to the built static site')
const day = i => `2024-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`
const commits = Array.from({ length: 12 }, (_, i) => ({ sha: `c${i}`, parents: i === 5 ? [{}, {}] : [{}], commit: { author: { name: i % 2 ? 'Ada' : 'Linus', email: '', date: day(i) }, message: `change ${i}` }, files: [{ filename: `src/mod${i % 3}/file${i}.ts`, additions: 5 + i, deletions: i, status: i === 9 ? 'removed' : 'modified' }] }))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const api = []
  let remaining = 40
  await page.route('https://api.github.com/**', r => {
    const url = new URL(r.request().url()); api.push({ path: url.pathname + url.search, auth: r.request().headers().authorization || '' })
    const headers = { 'access-control-allow-origin': '*', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': '1700000000' }
    if (url.pathname === '/rate_limit') return r.fulfill({ json: { resources: { core: { remaining, limit: 60, reset: 1700000000 } } }, headers })
    if (url.pathname === '/repos/huge/repo') return r.fulfill({ json: { size: 3764 * 1024, default_branch: 'main', description: 'A very large repository' }, headers })
    if (url.pathname === '/repos/huge/repo/commits') return r.fulfill({ json: [...commits].reverse().map(c => ({ sha: c.sha, parents: c.parents })), headers })
    const m = url.pathname.match(/\/repos\/huge\/repo\/commits\/(c\d+)$/)
    if (m) { remaining--; return r.fulfill({ json: commits.find(c => c.sha === m[1]), headers }) }
    return r.fulfill({ status: 404, json: { message: 'nope' }, headers })
  })
  let gitRelay = 0
  await page.route('https://cors.isomorphic-git.org/**', r => { gitRelay++; r.abort() })
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
  await page.locator('#repo').fill('https://github.com/huge/repo'); await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 60000 })
  const bar = page.locator('.browser-history-bar')
  assert.match(await bar.innerText(), /GitHub API · 3,764 MB repository/)
  assert.equal(gitRelay, 0, 'a huge repository never hits the Git relay')
  assert.ok(api.some(a => a.path.startsWith('/repos/huge/repo/commits?per_page=100&page=1&sha=main')), 'lists the default branch')
  assert.ok(!api.some(a => a.path.endsWith('/commits/c5')), 'merge commits are not fetched')
  assert.ok(api.every(a => a.auth === ''), 'no token, no auth header')
  assert.match(await page.locator('main').innerText(), /11/, '11 non-merge commits')
  assert.match(await page.locator('main').innerText(), /A very large repository/, 'description from the API')
  await page.screenshot({ path: `${S}/api-history.png` })
  // token: saved locally, sent as a bearer header on the next load, never to the relay
  await page.getByRole('button', { name: 'GitHub token' }).click()
  await page.getByLabel('GitHub personal access token').fill('github_pat_TESTTOKENTESTTOKENTESTTOKEN')
  await page.getByRole('button', { name: 'Save on this device' }).click()
  assert.equal(await page.getByRole('button', { name: 'GitHub token ✓' }).count(), 1)
  assert.equal(await page.evaluate(() => localStorage.getItem('gource-github-token')), 'github_pat_TESTTOKENTESTTOKENTESTTOKEN')
  api.length = 0
  await page.getByRole('button', { name: 'Refresh history' }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 60000 })
  assert.ok(api.length > 3 && api.every(a => a.auth === 'Bearer github_pat_TESTTOKENTESTTOKENTESTTOKEN'), 'token sent to api.github.com only')
  assert.equal(gitRelay, 0)
  await page.getByRole('button', { name: 'GitHub token ✓' }).click(); await page.getByRole('button', { name: 'Remove token' }).click()
  assert.equal(await page.evaluate(() => localStorage.getItem('gource-github-token')), null)
  // a budget that runs out mid-load keeps the partial history and says why
  remaining = 8
  await page.getByRole('button', { name: 'Refresh history' }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 60000 })
  assert.match(await bar.innerText(), /rate limit stopped this at \d+ commits — add a GitHub token/)
  assert.deepEqual(errors, [])
  console.log('api history check ok')
} finally { await browser.close() }
