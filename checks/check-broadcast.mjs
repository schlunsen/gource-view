import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const errors = []
const from = 1700000000, to = 1701000000
const folders = [['desktop/frontend/src/components', 14, 'vue'], ['desktop/frontend/src/stores', 6, 'ts'], ['django_backend/apps/messages/tasks', 8, 'py'], ['django_backend/apps/integrations', 7, 'py'], ['django_backend/tests', 12, 'py'], ['ws_gateway/lib', 8, 'ex'], ['k8s/moon', 6, 'yaml'], ['docs', 6, 'md'], ['assets', 5, 'png']]
const names = ['Rasmus Schlünsen', 'Ada Lovelace', 'grace.hopper', 'Linus']
const commits = []
for (let c = 0; c < 60; c++) {
  const ts = from + c * (to - from) / 59
  const picks = c < 3 ? folders.slice(c * 3, c * 3 + 3) : [folders[c % folders.length], folders[(c * 7) % folders.length]]
  const files = []
  for (const [dir, n, ext] of picks) for (let j = 0; j < (c < 3 ? n : 2); j++) files.push({ p: `${dir}/file${(j + c) % n}.${ext}`, a: 8, d: 1 })
  const name = names[c % 4]
  commits.push({ hash: String(c), ts, name, email: name.toLowerCase().replace(/\s+/g, '.') + '@example.com', files })
}
const topAuthors = names.map(n => [n, commits.filter(c => c.name === n).length]).sort((a, b) => b[1] - a[1])
const result = { repo: 'example/broadcast', commits, stats: { from, to, commits: commits.length, authors: 4, loc: 12345, topAuthors } }
const route = async page => {
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/broadcast', gitea: null } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
  await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
}
// live playback: actors flying + director camera
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await route(page)
await page.goto('http://127.0.0.1:5173')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
await page.getByRole('button', { name: '2×', exact: true }).click()
await page.getByRole('button', { name: 'Play', exact: true }).click()
for (let i = 0; i < 4; i++) { await page.waitForTimeout(1500); await page.screenshot({ path: `${S}/bc-play-${i}.png` }) }
// export frames: intro, history, outro
const ex = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
ex.on('pageerror', e => errors.push(e.message))
await ex.goto('http://127.0.0.1:5173/export.html')
await ex.waitForFunction(() => typeof window.initializeExport === 'function')
await ex.evaluate(input => window.initializeExport(input), { repo: result, options: { width: 1920, height: 1080, fps: 30, duration: 15, intro: 3, outro: 4, title: 'Broadcast test' } })
for (const [frame, name] of [[40, 'intro'], [80, 'intro-dissolve'], [300, 'history'], [3 * 30 + 15 * 30 + 70, 'outro']]) {
  const b64 = await ex.evaluate(i => window.renderExportFrame(i), frame)
  fs.writeFileSync(`${S}/bc-${name}.png`, Buffer.from(b64, 'base64'))
}
// determinism: same frame twice → identical pixels
const a = await ex.evaluate(() => window.renderExportFrame(300)), b = await ex.evaluate(() => window.renderExportFrame(300))
assert.equal(a, b)
assert.deepEqual(errors, [])
console.log('broadcast check ok')
await browser.close()
