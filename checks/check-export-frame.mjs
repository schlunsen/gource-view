import { chromium } from 'playwright'
import fs from 'node:fs'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
const names = ['Ada Lovelace', 'grace.hopper', 'Linus', 'Margaret Hamilton']
const commits = []
for (let i = 0; i < 48; i++) {
  const ts = i < 3 ? from : from + i * (to - from) / 47
  const name = i < 3 ? names[i] : i % 11 === 0 ? names[3] : names[0]
  commits.push({ hash: String(i), ts, name, files: Array.from({ length: 3 }, (_, j) => ({ p: `src/area${i % 5}/file${j + i}.js`, a: 10, d: 2 })) })
}
const repo = { repo: 'example/cards', commits, stats: { from, to, commits: commits.length, authors: 4, loc: 9000, topAuthors: [] } }
await page.goto('http://127.0.0.1:5173/export.html')
await page.waitForFunction(() => typeof window.initializeExport === 'function')
const formats = [
  ['landscape', { width: 1920, height: 1080, logicalWidth: 1920, logicalHeight: 1080, pixelRatio: 1 }],
  ['portrait', { width: 1080, height: 1920, logicalWidth: 1080, logicalHeight: 1920, pixelRatio: 1 }],
  ['4k', { width: 3840, height: 2160, logicalWidth: 1920, logicalHeight: 1080, pixelRatio: 2 }],
]
for (const [name, size] of formats) {
  await page.evaluate(input => window.initializeExport(input), { repo, options: { ...size, fps: 30, duration: 20, intro: 3, outro: 4, title: 'Cards test' } })
  for (const [frame, tag] of [[40, 'intro'], [75 + 90, 'history'], [90 + 600 + 70, 'outro']]) {
    const b64 = await page.evaluate(i => window.renderExportFrame(i), frame)
    fs.writeFileSync(`${S}/export-${name}-${tag}.png`, Buffer.from(b64, 'base64'))
  }
  const events = await page.evaluate(() => window.exportSoundEvents())
  if (!(events.length === repo.commits.length && events.every(e => e.t >= 3 && e.t <= 23))) throw new Error('sound events out of range: ' + JSON.stringify(events.slice(0, 3)))
}
const png4k = Buffer.from(await page.evaluate(i => window.renderExportFrame(i), 200), 'base64')
if (png4k.readUInt32BE(16) !== 3840 || png4k.readUInt32BE(20) !== 2160) throw new Error('4K frame has wrong pixel size')
// privacy: the same frames without names, and the repo path replaced on the cards
await page.evaluate(input => window.initializeExport(input), { repo, options: { ...formats[0][1], fps: 30, duration: 20, intro: 3, outro: 4, title: '', privacy: 'all' } })
for (const [frame, tag] of [[40, 'intro'], [165, 'history'], [760, 'outro']]) fs.writeFileSync(`${S}/export-privacy-${tag}.png`, Buffer.from(await page.evaluate(i => window.renderExportFrame(i), frame), 'base64'))
if (errors.length) { console.error(errors); process.exit(1) }
console.log('export frame check ok')
await browser.close()
