import { chromium } from 'playwright'
const S = process.env.S, BASE = process.env.BASE, REPO = process.env.REPO
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(BASE)
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 240000 }) // default repo finished
const input = page.getByRole('textbox').first()
await input.fill(REPO)
await page.getByRole('button', { name: 'Load', exact: true }).click()
await page.waitForFunction(r => document.body.innerText.includes(r.split('/').pop()), REPO, { timeout: 240000 })
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 240000 })
await page.waitForTimeout(500)
const setSlider = v => page.getByRole('slider').evaluate((el, v) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
const { from, to } = await page.evaluate(() => ({ from: window.__gource.from, to: window.__gource.to }))
for (const [f, name] of [[0.05, 'a'], [0.4, 'b'], [1, 'c']]) {
  await setSlider(Math.round(from + (to - from) * f))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${S}/real-${name}.png` })
}
const dirs = await page.evaluate(() => window.__gource.probe())
console.log('folders on screen:', dirs.length, 'errors:', errors)
await browser.close()
