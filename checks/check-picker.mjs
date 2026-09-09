import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const result = name => ({ repo: name, commits: [{ hash: '1', ts: from, name: 'Ada', files: [{ p: 'a.js', a: 1, d: 0 }] }, { hash: '2', ts: to, name: 'Ada', files: [{ p: 'b.js', a: 1, d: 0 }] }], stats: { from, to, commits: 2, authors: 1, loc: 2, topAuthors: [['Ada', 2]] } })
const repos = [
  { name: 'acme/notes', description: 'Notes app', updatedAt: new Date().toISOString(), private: false },
  { name: 'acme/platform', description: 'The platform', updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(), private: true },
  { name: 'acme/golf', description: '', updatedAt: null, private: true },
]
const loads = []
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'gitea:acme/platform', gitea: { label: 'Acme Gitea', org: 'acme', url: 'https://gitea.example.com' } } }))
await page.route('**/api/gitea/repos', r => r.fulfill({ json: { repos } }))
await page.route('**/api/music', r => r.fulfill({ json: { tracks: [{ id: 'floating-cities', title: 'Floating Cities', mood: 'ambient, weightless' }, { id: 'cipher', title: 'Cipher', mood: 'tech, driving' }] } }))
await page.route('**/api/load', r => { loads.push(r.request().postDataJSON().repo); r.fulfill({ json: { job: 'j' } }) })
await page.route('**/api/status/*', r => r.fulfill({ json: { status: 'done', result: result(loads[loads.length - 1]) } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
await page.getByRole('button', { name: /Acme Gitea · 3/ }).click()
const search = page.getByRole('textbox', { name: /Search Acme Gitea/ })
await search.waitFor()
assert.equal(await page.getByRole('listbox').getByRole('option').count(), 3)
await search.fill('notes')
assert.deepEqual(await page.getByRole('listbox').getByRole('option').allTextContents().then(a => a.map(t => t.includes('acme/notes'))), [true])
await page.screenshot({ path: `${S}/picker.png` })
await search.press('Enter')
await page.waitForTimeout(500)
assert.equal(loads[loads.length - 1], 'gitea:acme/notes')
assert.equal(await page.getByRole('listbox').count(), 0, 'panel closes after picking')
// keyboard: open, arrow down, enter → second row (by recency: lunarpad, n0, golf)
await page.getByRole('button', { name: /Acme Gitea/ }).click()
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
assert.equal(loads[loads.length - 1], 'gitea:acme/platform')
// export dialog shows music + effects controls
await page.getByRole('button', { name: 'Export video' }).click()
await page.getByRole('combobox', { name: /^Music/ }).selectOption('cipher')
await page.getByRole('combobox', { name: /^Sound effects/ }).selectOption('none')
await page.screenshot({ path: `${S}/export-dialog.png` })
assert.equal(await page.getByRole('combobox', { name: /^Music/ }).inputValue(), 'cipher')
assert.deepEqual(errors, [])
console.log('picker check ok')
await browser.close()
