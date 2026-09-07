// Renders a real MP4 in the browser build (WebCodecs + mp4 muxing) and validates it with ffprobe.
// BASE=http://127.0.0.1:8821/gource-view/ node checks/check-browser-export.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE, S = process.env.S
assert.ok(BASE, 'Set BASE to the built static site')
// Google Chrome ships H.264 + AAC encoders; Playwright's Chromium falls back to VP9 + Opus. Both are valid outputs.
// CHECK_CHANNEL=chromium forces the bundled build to exercise the fallback codecs.
let browser
if (process.env.CHECK_CHANNEL === 'chromium') browser = await chromium.launch({ headless: true })
else try { browser = await chromium.launch({ headless: true, channel: 'chrome' }) } catch { browser = await chromium.launch({ headless: true }) }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(BASE)
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
  await page.locator('.repo-discovery summary').click()
  await page.getByRole('button', { name: 'pallets/flask', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 30000 })
  await page.getByRole('button', { name: 'Export video' }).click()
  const dialog = page.locator('.export-dialog')
  await page.waitForFunction(() => !/Checking video support/.test(document.querySelector('.export-dialog')?.innerText || ''))
  const text = await dialog.innerText()
  if (/cannot encode|no usable video encoder|unavailable here/.test(text)) { console.log('browser export check: this browser has no WebCodecs encoder — unsupported message shown, skipping render'); await browser.close(); process.exit(0) }
  assert.match(text, /Rendered right here in your browser/)
  await dialog.getByLabel('Resolution').selectOption('720p')
  await dialog.getByLabel('History length').selectOption('15')
  await dialog.getByLabel('Video title').fill('Browser export test')
  // cancel works mid-render
  await dialog.getByRole('button', { name: 'Render video →' }).click()
  await dialog.getByRole('button', { name: 'Cancel export' }).click({ timeout: 60000 })
  await dialog.getByText('Export cancelled.').waitFor({ timeout: 30000 })
  await dialog.getByRole('button', { name: 'Back to settings' }).click()
  // a full render
  const t0 = Date.now()
  await dialog.getByRole('button', { name: 'Render video →' }).click()
  await dialog.getByText('Your video is ready.').waitFor({ timeout: 300000 })
  console.log(`rendered 22 s of 720p video in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  assert.match(await dialog.innerText(), /Rendered in your browser \((H\.264|VP9)( · (AAC|Opus))?\)/)
  const link = dialog.getByRole('link', { name: /Download MP4/ })
  const filename = await link.getAttribute('download'); assert.match(filename, /^pallets-flask-history-720p\.mp4$/)
  const href = await link.getAttribute('href'); assert.ok(href.startsWith('blob:'))
  const b64 = await page.evaluate(async href => { const blob = await (await fetch(href)).blob(); return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob) }) }, href)
  const file = `${S}/browser-export${process.env.CHECK_CHANNEL === 'chromium' ? '-chromium' : ''}.mp4`
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }))
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio')
  assert.ok(v && ['h264', 'vp9'].includes(v.codec_name), `video codec ${v?.codec_name}`)
  assert.equal(v.width, 1280); assert.equal(v.height, 720)
  const duration = Number(probe.format.duration)
  assert.ok(Math.abs(duration - 22) < 0.6, `duration ${duration}`)
  assert.ok(a && ['aac', 'opus'].includes(a.codec_name), `audio codec ${a?.codec_name}`)
  assert.ok(fs.statSync(file).size > 500000, 'real bytes')
  console.log(`mp4 ok: ${v.codec_name} ${v.width}x${v.height} ${v.avg_frame_rate} + ${a.codec_name}, ${duration.toFixed(2)} s, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`)
  await page.screenshot({ path: `${S}/browser-export${process.env.CHECK_CHANNEL === 'chromium' ? '-chromium' : ''}.png` })
  assert.deepEqual(errors, [])
  console.log('browser export check ok')
} finally { await browser.close() }
