import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const errors = []
const from = 1700000000, to = 1701000000
// quiet history with two bursts
const commits = []
let i = 0
const add = (ts, n) => { for (let k = 0; k < n; k++) commits.push({ hash: String(i), ts: ts + k * 60, name: ['Ada', 'Bob'][i % 2], files: [{ p: `src/m${i % 5}/f${i++}.js`, a: 3, d: 1 }] }) }
add(from, 2); add(from + (to - from) * 0.3, 12); add(from + (to - from) * 0.55, 1); add(from + (to - from) * 0.8, 14); add(to - 200, 1)
const result = { repo: 'example/controls', commits, stats: { from, to, commits: commits.length, authors: 2, loc: 100, topAuthors: [['Ada', 15], ['Bob', 15]] } }
const routes = async page => {
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/controls', gitea: null } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
  await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
}
const page = await ctx.newPage(); await routes(page)
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
const time = () => page.evaluate(() => window.__gource.time)
const slider = page.getByRole('slider')
// keyboard: space toggles, arrows seek, n/p jump bursts, ] speeds up, a toggles pace
await page.keyboard.press('Space'); await page.waitForTimeout(150)
assert.ok(await page.evaluate(() => window.__gource.playing))
await page.keyboard.press('Space'); await page.waitForTimeout(150)
assert.ok(!(await page.evaluate(() => window.__gource.playing)))
const t0 = await time()
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100)
assert.ok(await time() > t0, 'ArrowRight seeks forward')
await page.keyboard.press('Home'); await page.waitForTimeout(100)
await page.keyboard.press('n'); await page.waitForTimeout(150)
const burst1 = await time()
assert.ok(Math.abs(burst1 - (from + (to - from) * 0.3)) < (to - from) / 60, `first burst at ${burst1}`)
await page.keyboard.press('n'); await page.waitForTimeout(150)
assert.ok(await time() > from + (to - from) * 0.75, 'second burst')
await page.keyboard.press('p'); await page.waitForTimeout(150)
assert.ok(Math.abs(await time() - burst1) < (to - from) / 60, 'back to first burst')
await page.keyboard.press(']'); await page.waitForTimeout(100)
assert.equal(await page.evaluate(() => window.__gource.getSpeed()), 2)
await page.keyboard.press('a'); await page.waitForTimeout(100)
assert.equal(await page.evaluate(() => window.__gource.autoPace), false)
await page.keyboard.press('a')
await page.keyboard.press('?'); await page.waitForTimeout(150)
await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
await page.screenshot({ path: `${S}/controls-help.png` })
await page.keyboard.press('Escape')
// URL sync + share link
assert.match(page.url(), /repo=example%2Fcontrols|repo=example\/controls/)
assert.match(page.url(), /[?&]t=\d+/)
await page.keyboard.press('c'); await page.waitForTimeout(200)
const link = await page.evaluate(() => navigator.clipboard.readText())
assert.match(link, /speed=2/); assert.match(link, /t=\d+/)
// the auto-pace makes playback cover the quiet stretch quickly
await page.keyboard.press('Home'); await page.keyboard.press(']'); await page.keyboard.press(']') // 4×: leaves the near-commit zone quickly
await page.keyboard.press('Space'); await page.waitForTimeout(2500); await page.keyboard.press('Space')
const paced = await time()
assert.ok(paced > from + (to - from) * 0.2, `paced playback advanced to ${(paced - from) / (to - from)}`)
// opening a shared link lands paused at its moment
const shared = await ctx.newPage(); await routes(shared)
await shared.goto(link)
await shared.waitForFunction(() => window.__gource && !window.__gource.playing, null, { timeout: 30000 })
await shared.waitForTimeout(300)
const st = await shared.evaluate(() => ({ t: window.__gource.time, playing: window.__gource.playing, speed: window.__gource.getSpeed() }))
assert.ok(!st.playing && st.speed === 2 && Math.abs(st.t - Number(new URL(link).searchParams.get('t'))) < 2, JSON.stringify(st))
await shared.screenshot({ path: `${S}/controls-shared.png` })
assert.deepEqual(errors, [])
console.log('controls check ok')
await browser.close()
