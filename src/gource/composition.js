// The "video" composition shared by MP4 export and the fullscreen video mode:
// background, chrome, title card and closing leaderboard, drawn in logical
// W×H coordinates (the caller sets the transform), plus the timeline that maps
// video seconds → history time through intro / paced history / outro.
import { initials, dateParts } from './contributor-cards.js'

const FONT_SANS = '"Space Grotesk", sans-serif', FONT_MONO = '"JetBrains Mono", monospace'
const easeOut = t => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3)
const clamp01 = t => Math.max(0, Math.min(1, t))
const fmtDate = ts => { const d = dateParts(ts); return `${d.day} ${d.month} ${d.year}` }

/**
 * @param {object} p  { ctx, data, config: { title, privacy, credit, intro, outro, duration }, renderer, W, H }
 */
export function createComposition({ ctx, data, config, renderer, W, H }) {
  const repoLabel = () => (config.privacy && config.privacy !== 'off') ? (config.title || 'Private repository') : data.repo
  const roundRect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

  function background() {
    ctx.globalCompositeOperation = 'destination-over'
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
    bg.addColorStop(0, '#182b3b'); bg.addColorStop(1, '#0a101b')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'source-over'
  }

  function chrome(progress) {
    const portrait = H > W, m = 60, titleMax = portrait ? W - 2 * m - 300 : 1450
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#64dedb'; ctx.font = `16px ${FONT_MONO}`
    ctx.fillText('GOURCE VIEW / REPOSITORY HISTORY', m, 48)
    ctx.fillStyle = '#e7edf6'; ctx.font = `500 ${portrait ? 28 : 32}px ${FONT_SANS}`
    ctx.fillText(config.title || repoLabel(), m, 94, titleMax)
    ctx.font = `16px ${FONT_MONO}`; ctx.fillStyle = '#a4b6cb'
    ctx.fillText(`${repoLabel()}  ·  ${data.stats.commits} commits  ·  ${data.stats.authors} authors`, m, H - 50, W - 2 * m)
    ctx.fillStyle = '#25384a'; ctx.fillRect(m, H - 26, W - 2 * m, 3)
    ctx.fillStyle = '#64dedb'; ctx.fillRect(m, H - 26, (W - 2 * m) * progress, 3)
  }

  function avatarDisc(name, x, y, r) {
    const img = renderer.avatar(name), col = renderer.authorColor(name)
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip()
    if (img) ctx.drawImage(img, x - r, y - r, r * 2, r * 2)
    else {
      ctx.fillStyle = `rgb(${col.join(',')})`; ctx.fillRect(x - r, y - r, r * 2, r * 2)
      ctx.fillStyle = '#0c101a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = `700 ${Math.round(r * 0.8)}px ${FONT_SANS}`; ctx.fillText(initials(renderer.displayName(name)), x, y + 1)
    }
    ctx.restore()
    ctx.strokeStyle = `rgb(${col.join(',')})`; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
  }

  // Title card: hold, then dissolve into the first frame of history.
  function introCard(p) {
    const dissolve = p > 0.72 ? clamp01((p - 0.72) / 0.28) : 0
    ctx.globalAlpha = 1 - dissolve
    const portrait = H > W, x = portrait ? 90 : 200, base = portrait ? H * 0.46 : 580, big = portrait ? 64 : 84, small = portrait ? 18 : 22
    ctx.fillStyle = '#0a101b'; ctx.fillRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.47)
    glow.addColorStop(0, 'rgba(100,222,219,0.10)'); glow.addColorStop(1, 'rgba(100,222,219,0)')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)
    const rise = (1 - easeOut(p / 0.4)) * 40
    ctx.globalAlpha = (1 - dissolve) * easeOut(p / 0.35)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#64dedb'; ctx.fillRect(x - 40, base - 110 + rise, 6, 150 * easeOut(p / 0.5))
    ctx.fillStyle = '#64dedb'; ctx.font = `600 18px ${FONT_MONO}`
    try { ctx.letterSpacing = '4px' } catch { /* older canvas */ }
    ctx.fillText('REPOSITORY HISTORY', x, base - 90 + rise)
    try { ctx.letterSpacing = '0px' } catch { /* older canvas */ }
    ctx.fillStyle = '#e7edf6'; ctx.font = `700 ${big}px ${FONT_SANS}`
    ctx.fillText(config.title || repoLabel(), x, base + rise, W - x - 60)
    ctx.fillStyle = '#a4b6cb'; ctx.font = `${small}px ${FONT_MONO}`
    ctx.globalAlpha = (1 - dissolve) * easeOut((p - 0.12) / 0.35)
    ctx.fillText(`${data.stats.commits ?? data.commits.length} commits  ·  ${data.stats.authors ?? '?'} contributors  ·  ${Number(data.stats.loc || 0).toLocaleString('en-US')} lines`, x, base + 60 + rise, W - x - 60)
    ctx.fillText(`${fmtDate(data.stats.from)}  →  ${fmtDate(data.stats.to)}`, x, base + 100 + rise, W - x - 60)
    ctx.globalAlpha = 1
  }

  // Closing leaderboard, sports-broadcast style: rows slide in one after another.
  function outroCard(p) {
    const portrait = H > W, x0 = portrait ? 80 : 200, rowW = W - x0 - (portrait ? 80 : 200), top = 300, rowH = 112
    const dim = easeOut(p / 0.2)
    ctx.fillStyle = `rgba(10,16,27,${0.82 * dim})`; ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = dim
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#64dedb'; ctx.fillRect(x0 - 40, top - 150, 6, 44)
    ctx.fillStyle = '#64dedb'; ctx.font = `600 18px ${FONT_MONO}`
    try { ctx.letterSpacing = '4px' } catch { /* older canvas */ }
    ctx.fillText('TOP CONTRIBUTORS', x0, top - 130)
    try { ctx.letterSpacing = '0px' } catch { /* older canvas */ }
    ctx.fillStyle = '#e7edf6'; ctx.font = `700 40px ${FONT_SANS}`
    ctx.fillText(config.title || repoLabel(), x0, top - 86, rowW)
    const rows = (data.stats.topAuthors || []).slice(0, portrait ? 8 : 6)
    const max = Math.max(1, ...rows.map(r => r[1]))
    const barW = rowW - 430 - (portrait ? 120 : 190)
    rows.forEach(([name, count], i) => {
      const t = easeOut((p - 0.12 - i * 0.09) / 0.3)
      if (t <= 0) return
      const y = top + i * rowH, slide = (1 - t) * 80
      const col = renderer.authorColor(name)
      ctx.globalAlpha = dim * t
      ctx.fillStyle = 'rgba(17,27,40,0.85)'
      roundRect(x0 - slide, y - 44, rowW, 92, 14); ctx.fill()
      ctx.fillStyle = `rgb(${col.join(',')})`
      ctx.beginPath(); ctx.moveTo(x0 - slide, y - 44); ctx.lineTo(x0 + 26 - slide, y - 44); ctx.lineTo(x0 + 14 - slide, y + 48); ctx.lineTo(x0 - slide, y + 48); ctx.closePath(); ctx.fill()
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `rgba(${col.join(',')},0.85)`; ctx.font = `800 36px ${FONT_SANS}`; ctx.textAlign = 'left'
      ctx.fillText(`#${i + 1}`, x0 + 50 - slide, y)
      avatarDisc(name, x0 + 172 - slide, y, 32)
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#e7edf6'; ctx.font = `700 30px ${FONT_SANS}`
      ctx.fillText(renderer.displayName(name), x0 + 230 - slide, y - 12, Math.max(200, barW - 40))
      ctx.fillStyle = 'rgba(115,137,162,0.35)'; ctx.fillRect(x0 + 230 - slide, y + 18, barW, 6)
      ctx.fillStyle = `rgb(${col.join(',')})`; ctx.fillRect(x0 + 230 - slide, y + 18, barW * (count / max) * easeOut((t - 0.2) / 0.8), 6)
      ctx.textAlign = 'right'; ctx.fillStyle = '#e7edf6'; ctx.font = `700 34px ${FONT_SANS}`
      ctx.fillText(String(count), x0 + rowW - 40 - slide, y - 6)
      ctx.fillStyle = '#8193aa'; ctx.font = `14px ${FONT_MONO}`
      ctx.fillText('COMMITS', x0 + rowW - 40 - slide, y + 24)
    })
    if (config.credit) {
      ctx.globalAlpha = dim; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#8193aa'; ctx.font = `15px ${FONT_MONO}`
      ctx.fillText(config.credit, x0, H - 78, rowW)
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  /** Video seconds → what to render. The last second of history holds the final graph. */
  function timeline(seconds) {
    const intro = config.intro || 0, outro = config.outro || 0, duration = config.duration
    const { from, to } = data.stats
    if (seconds < intro) return { phase: 'intro', phaseProgress: seconds / Math.max(1e-6, intro), ts: from, progress: 0, settle: 0 }
    if (seconds < intro + duration) {
      const s = seconds - intro, active = Math.max(0.1, duration - 1)
      const progress = Math.min(1, s / active)
      return { phase: 'history', phaseProgress: s / duration, ts: renderer.warp(progress), progress, settle: Math.max(0, s - active) }
    }
    const s = seconds - intro - duration
    return { phase: s < outro ? 'outro' : 'end', phaseProgress: Math.min(1, s / Math.max(1e-6, outro)), ts: to, progress: 1, settle: 1 + s }
  }

  /** Draw one full frame at `seconds` on a canvas whose backing size is pixelRatio × logical. */
  function drawFrame(seconds, canvas) {
    const t = timeline(seconds)
    renderer.renderAt(t.ts, t.settle, seconds)
    const scale = canvas.width / W
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    background()
    ctx.save()
    chrome(t.progress)
    if (t.phase === 'intro') introCard(t.phaseProgress)
    else if (t.phase === 'outro' || t.phase === 'end') outroCard(t.phase === 'end' ? 1 : t.phaseProgress)
    ctx.restore()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return t
  }

  /** Commit moments on the video clock (for sound). */
  function soundEvents() {
    const intro = config.intro || 0, active = Math.max(0.1, config.duration - 1)
    const total = renderer.playbackSeconds || 1
    return data.commits.map(c => ({ t: intro + renderer.elapsed(c.ts) / total * active, files: c.files.length }))
  }

  return { background, chrome, introCard, outroCard, repoLabel, timeline, drawFrame, soundEvents, totalSeconds: (config.intro || 0) + config.duration + (config.outro || 0) }
}
