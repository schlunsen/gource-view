import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const folders = [['desktop/frontend/src/components', 14, 'vue'], ['desktop/frontend/src/stores', 6, 'ts'], ['django_backend/apps/messages/tasks', 12, 'py'], ['django_backend/apps/integrations', 9, 'py'], ['django_backend/tests', 12, 'py'], ['ws_gateway/lib', 8, 'ex'], ['k8s/moon', 6, 'yaml'], ['docs', 6, 'md'], ['assets', 5, 'png']]
const commits = []
for (let c = 0; c < 40; c++) {
  const ts = from + c * (to - from) / 39
  const picks = c < 3 ? folders.slice(c * 3, c * 3 + 3) : [folders[c % folders.length]]
  const files = []
  for (const [dir, n, ext] of picks) for (let j = 0; j < (c < 3 ? n : 2); j++) files.push({ p: `${dir}/file${(j + c) % n}.${ext}`, a: 8, d: 1 })
  commits.push({ hash: String(c), ts, name: ['Rasmus', 'Ada'][c % 2], files })
}
const result = { repo: 'example/fly', commits, stats: { from, to, commits: commits.length, authors: 2, loc: 9000, topAuthors: [] } }
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/fly', gitea: null } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).waitFor()
// let it play at 4× and grab frames as the camera orbits
await page.getByRole('button', { name: '4×', exact: true }).click()
const sizes = []
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${S}/fly-${i}.png` })
  sizes.push(await page.locator('canvas').evaluate(c => c.toDataURL().length))
}
assert.equal(await page.evaluate(() => window.__gource.flyover), true)
await page.getByRole('button', { name: /Flyover on/ }).click()
assert.equal(await page.evaluate(() => window.__gource.flyover), false)
await page.waitForTimeout(600)
await page.screenshot({ path: `${S}/fly-off.png` })
assert.deepEqual(errors, [])
console.log('flyover check ok', sizes)
await browser.close()
