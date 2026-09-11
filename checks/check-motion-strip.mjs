import { chromium } from 'playwright'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const commits = []
for (let i = 0; i < 40; i++) {
  const ts = from + i * (to - from) / 39
  if (i === 20) {
    const files = []
    for (let d = 0; d < 8; d++) for (let j = 0; j < 40; j++) files.push({ p: `packages/pkg${d}/src/component${j}.tsx`, a: 30, d: 0 })
    commits.push({ hash: 'spike', ts, name: 'Big Importer', files })
  } else {
    commits.push({ hash: String(i), ts, name: 'Dev ' + (i % 3), files: Array.from({ length: 4 }, (_, j) => ({ p: `src/area${i % 6}/file${j + i}.js`, a: 10, d: 2 })) })
  }
}
const result = { repo: 'example/spike', commits, stats: { from, to, commits: commits.length, authors: 4, loc: 9000, topAuthors: [['Big Importer', 1]] } }
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/spike', gitea: null } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
const setSlider = async (v) => page.getByRole('slider').evaluate((el, v) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
await setSlider(Math.round(commits[20].ts - (to - from) * 0.01))
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Play', exact: true }).click()
for (let i = 0; i < 16; i++) {
  await page.screenshot({ path: `${S}/motion-${String(i).padStart(2, '0')}.png`, clip: { x: 260, y: 90, width: 1180, height: 650 } })
  await page.waitForTimeout(300)
}
console.log('errors', errors)
await browser.close()
