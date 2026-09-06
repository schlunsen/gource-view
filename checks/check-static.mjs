// Static-mode (GitHub Pages) check. Needs BASE, e.g. BASE=http://127.0.0.1:8810/gource-view/
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S, BASE = process.env.BASE
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const failed = []; page.on('requestfailed', r => { if (!r.url().includes('gravatar')) failed.push(r.url()) })
await page.goto(BASE)
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
assert.equal(await page.locator('#repo').inputValue(), 'expressjs/express')
assert.ok(await page.getByRole('button', { name: 'pallets/flask' }).count() > 0, 'demo suggestions')
assert.equal(await page.getByRole('button', { name: /Trending/ }).count(), 0, 'no trending without a server')
// unknown repo → explanatory error, no crash
await page.locator('#repo').fill('torvalds/linux'); await page.getByRole('button', { name: 'Load', exact: true }).click()
await page.getByRole('alert').waitFor({ timeout: 10000 })
assert.match(await page.getByRole('alert').innerText(), /pre-built repositories/)
// a demo loads from JSON
await page.getByRole('button', { name: 'pallets/flask' }).click()
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
assert.match(await page.locator('main').innerText(), /flask/)
// export → self-host note; video mode → music from the static files
await page.getByRole('button', { name: 'Export video' }).click()
assert.match(await page.locator('.export-dialog').innerText(), /Self-host/)
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /Video/ }).click()
await page.locator('.video-mode').waitFor()
await page.waitForTimeout(1500)
const src = await page.locator('.video-mode audio').getAttribute('src')
assert.match(src, /\/gource-view\/music\/.*\.mp3$/)
await page.screenshot({ path: `${S}/static-video.png` })
await page.keyboard.press('Escape')
assert.deepEqual(errors, []); assert.deepEqual(failed, [])
console.log('static check ok')
await browser.close()
