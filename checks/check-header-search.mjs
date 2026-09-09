// The header field searches GitHub as you type, but still loads an exact
// owner/repo or URL as typed, without querying search at all.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const result = name => ({ repo: name, commits: [{ hash: '1', ts: from, name: 'Ada', files: [{ p: 'a.js', a: 1, d: 0 }] }, { hash: '2', ts: to, name: 'Ada', files: [{ p: 'b.js', a: 1, d: 0 }] }], stats: { from, to, commits: 2, authors: 1, loc: 2, topAuthors: [['Ada', 2]] } })
const loads = []
let searches = 0
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'seed/repo', gitea: null } }))
await page.route('**/api/load', r => { loads.push(r.request().postDataJSON().repo); r.fulfill({ json: { job: 'j' } }) })
await page.route('**/api/status/*', r => r.fulfill({ json: { status: 'done', result: result(loads[loads.length - 1]) } }))
await page.route('https://api.github.com/search/repositories**', r => {
  searches++
  r.fulfill({ json: { items: [
    { full_name: 'facebook/react', stargazers_count: 230000, language: 'JavaScript', description: 'The library for web UIs' },
    { full_name: 'preactjs/preact', stargazers_count: 37000, language: 'JavaScript', description: 'Fast 3kB alternative' },
  ] } })
})
await page.goto('http://127.0.0.1:5173/')
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })

// typing a search term offers repositories
await page.locator('#repo').fill('react')
await page.locator('.repo-search-results [role=option]').first().waitFor({ timeout: 15000 })
assert.ok(searches > 0, 'the header queried GitHub search')
const names = await page.locator('.repo-search-results .repo-search-name').allInnerTexts()
assert.match(names.join(' '), /facebook\/react/, names.join(' '))

// picking one loads it and leaves the field showing what was loaded
await page.locator('.repo-search-results [role=option]').first().click()
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
assert.equal(loads[loads.length - 1], 'facebook/react', 'the picked repository was loaded')
assert.equal(await page.locator('#repo').inputValue(), 'facebook/react', 'the field keeps showing it')
assert.equal(await page.locator('.repo-search-results').count(), 0, 'the list closes after picking')

// an exact owner/repo is a destination: loaded as typed, with no search at all
const before = searches
await page.locator('#repo').fill('vuejs/core')
await page.waitForTimeout(900)
assert.equal(searches, before, 'an exact owner/repo does not query search')
await page.getByRole('button', { name: /^Load/ }).click()
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
assert.equal(loads[loads.length - 1], 'vuejs/core')

// so is a URL
await page.locator('#repo').fill('https://github.com/rust-lang/rust')
await page.waitForTimeout(900)
assert.equal(searches, before, 'a URL does not query search either')

// keyboard: ArrowDown then Enter takes the highlighted result
await page.locator('#repo').fill('react')
await page.locator('.repo-search-results [role=option]').first().waitFor({ timeout: 15000 })
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
assert.equal(loads[loads.length - 1], 'preactjs/preact', 'the second result was chosen with the keyboard')
await page.screenshot({ path: `${S}/header-search.png` })
assert.deepEqual(errors, [])
console.log('header search check ok · search, pick, direct owner/repo, URL, keyboard')
await browser.close()
