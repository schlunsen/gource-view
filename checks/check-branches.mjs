import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const mk = (ref) => ({ repo: 'example/branches', ref, refs: ['main', 'dev', 'release/1.0'], defaultRef: 'main', commits: [{ hash: '1', ts: from, name: 'Ada', files: [{ p: `${ref}/a.js`, a: 1, d: 0 }] }, { hash: '2', ts: to, name: 'Ada', files: [{ p: `${ref}/b.js`, a: 1, d: 0 }] }], stats: { from, to, commits: 2, authors: 1, loc: 2, topAuthors: [['Ada', 2]] } })
const loads = []
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/branches', gitea: null } }))
await page.route('**/api/load', r => { loads.push(r.request().postDataJSON()); r.fulfill({ json: { job: 'j' + loads.length } }) })
await page.route('**/api/status/*', r => { const n = +r.request().url().split('/api/status/j')[1]; r.fulfill({ json: { status: 'done', result: mk(loads[n - 1].options.ref || 'main') } }) })
await page.goto('http://127.0.0.1:5173/')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
assert.equal(loads[0].options.ref, undefined)
await page.getByRole('combobox', { name: 'Branch' }).selectOption('dev')
await page.waitForFunction(() => window.__gource && document.body.innerText.includes('dev'), null, { timeout: 15000 })
await page.waitForTimeout(800)
assert.equal(loads[1].options.ref, 'dev')
assert.match(page.url(), /ref=dev/)
await page.getByLabel('Max commits to load').selectOption('0')
await page.screenshot({ path: `${S}/branches.png` })
// a shared link with ?ref= loads that branch straight away
const p2 = await browser.newPage(); const loads2 = []
await p2.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/branches', gitea: null } }))
await p2.route('**/api/load', r => { loads2.push(r.request().postDataJSON()); r.fulfill({ json: { job: 'k' } }) })
await p2.route('**/api/status/*', r => r.fulfill({ json: { status: 'done', result: mk('release/1.0') } }))
await p2.goto('http://127.0.0.1:5173/?repo=example%2Fbranches&ref=release%2F1.0&max=1000')
await p2.waitForFunction(() => !!window.__gource, null, { timeout: 15000 })
assert.deepEqual([loads2[0].options.ref, loads2[0].options.maxCommits], ['release/1.0', 1000])
assert.deepEqual(errors, [])
console.log('branches check ok')
await browser.close()
