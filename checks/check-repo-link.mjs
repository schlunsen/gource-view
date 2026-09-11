// The repository being visualized is one click (or one key) from its real home,
// and privacy mode hides that link along with the name.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('https://github.com/**', r => r.fulfill({ contentType: 'text/html', body: '<title>repo</title>' }))
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const from = 1700000000, to = 1701000000
  const commits = Array.from({ length: 30 }, (_, c) => ({ hash: String(c), ts: from + c * (to - from) / 29, name: ['Ada', 'Bob'][c % 2], email: '', files: [{ p: `src/area${c % 4}/m${c % 5}.ts`, a: 5, d: 1 }] }))
  const result = { repo: 'acme/widget', source: 'github', sourceUrl: 'https://github.com/acme/widget', commits, stats: { from, to, commits: 30, authors: 2, loc: 150, topAuthors: [['Ada', 15], ['Bob', 15]] } }
  await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'acme/widget', gitea: null } }))
  await page.route('**/api/music', r => r.fulfill({ json: { tracks: [] } }))
  await page.route('**/api/trending', r => r.fulfill({ json: { fetchedAt: Date.now(), periods: {} } }))
  await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
  await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
  await page.goto('http://127.0.0.1:5173/viewer.html')

  const header = page.getByRole('link', { name: 'Open acme/widget on GitHub' })
  await header.waitFor()
  assert.equal(await header.getAttribute('href'), 'https://github.com/acme/widget')
  assert.equal(await header.getAttribute('target'), '_blank')
  assert.match(await header.getAttribute('rel'), /noopener/)
  const stats = page.locator('.repo-details-link')
  assert.equal(await stats.getAttribute('href'), 'https://github.com/acme/widget')
  assert.equal(await stats.evaluate(el => getComputedStyle(el).pointerEvents), 'auto', 'the name is clickable inside the pass-through overlay')
  await page.screenshot({ path: `${S}/repo-link-header.png`, clip: { x: 0, y: 0, width: 1440, height: 220 } })

  // "g" opens the repository in a new tab.
  const popup = context.waitForEvent('page')
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('g')
  assert.equal((await popup).url(), 'https://github.com/acme/widget')

  // Comparison panels link each project home too.
  await page.getByRole('button', { name: '⇄ Compare' }).click()
  const panel = page.locator('a.compare-name')
  await panel.waitFor()
  assert.equal(await panel.getAttribute('href'), 'https://github.com/acme/widget')
  await page.getByRole('button', { name: 'Exit ×' }).click()

  // Privacy hides the destination along with the name — and "g" does nothing.
  await page.keyboard.press('h'); await page.waitForTimeout(300)
  assert.equal(await page.locator('.repo-source-link, .repo-details-link').count(), 0)
  assert.ok(!(await page.locator('main').innerText()).includes('acme/widget'))
  const pages = context.pages().length
  await page.keyboard.press('g'); await page.waitForTimeout(400)
  assert.equal(context.pages().length, pages, 'no tab opens while the repository is hidden')

  assert.deepEqual(errors, [])
  console.log('Repo link: header link, stats link, g shortcut, compare panel link, hidden under privacy — passed.')
} finally { await browser.close() }
