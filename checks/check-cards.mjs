import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const errors = []
const from = 1700000000, to = 1701000000
// 8 contributors joining over time (3 on day one), one of them reaching 10 commits
const names = ['Ada Lovelace', 'grace.hopper', 'Linus', 'Margaret Hamilton', 'ken', 'Dennis Ritchie', 'Bjarne', 'Guido van Rossum']
const commits = []
for (let i = 0; i < 48; i++) {
  const ts = i < 3 ? from : from + i * (to - from) / 47 // three debuts land together
  const name = i < 3 ? names[i] : i % 11 === 0 ? names[3 + Math.floor(i / 11) - 1] : names[0]
  commits.push({ hash: String(i), ts, name, files: Array.from({ length: 3 }, (_, j) => ({ p: `src/area${i % 5}/file${j + i}.js`, a: 10, d: 2 })) })
}
const result = { repo: 'example/cards', commits, stats: { from, to, commits: commits.length, authors: names.length, loc: 9000, topAuthors: [['Ada Lovelace', 30]] } }
async function open(viewport) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/cards', gitea: null } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
  await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  return page
}
const setSlider = (page, v) => page.getByRole('slider').evaluate((el, v) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
const page = await open({ width: 1440, height: 900 })
const sizes = []
// t0: three debuts queued (lanes); later: a milestone card mid-history; then quiet
for (const [f, name] of [[0.004, 'debuts'], [0.012, 'lanes'], [12 / 47 + 0.004, 'milestone'], [0.5, 'quiet']]) {
  await setSlider(page, Math.round(from + (to - from) * f))
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${S}/cards-${name}.png` })
  sizes.push(await page.locator('canvas').evaluate(c => c.toDataURL().length))
}
assert.notEqual(sizes[0], sizes[3], 'cards should change the frame')
const mobile = await open({ width: 390, height: 780 })
await setSlider(mobile, Math.round(from + (to - from) * 0.012))
await mobile.waitForTimeout(600)
await mobile.screenshot({ path: `${S}/cards-mobile.png` })
assert.deepEqual(errors, [])
console.log('cards check ok', sizes)
await browser.close()
