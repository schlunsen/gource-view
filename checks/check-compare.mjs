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
const TREND = build('trending/project', 1500000000 + 100 * DAY, 40, 8 * DAY)
const FOUND = build('searched/project', 1500000000 + 200 * DAY, 30, 9 * DAY)
const payloads = { 'early/project': EARLY, 'late/project': LATE, 'trending/project': TREND, 'searched/project': FOUND }
const jobs = new Map()
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'early/project', gitea: null } }))
// trending is a baked list; GitHub search answers cross-origin. Both stay in the browser.
await page.route('**/api/trending', r => r.fulfill({ json: { fetchedAt: Date.now(), periods: { weekly: { source: 'github.com/trending', repos: [{ name: 'trending/project', description: 'Hot', language: 'Go', gained: 900, stars: 9000, sizeMb: 4 }] } } } }))
let searchQueries = 0
await page.route('https://api.github.com/search/repositories**', r => {
  searchQueries++
  r.fulfill({ json: { items: [{ full_name: 'searched/project', stargazers_count: 4200, language: 'Rust', description: 'Found by search' }] } })
})
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

// every panel's canvas is sized to its box, not left at the default 300x150
const sizes = await page.locator('.compare-panel canvas').evaluateAll(list => list.map(c => {
  const box = c.parentElement.getBoundingClientRect()
  return { w: c.width, h: c.height, boxW: Math.round(box.width), boxH: Math.round(box.height) }
}))
assert.equal(sizes.length, 2)
for (const s of sizes) {
  assert.notDeepEqual([s.w, s.h], [300, 150], `canvas left at the default size: ${JSON.stringify(s)}`)
  const scale = s.w / s.boxW
  assert.ok(scale >= 1 && scale <= 2.01, `backing store should match its box at 1-2x dpr, got ${scale.toFixed(2)} (${JSON.stringify(s)})`)
  assert.ok(Math.abs(s.h / s.boxH - scale) < 0.05, `aspect ratio should match its box (${JSON.stringify(s)})`)
}

// a project can be added from trending, without leaving the comparison
await view.getByRole('button', { name: /Trending/ }).click()
await view.getByRole('listbox', { name: 'Trending repositories' }).getByRole('option').first().click()
await page.locator('.compare-panel').nth(2).locator('canvas').waitFor({ timeout: 60000 })
assert.equal(await page.locator('.compare-panel').count(), 3, 'trending adds a third project')

// and by searching GitHub from the browser
await page.getByLabel('Add a project to compare').fill('searched')
await page.locator('.repo-search-results [role=option]').first().waitFor({ timeout: 15000 })
assert.ok(searchQueries > 0, 'the browser queried GitHub search directly')
assert.match(await page.locator('.repo-search-results').innerText(), /searched\/project/)
await page.locator('.repo-search-results [role=option]').first().click()
await page.locator('.compare-panel').nth(3).locator('canvas').waitFor({ timeout: 60000 })
assert.equal(await page.locator('.compare-panel').count(), 4, 'search adds a fourth project')
await page.screenshot({ path: `${S}/compare-four.png` })

// the comparison itself exports to MP4, rendered in this browser
await page.route('**/api/music', r => r.fulfill({ json: { tracks: [] } }))
await view.getByRole('button', { name: 'Export video ↗' }).click()
await view.getByLabel('Length').selectOption('15')
await view.getByLabel('Resolution').selectOption('720p')
const dialogText = await page.locator('.compare-export').innerText()
if (/no usable video encoder|cannot encode/i.test(dialogText)) {
  console.log('  (this browser has no WebCodecs encoder — export skipped)')
} else {
  await view.getByRole('button', { name: /^Render \d+ projects/ }).click()
  await page.locator('.compare-export-done a').waitFor({ timeout: 300000 })
  const href = await page.locator('.compare-export-done a').getAttribute('href')
  assert.ok(href.startsWith('blob:'), 'the MP4 is produced in the browser')
  const name = await page.locator('.compare-export-done a').getAttribute('download')
  assert.match(name, /-vs-.*\.mp4$/, `filename names both projects: ${name}`)
  const bytes = await page.evaluate(async href => (await (await fetch(href)).blob()).size, href)
  assert.ok(bytes > 100000, `a real video came out (${bytes} bytes)`)
  assert.match(await page.locator('.compare-export-done').innerText(), /rendered in your browser/)
  console.log(`  comparison video: ${(bytes / 1048576).toFixed(1)} MB`)
}
await page.locator('.compare-export').getByRole('button', { name: 'Close' }).click()

await page.getByRole('button', { name: 'Exit ×' }).click()
assert.equal(await page.locator('.compare-view').count(), 0, 'exits back to the viewer')
assert.deepEqual(errors, [])
console.log('compare check ok · shared clock, per-project counters, both alignments')
await browser.close()
