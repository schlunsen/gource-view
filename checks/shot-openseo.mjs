import { chromium } from 'playwright'
import fs from 'node:fs'
const S = process.env.S || '/tmp'
const TAG = process.env.TAG || 'shot'
const result = JSON.parse(fs.readFileSync(process.env.DATA, 'utf8')).result
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'every-app/open-seo', gitea: null } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {})
const setSlider = v => page.getByRole('slider').first().evaluate((el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
const { from, to } = result.stats
for (const [f, name] of [[0.12, 'early'], [0.35, 'mid'], [0.7, 'late'], [1, 'full']]) {
  await setSlider(Math.round(from + (to - from) * f))
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${S}/${TAG}-${name}.png` })
}
console.log(TAG, 'ok', errors.length ? errors.slice(0, 3) : '')
await browser.close()
