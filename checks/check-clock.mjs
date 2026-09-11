// The analog clock hides itself while history runs too fast to read it
// (faster than a day per second) and comes back when playback slows.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const DAY = 86400, start = 1700000000
const spans = { 'x/years': 3 * 365 * DAY, 'x/days': 2 * DAY, 'x/weeks': 60 * DAY }
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'x/days', gitea: null } }))
  await page.route('**/api/music', r => r.fulfill({ json: { tracks: [] } }))
  await page.route('**/api/trending', r => r.fulfill({ json: { fetchedAt: Date.now(), periods: {} } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: r.request().postDataJSON().repo.replace('/', '__') } })) // slash-free: the client URL-encodes job ids
  await page.route('**/api/status/*', r => {
    const repo = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop()).replace('__', '/'), span = spans[repo]
    const commits = Array.from({ length: 30 }, (_, c) => ({ hash: String(c), ts: start + c * span / 29, name: 'Ada', email: '', files: [{ p: `src/m${c % 5}.ts`, a: 5, d: 1 }] }))
    return r.fulfill({ json: { status: 'done', result: { repo, source: 'github', sourceUrl: `https://github.com/${repo}`, commits, stats: { from: start, to: start + span, commits: 30, authors: 1, loc: 150, topAuthors: [['Ada', 30]] } } } })
  })
  const open = async repo => {
    await page.goto(`http://127.0.0.1:5173/viewer.html?repo=${repo}`)
    await page.waitForFunction(name => window.__gource && document.querySelector('.repo-details') && document.body.innerText.includes(name), repo)
    await page.evaluate(() => window.__gource.setAutoPace(false)) // steady rate: the check is about speed, not pacing
  }
  const button = () => page.getByRole('button', { name: /^Clock / }).innerText()
  const hidden = () => page.evaluate(() => window.__gource.clockHidden)

  await open('x/years') // ~1M history s/s
  await page.waitForTimeout(400)
  assert.equal(await hidden(), true, 'years in seconds: the clock is hidden from the first frame')
  assert.equal(await button(), 'Clock auto')
  await page.screenshot({ path: `${S}/clock-hidden.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } })

  await open('x/days') // ~2k history s/s
  await page.waitForTimeout(400)
  assert.equal(await hidden(), false, 'two days of history: the clock reads fine')
  assert.equal(await button(), 'Clock on')
  await page.screenshot({ path: `${S}/clock-shown.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } })

  await open('x/weeks') // ~58k s/s: between the thresholds, starts shown
  assert.equal(await hidden(), false)
  await page.evaluate(() => window.__gource.setSpeed(4)) // ~230k s/s
  await page.waitForFunction(() => window.__gource.clockHidden, null, { timeout: 8000 })
  await page.evaluate(() => window.__gource.setSpeed(0.5)) // ~29k s/s
  await page.waitForFunction(() => !window.__gource.clockHidden, null, { timeout: 8000 })

  // The user's choice still wins: off is off.
  await page.keyboard.press('k'); await page.waitForTimeout(200)
  assert.equal(await button(), 'Clock off')
  assert.deepEqual(errors, [])
  console.log('Clock: hidden when history outruns it, shown when readable, follows speed changes both ways, toggle respected — passed.')
} finally { await browser.close() }
