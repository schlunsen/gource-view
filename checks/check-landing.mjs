import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
const shots = process.env.S || 'checks/out'
fs.mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const now = Math.floor(Date.now() / 1000), day = 86400
  const repos = [5, 40, 10, 30, 20].map((gained, i) => ({ name: `owner/project${i}`, gained, stars: 1000 + gained, language: 'JavaScript', description: 'A project built by people around the world.' }))
  // The day decides the subject; the week is present and must not be consulted.
  await page.route('**/api/trending', r => r.fulfill({
    json: {
      fetchedAt: Date.now(),
      periods: {
        daily: { source: 'github.com/trending', repos },
        weekly: { source: 'github.com/trending', repos: [{ name: 'owner/lastweek', gained: 9000, stars: 9000 }] },
      },
    },
  }))
  const loaded = []
  await page.route('**/api/load', r => { const repo = r.request().postDataJSON().repo; loaded.push(repo); return r.fulfill({ json: { job: encodeURIComponent(repo) } }) })
  await page.route('**/api/status/*', r => {
    const name = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop())
    const commits = Array.from({ length: 60 }, (_, i) => ({ hash: `c${i}`, ts: now - 20 * day + i * day / 3, name: `Dev ${i % 3}`, email: '', files: [{ p: `src/area${i % 5}/file${i}.js`, a: 10, d: 0 }] }))
    return r.fulfill({ json: { ok: true, status: 'done', result: { repo: name, commits, stats: { from: commits[0].ts, to: commits.at(-1).ts, commits: commits.length, authors: 3, loc: 600, topAuthors: [] } } } })
  })
  await page.goto('http://127.0.0.1:5173/')
  const settled = () => page.waitForFunction(() => document.querySelectorAll('.landing-header canvas').length === 1 && !document.querySelector('.landing-status'))
  await settled()
  // One subject: the day's leader, and nothing else was fetched.
  assert.equal(await page.locator('.landing-stage-title h2').textContent(), 'owner/project1')
  assert.deepEqual(loaded, ['owner/project1'], 'only the showcased project is loaded')
  assert.equal(await page.locator('canvas').count(), 1, 'a single preview on the page')
  assert.match(await page.locator('.landing-stage-title').textContent(), /MOST STARRED TODAY[\s\S]*\+40 ★ today · 1,040 total/)
  // The masthead IS the stage: full width, and the canvas runs behind the copy.
  const stage = await page.locator('.landing-header').evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, width: b.width, height: b.height } })
  assert.deepEqual([stage.left, stage.width], [0, 1440], 'the stage spans the viewport')
  assert.ok(stage.height > 600, `the stage is a showcase, not a thumbnail (${stage.height}px)`)
  const over = await page.evaluate(() => {
    const box = el => el.getBoundingClientRect()
    const canvas = box(document.querySelector('.landing-header canvas'))
    const inside = sel => { const b = box(document.querySelector(sel)); return b.top >= canvas.top && b.bottom <= canvas.bottom && b.left >= canvas.left }
    // What the visitor clicks must be the copy on top, never the canvas beneath it.
    const cta = box(document.querySelector('.landing-hero-cta'))
    // The nav keeps its own bar, clear of the renderer's date card in the corner.
    return { nav: box(document.querySelector('.landing-nav')).bottom <= canvas.top, hero: inside('.landing-hero h1'), caption: inside('.landing-stage-title'), hit: document.elementFromPoint(cta.x + cta.width / 2, cta.y + cta.height / 2)?.className }
  })
  assert.deepEqual([over.nav, over.hero, over.caption], [true, true, true], 'the nav bar sits above the stage; the headline and caption ride on it')
  assert.match(over.hit, /landing-hero-cta/, 'the call to action takes the click, not the canvas')
  // The reading column stays a column.
  assert.ok(await page.locator('.landing-about').evaluate(el => el.getBoundingClientRect().width <= 1440), 'text stays inside the wrap')
  // Playback runs the project's own history, start to finish.
  const timeline = page.getByRole('slider', { name: 'Project timeline' })
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Project timeline"]').value) > .005)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const paused = Number(await timeline.inputValue())
  await page.waitForTimeout(300)
  assert.equal(Number(await timeline.inputValue()), paused, 'pause freezes the clock')
  await timeline.fill('1')
  await timeline.dispatchEvent('input')
  await page.getByRole('button', { name: 'Replay history', exact: true }).click()
  assert.ok(Number(await timeline.inputValue()) < .02, 'replay returns to the first commit')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  // The masthead is a backdrop, not a viewport: the wheel scrolls the page over it.
  const stageMiddle = await page.locator('.landing-stage').evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
  await page.mouse.move(stageMiddle.x, stageMiddle.y)
  await page.mouse.wheel(0, 400)
  await page.waitForFunction(() => scrollY > 300, null, { timeout: 4000 }).catch(() => { throw new Error('the wheel zoomed the visualization instead of scrolling the page') })
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.landing-stage canvas')).touchAction), 'auto', 'touch scrolling is not blocked over the backdrop')
  await page.evaluate(() => scrollTo(0, 0))

  // The explainer says what the picture means, in the renderer's own colours.
  assert.match(await page.locator('#legend-title').textContent(), /What the animation/)
  assert.equal(await page.locator('.landing-legend-grid article').count(), 4)
  assert.deepEqual(await page.locator('.landing-key dd i').evaluateAll(els => els.map(e => e.style.background)), ['rgb(255, 160, 58)', 'rgb(58, 190, 255)', 'rgb(140, 120, 255)', 'rgb(140, 160, 190)'])

  // Statistics describe the showcased history.
  assert.deepEqual(await page.locator('.landing-stats dd').allTextContents().then(v => v.slice(0, 3)), ['60', '3', '600'])
  await page.screenshot({ path: path.join(shots, 'landing-desktop.png'), fullPage: true })
  // The subject strip sits at the top, above what it controls, and says which is on.
  assert.ok(await page.locator('.landing-switch').evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.landing-stage').getBoundingClientRect().top), 'the strip is above the stage it changes')
  const subjects = await page.locator('.landing-switch button').allTextContents()
  assert.deepEqual(subjects, ['owner/project1+40 ★', 'owner/project3+30 ★', 'owner/project4+20 ★', 'owner/project2+10 ★'])
  assert.deepEqual(await page.locator('.landing-switch button[aria-pressed="true"]').allTextContents(), ['owner/project1+40 ★'], 'the project on screen is the pressed one')
  await page.locator('.landing-switch button', { hasText: 'owner/project3' }).click()
  await settled()
  assert.equal(await page.locator('.landing-stage-title h2').textContent(), 'owner/project3')
  assert.deepEqual(loaded, ['owner/project1', 'owner/project3'])
  assert.equal(await page.locator('canvas').count(), 1, 'switching replaces the showcase')
  assert.deepEqual(await page.locator('.landing-switch button[aria-pressed="true"]').allTextContents(), ['owner/project3+30 ★'], 'the strip follows the switch')
  // Both links point at the real project and the viewer.
  const source = await page.locator('.landing-about a[target="_blank"]').evaluate(a => [a.href, a.rel])
  assert.deepEqual(source[0], 'https://github.com/owner/project3')
  assert.ok(source[1].includes('noopener'), 'external links drop the opener')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(shots, 'landing-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on mobile')
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.getByRole('link', { name: 'Open viewer', exact: false }).click()
  assert.ok(page.url().endsWith('/viewer.html'))
  await page.goto('http://127.0.0.1:5173/?repo=owner/project1')
  await page.waitForURL('**/viewer.html?repo=owner/project1')
  assert.deepEqual(errors, [])
  console.log('Landing: one full-width showcase of the day, single preview, playback, subject switching, responsive layout and legacy links passed.')
} finally { await browser.close() }
