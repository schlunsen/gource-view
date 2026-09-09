// Marketing stills for the README, from a real repository payload (DATA=path.json).
import { chromium } from 'playwright'
import fs from 'node:fs'
const S = process.env.S, result = JSON.parse(fs.readFileSync(process.env.DATA, 'utf8'))
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: result.repo, gitea: null } }))
await page.route('**/api/music', r => r.fulfill({ json: { tracks: [] } }))
await page.route('**/api/trending', r => r.fulfill({ json: { fetchedAt: Date.now(), source: 'github.com/trending', repos: [] } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 60000 })
// deep into the history, then let it play so actors are mid-flight
await page.getByRole('slider').evaluate(el => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(+el.min + (+el.max - +el.min) * 0.82)); el.dispatchEvent(new Event('input', { bubbles: true })) })
await page.getByRole('button', { name: '1×', exact: true }).click()
await page.getByRole('button', { name: 'Play', exact: true }).click()
await page.waitForTimeout(6000)
await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.waitForTimeout(400)
await page.screenshot({ path: `${S}/shot-app.png` })
// video composition frames at 1080p via the export page
const ex = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await ex.goto('http://127.0.0.1:5173/export.html')
await ex.waitForFunction(() => typeof window.initializeExport === 'function')
await ex.evaluate(input => window.initializeExport(input), { repo: result, options: { width: 1920, height: 1080, logicalWidth: 1920, logicalHeight: 1080, pixelRatio: 1, fps: 30, duration: 30, intro: 3, outro: 4, title: 'expressjs/express', credit: 'Music: “Floating Cities” by Kevin MacLeod (incompetech.com) · CC BY 4.0' } })
for (const [frame, name] of [[55, 'title-card'], [90 + 760, 'history'], [90 + 900 + 75, 'leaderboard']]) {
  const b64 = await ex.evaluate(i => window.renderExportFrame(i), frame)
  fs.writeFileSync(`${S}/shot-${name}.png`, Buffer.from(b64, 'base64'))
}
console.log('shots ok')
await browser.close()
