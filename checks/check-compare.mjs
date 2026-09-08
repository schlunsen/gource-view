// Several projects on one clock: shared time, per-project counters, and the two
// alignments (same calendar dates vs each project from its own first commit).
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const DAY = 86400
// Two projects with deliberately different starts and rhythms.
const build = (name, from, count, step) => ({
  repo: name,
  commits: Array.from({ length: count }, (_, i) => ({ hash: `${name}-${i}`, ts: from + i * step, name: `Dev ${i % 3}`, email: 'x@example.com', files: [{ p: `src/area${i % 4}/f${i % 9}.js`, a: 4, d: 1 }] })),
  stats: { from, to: from + (count - 1) * step, commits: count, authors: 3, loc: 100, topAuthors: [['Dev 0', count]] },
})
const EARLY = build('early/project', 1500000000, 60, 10 * DAY)         // starts first, slow
const LATE = build('late/project', 1500000000 + 300 * DAY, 120, 4 * DAY) // starts later, busier
const payloads = { 'early/project': EARLY, 'late/project': LATE }
const jobs = new Map()
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'early/project', gitea: null } }))
await page.route('**/api/load', r => { const body = r.request().postDataJSON(); const id = `job-${jobs.size}`; jobs.set(id, body.repo); r.fulfill({ json: { job: id } }) })
await page.route('**/api/status/*', r => {
  const id = new URL(r.request().url()).pathname.split('/').pop()
  r.fulfill({ json: { status: 'done', result: payloads[jobs.get(id)] } })
})
await page.goto('http://127.0.0.1:5173/')
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
await page.getByRole('button', { name: /Compare/ }).click()
const view = page.locator('.compare-view')
await view.waitFor()
await page.getByLabel('Add a project to compare').fill('late/project')
await page.getByRole('button', { name: 'Add', exact: true }).click()
await page.locator('.compare-panel').nth(1).locator('canvas').waitFor({ timeout: 60000 })
assert.equal(await page.locator('.compare-panel').count(), 2, 'both projects have a panel')

// the shared clock advances, and drives both panels
const clock = () => page.locator('.compare-clock').innerText()
const first = await clock()
await page.waitForTimeout(3000)
assert.notEqual(await clock(), first, 'the shared clock advances')

// same calendar dates: the later project has nothing yet while the earlier one does
await page.getByRole('slider', { name: 'Comparison progress' }).fill('0.15')
await page.waitForTimeout(600)
const counts = async () => (await page.locator('.compare-stat').allInnerTexts()).map(t => Number(t.split('/')[0].replace(/[^\d]/g, '')))
const [earlyAt15, lateAt15] = await counts()
assert.ok(earlyAt15 > 0, `the earlier project has commits by 15% (${earlyAt15})`)
assert.equal(lateAt15, 0, `the later project has not started yet on the same calendar (${lateAt15})`)
await page.screenshot({ path: `${S}/compare-dates.png` })

// by age: both are measured from their own first commit, so both have started
await page.getByRole('button', { name: 'By age' }).click()
await page.getByRole('slider', { name: 'Comparison progress' }).fill('0.15')
await page.waitForTimeout(600)
const [earlyAge, lateAge] = await counts()
assert.ok(earlyAge > 0 && lateAge > 0, `both projects have started when aligned by age (${earlyAge}, ${lateAge})`)
assert.match(await clock(), /days in/, 'the clock counts project age')
await page.screenshot({ path: `${S}/compare-age.png` })

// the end of the run shows every commit of both
await page.getByRole('slider', { name: 'Comparison progress' }).fill('1')
await page.waitForTimeout(800)
assert.deepEqual(await counts(), [EARLY.stats.commits, LATE.stats.commits], 'every commit is played by the end')

await page.getByRole('button', { name: 'Exit ×' }).click()
assert.equal(await page.locator('.compare-view').count(), 0, 'exits back to the viewer')
assert.deepEqual(errors, [])
console.log('compare check ok · shared clock, per-project counters, both alignments')
await browser.close()
