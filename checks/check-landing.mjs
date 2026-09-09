import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const now = Math.floor(Date.now() / 1000), day = 86400
  const repos = [5, 40, 10, 30, 20].map((gained, i) => ({ name: `owner/project${i}`, gained, language: 'JavaScript', description: 'A project built by people around the world.' }))
  await page.route('**/api/trending', r => r.fulfill({ json: { fetchedAt: Date.now(), periods: { weekly: { source: 'github.com/trending', repos } } } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: encodeURIComponent(r.request().postDataJSON().repo) } }))
  await page.route('**/api/status/*', r => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop())
    const commits = Array.from({ length: 60 }, (_, i) => ({ hash: `c${i}`, ts: now - 20 * day + i * day / 3, name: `Dev ${i % 3}`, email: '', files: [{ p: `src/area${i % 5}/file${i}.js`, a: 10, d: 0 }] }))
    return r.fulfill({ json: { ok: true, status: 'done', result: { repo: name, commits, stats: { from: commits[0].ts, to: commits.at(-1).ts, commits: commits.length, authors: 3, loc: 600, topAuthors: [] } } } })
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.waitForFunction(() => document.querySelectorAll('.landing-card').length === 4 && document.querySelectorAll('.landing-status').length === 0)
  assert.deepEqual(await page.locator('.landing-card header a').allTextContents(), ['owner/project1', 'owner/project3', 'owner/project4', 'owner/project2'])
  assert.equal(await page.locator('.landing-card canvas').count(), 4)
  const boxes = await page.locator('.landing-card').evaluateAll(els => els.map(e => ({ x: e.offsetLeft, y: e.offsetTop })))
  assert.equal(boxes[0].y, boxes[1].y)
  assert.ok(boxes[2].y > boxes[0].y)
  await page.screenshot({ path: '/tmp/gource-landing-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/gource-landing-mobile.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.getByRole('link', { name: 'Open viewer', exact: false }).click()
  assert.ok(page.url().endsWith('/viewer.html'))
  await page.goto('http://127.0.0.1:5173/?repo=owner/project1')
  await page.waitForURL('**/viewer.html?repo=owner/project1')
  assert.deepEqual(errors, [])
  console.log('Landing: ranking, four rendered snapshots, responsive grid, viewer navigation and legacy links passed.')
} finally { await browser.close() }
