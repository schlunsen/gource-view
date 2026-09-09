// MP4 export of a comparison: every project drawn into one frame, on the shared
// clock, encoded in the browser with the same pipeline as the single-project
// export.
import { createGource } from '../gource/renderer.js'
import { encodeToMp4, renderAudio } from './render.js'
import { comparisonWindow, countUpTo, timeAt } from '../compare-window.js'

const FONT_SANS = '"Space Grotesk", sans-serif', FONT_MONO = '"JetBrains Mono", monospace'
const SIZES = { '720p': 1280, '1080p': 1920 }
const GRID = { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2] }
const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export async function renderComparisonVideo({
  panels, align = 'dates', seconds = 30, resolution = '1080p', fps = 30,
  music = 'none', musicUrl = '', privacy = 'off', onProgress = () => {}, signal,
}) {
  const width = SIZES[resolution] || SIZES['1080p'], height = Math.round(width * 9 / 16)
  const [cols, rows] = GRID[Math.min(4, panels.length)] || GRID[4]
  const footer = Math.round(height * 0.062), header = Math.round(height * 0.05)
  const cellW = Math.floor(width / cols), cellH = Math.floor((height - footer) / rows)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')

  const window_ = comparisonWindow(panels.map(p => p.data), align)
  const engines = []
  try {
    for (const panel of panels) {
      const cell = document.createElement('canvas')
      cell.width = cellW; cell.height = cellH - header
      engines.push({ panel, cell, stamps: panel.data.commits.map(c => c.ts), engine: createGource(cell, panel.data, { manual: true, pixelRatio: 1, privacy, clock: false }) })
    }
    const faces = ['500', '700'].map(w => `${w} 32px ${FONT_SANS}`).concat(['400', '500'].map(w => `${w} 16px ${FONT_MONO}`))
    await Promise.race([Promise.allSettled(faces.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 5000))])
    await Promise.all(engines.map(e => e.engine.avatarsReady(4000)))

    onProgress({ stage: 'soundtrack', pct: 0 })
    const rendered = music !== 'none'
      ? await renderAudio({ events: [], options: { duration: seconds, intro: 0, outro: 0, sound: 'none', music }, musicUrl, signal })
      : null

    const drawFrame = i => {
      const u = Math.min(1, i / Math.max(1, seconds * fps - 1))
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#070d16'; ctx.fillRect(0, 0, width, height)
      engines.forEach(({ panel, cell, engine, stamps }, index) => {
        const ts = timeAt(panel.data, window_, align, u)
        engine.renderAt(ts, 0, i / fps)
        const x = (index % cols) * cellW, y = Math.floor(index / cols) * cellH
        ctx.fillStyle = '#0a101b'; ctx.fillRect(x, y, cellW, cellH)
        ctx.drawImage(cell, x, y + header)
        ctx.fillStyle = '#16222f'; ctx.fillRect(x, y + header - 1, cellW, 1)
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.fillStyle = '#e7edf6'; ctx.font = `500 ${Math.round(header * 0.42)}px ${FONT_MONO}`
        ctx.fillText(panel.name, x + 18, y + header / 2, cellW * 0.55)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#8193aa'; ctx.font = `${Math.round(header * 0.34)}px ${FONT_MONO}`
        ctx.fillText(`${countUpTo(stamps, ts).toLocaleString()} / ${panel.data.stats.commits.toLocaleString()} commits · ${panel.data.stats.authors} authors`, x + cellW - 18, y + header / 2)
        ctx.strokeStyle = '#16222f'; ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
      })
      // shared clock and progress
      const fy = height - footer
      ctx.fillStyle = '#070d16'; ctx.fillRect(0, fy, width, footer)
      ctx.fillStyle = '#1d2c3d'; ctx.fillRect(0, fy, width, 1)
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#64dedb'; ctx.font = `${Math.round(footer * 0.28)}px ${FONT_MONO}`
      ctx.fillText('GOURCE VIEW / COMPARING PROJECTS', 24, fy + footer / 2)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#e7edf6'; ctx.font = `500 ${Math.round(footer * 0.34)}px ${FONT_MONO}`
      ctx.fillText(align === 'age' ? `${Math.round(window_.span * u / 86400).toLocaleString()} days in` : fmtDate(window_.from + window_.span * u), width - 24, fy + footer / 2)
      const barW = width * 0.42, barX = (width - barW) / 2, barY = fy + footer / 2
      ctx.fillStyle = '#25384a'; ctx.fillRect(barX, barY - 1, barW, 3)
      ctx.fillStyle = '#64dedb'; ctx.fillRect(barX, barY - 1, barW * u, 3)
    }

    const out = await encodeToMp4({
      canvas, width, height, fps, resolution, totalFrames: Math.max(1, Math.round(seconds * fps)),
      drawFrame, rendered, onProgress, signal,
    })
    const names = panels.map(p => p.name.split('/').pop().replace(/[^\w.-]+/g, '-')).join('-vs-')
    return { ...out, filename: `${names}-${align}-${resolution}.mp4` }
  } finally {
    for (const e of engines) { try { e.engine.destroy() } catch { /* already gone */ } }
  }
}
