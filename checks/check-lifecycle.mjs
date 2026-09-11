import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000, step = (to - from) / 19
const commits = []
const files = (dir, n, ext, s) => Array.from({ length: n }, (_, i) => ({ p: `${dir}/file${i}.${ext}`, a: 5, d: 1, ...(s ? { s } : {}) }))
commits.push({ hash: '0', ts: from, name: 'Ada', files: [...files('src/keep', 6, 'js'), ...files('src/gone', 6, 'js')] })
commits.push({ hash: '1', ts: from + step, name: 'Ada', files: files('data/blobs', 140, 'bin') })  // big folder → collapsed
for (let c = 2; c < 10; c++) commits.push({ hash: String(c), ts: from + step * c, name: 'Bob', files: [{ p: `src/keep/file${c % 6}.js`, a: 2, d: 1 }] })
commits.push({ hash: '10', ts: from + step * 10, name: 'Ada', files: files('src/gone', 6, 'js', 'D') }) // delete the folder
for (let c = 11; c < 20; c++) commits.push({ hash: String(c), ts: from + step * c, name: 'Bob', files: [{ p: `src/keep/file${c % 6}.js`, a: 2, d: 1 }] })
const result = { repo: 'example/lifecycle', commits, stats: { from, to, commits: commits.length, authors: 2, loc: 500, topAuthors: [['Bob', 17], ['Ada', 3]] } }
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/lifecycle', gitea: null } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
const setSlider = v => page.getByRole('slider').evaluate((el, v) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
const folders = async () => (await page.evaluate(() => window.__gource.probe())).map(d => d.path)
await setSlider(Math.round(from + step * 9.5)); await page.waitForTimeout(1200)
await page.screenshot({ path: `${S}/life-before.png` })
const before = await folders()
assert.ok(before.includes('src/gone') && before.includes('data/blobs'), `before: ${before}`)
await setSlider(Math.round(from + step * 10.05)); await page.waitForTimeout(600)
await page.screenshot({ path: `${S}/life-dying.png` })
await setSlider(Math.round(from + step * 14)); await page.waitForTimeout(1500)
await page.screenshot({ path: `${S}/life-after.png` })
const after = await folders()
assert.ok(!after.includes('src/gone') && after.includes('src/keep'), `after: ${after}`)
// hovering the collapsed folder reports its file count
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom out' }).click()
await page.waitForTimeout(500)
const blobs = (await page.evaluate(() => window.__gource.probe())).find(d => d.path === 'data/blobs')
const box = await page.locator('canvas').boundingBox()
await page.mouse.move(box.x + blobs.x, box.y + blobs.y); await page.waitForTimeout(400)
await page.screenshot({ path: `${S}/life-collapsed-hover.png` })
assert.ok((await page.evaluate(() => window.__gource.probe())).find(d => d.path === 'data/blobs').collapsed, 'blobs should be folded when zoomed out')
assert.ok(await page.locator('canvas').evaluate(c => c.toDataURL().length) > 1000)
assert.deepEqual(errors, [])
console.log('lifecycle check ok', { before: before.length, after: after.length })
await browser.close()
