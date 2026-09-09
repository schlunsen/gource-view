import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const folders = ['secretproduct/core/engine', 'secretproduct/core/billing', 'secretproduct/web/pages', 'internal/tools']
const commits = []
for (let c = 0; c < 30; c++) commits.push({ hash: String(c), ts: from + c * (to - from) / 29, name: ['Ada Lovelace', 'Bob'][c % 2], email: 'x@example.com', files: [{ p: `${folders[c % 4]}/module${c % 5}.ts`, a: 5, d: 1 }] })
const result = { repo: 'acme/secret-product', commits, stats: { from, to, commits: 30, authors: 2, loc: 150, topAuthors: [['Ada Lovelace', 15], ['Bob', 15]] } }
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'acme/secret-product', gitea: null } }))
await page.route('**/api/music', r => r.fulfill({ json: { tracks: [] } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
await page.getByRole('slider').evaluate(el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, el.max); el.dispatchEvent(new Event('input', { bubbles: true })) })
await page.waitForTimeout(800)
const state = () => page.evaluate(() => ({ privacy: window.__gource.privacy, labels: window.__gource.labelCount }))
let st = await state(); assert.equal(st.privacy, 'off'); assert.ok(st.labels > 0, 'labels drawn when privacy is off')
await page.keyboard.press('h'); await page.waitForTimeout(400)
st = await state(); assert.equal(st.privacy, 'paths'); assert.equal(st.labels, 0, 'no path labels with privacy=paths')
await page.keyboard.press('h'); await page.waitForTimeout(400)
st = await state(); assert.equal(st.privacy, 'all')
const text = await page.locator('main').innerText()
assert.ok(!text.includes('Ada Lovelace') && text.includes('Contributor 1') && !text.includes('secret-product'), text.slice(0, 300))
assert.match(page.url(), /privacy=all/)
// hover a folder: the tooltip describes without naming
const dirs = await page.evaluate(() => window.__gource.probe())
const target = dirs.find(d => d.path.includes('core')) || dirs[0]
const box = await page.locator('canvas').boundingBox()
await page.mouse.move(box.x + target.x, box.y + target.y); await page.waitForTimeout(400)
await page.screenshot({ path: `${S}/privacy-all.png` })
// export dialog inherits the level
await page.getByRole('button', { name: 'Export video' }).click()
assert.equal(await page.getByRole('combobox', { name: /^Privacy/ }).inputValue(), 'all')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Names + people hidden' }).click(); await page.waitForTimeout(300)
assert.equal((await state()).privacy, 'off')
await page.keyboard.press('k'); await page.waitForTimeout(200)
assert.equal(await page.evaluate(() => window.__gource.clock), false); assert.match(page.url(), /clock=0/)
await page.keyboard.press('k'); await page.waitForTimeout(200)
assert.equal(await page.evaluate(() => window.__gource.clock), true)
assert.deepEqual(errors, [])
console.log('privacy check ok')
await browser.close()
