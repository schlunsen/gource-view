import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
 await page.route('**/camera-check', r => r.fulfill({ contentType: 'text/html', body: '<canvas id="camera" width="1280" height="720"></canvas>' }))
 await page.goto((process.env.BASE || 'http://127.0.0.1:5173') + '/camera-check')
 const result = await page.evaluate(async () => {
  const { createGource } = await import('/src/gource/renderer.js')
  const from = 1700000000, to = from + 1000000
  const commits = [0, .01, .4, .41, .9, 1].map((u, i) => ({ hash: String(i), ts: from + (to-from)*u, name: 'Author', files: Array.from({ length: 40 }, (_, j) => ({ p: `${i < 2 ? 'left' : 'right'}/area${j % 8}/file${j}.js`, a: 3, d: 0, ...(i === 4 ? { s: 'D' } : {}) })) }))
  const data = { repo: 'fixture/camera', commits, stats: { from, to, authors: 1, commits: commits.length, loc: 720, topAuthors: [['Author', 6]] } }
  const g = createGource(document.querySelector('canvas'), data, { manual: true, duration: 30 })
  const samples = []
  for (let i = 0; i <= 900; i++) {
    if (i === 300) g.setAutoPace(false)
    if (i === 450) g.setFlyover(false)
    if (i === 540) g.setFlyover(true)
    const u = i < 600 ? i / 900 : (900-i) / 900 // reverse history without reversing the camera
    g.renderAt(g.warp(u), 0, i / 30)
    samples.push(g.camera())
  }
  g.zoomBy(3); g.renderAt(from, 0, 30 + 1/30)
  const zoomStart = g.camera()
  for (let i = 2; i < 92; i++) g.renderAt(from, 0, 30 + i/30)
  const zoomEnd = g.camera()
  g.resetView(); g.renderAt(from, 0, 30 + 92/30)
  const resetStart = g.camera()
  g.destroy()
  return { samples, zoomStart, zoomEnd, resetStart }
 })
 const { samples } = result
 let maxZoom = 0, maxPan = 0, maxAngle = 0
 for (let i = 1; i < samples.length; i++) {
  const a=samples[i-1], b=samples[i]
  maxZoom = Math.max(maxZoom, Math.abs(Math.log(b.scale/a.scale)))
  maxPan = Math.max(maxPan, Math.hypot(b.cx-a.cx, b.cy-a.cy)*b.scale)
  maxAngle = Math.max(maxAngle, Math.abs(b.angle-a.angle))
 }
 assert.ok(maxZoom < .28 / 30 + .0001, `zoom step ${maxZoom}`)
 assert.ok(maxPan < 9, `pan step ${maxPan}px`)
 assert.ok(maxAngle < .1/30 + .0001, `orbit step ${maxAngle}`)
 assert.ok(result.zoomStart.renderedZoom < 1.2, 'zoom buttons ease into motion')
 assert.ok(result.zoomEnd.renderedZoom > 2.9)
 assert.ok(result.resetStart.renderedZoom > 2.7, 'reset does not snap zoom')
 console.log('camera continuity passed across bursts, deletions, pacing changes, flyover toggles, reverse seeking, zoom and reset', { maxZoom, maxPan, maxAngle })
} finally { await browser.close() }
