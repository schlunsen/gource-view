import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
const BASE = process.env.BASE, OUT = process.env.OUT
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(BASE)
await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 240000 })
await page.getByRole('button', { name: 'Export video' }).click()
await page.getByLabel('Resolution').selectOption('720p')
await page.getByLabel('History length').selectOption('15')
await page.getByRole('button', { name: 'Render video' }).click()
await page.getByRole('link', { name: 'Download MP4' }).waitFor({ timeout: 400000 })
const downloaded = page.waitForEvent('download')
await page.getByRole('link', { name: 'Download MP4' }).click()
await (await downloaded).saveAs(OUT)
assert.deepEqual(errors, [])
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=nb_frames,width,height:format=duration', '-of', 'json', OUT], { encoding: 'utf8' })
console.log('prod export ok', probe.stdout.replace(/\s+/g, ' '))
await browser.close()
