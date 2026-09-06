import { useEffect, useRef, useState } from 'react'
import { createGource } from './gource/renderer.js'
import { createComposition } from './gource/composition.js'
import { musicFileUrl } from './api.js'

const INTRO = 3, OUTRO = 4
const FONT_SANS = '"Space Grotesk", sans-serif', FONT_MONO = '"JetBrains Mono", monospace'

/** Subtle WebAudio effects: a blip per commit, a soft whoosh for bursts. */
function makeEffects() {
  let ac = null, lastBlip = -Infinity, lastWhoosh = -Infinity
  const ensure = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)() } catch { ac = null } } return ac }
  return {
    resume() { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}) },
    blip(files) {
      const c = ensure(); if (!c) return
      const t0 = c.currentTime
      // Dense history stays quiet instead of stacking dozens of voices.
      if (t0 - lastBlip < 0.12) return
      lastBlip = t0
      const amp = 0.018 * Math.min(1, 0.45 + Math.log2(1 + files) / 7)
      const o = c.createOscillator(), g = c.createGain()
      o.frequency.setValueAtTime(440, t0); o.frequency.exponentialRampToValueAtTime(330, t0 + 0.28)
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.025); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28); g.gain.linearRampToValueAtTime(0, t0 + 0.30)
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 0.31)
      if (files >= 20 && t0 - lastWhoosh >= 0.8) {
        lastWhoosh = t0
        const len = Math.floor(c.sampleRate * 0.7), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0)
        let lp = 0; for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.06; d[i] = lp }
        const s = c.createBufferSource(), ng = c.createGain()
        s.buffer = buf; ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(0.025, t0 + 0.2); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65); ng.gain.linearRampToValueAtTime(0, t0 + 0.7)
        s.connect(ng).connect(c.destination); s.start(t0)
      }
    },
    close() { ac?.close().catch(() => {}); ac = null },
  }
}

/**
 * Fullscreen "play as video": the export composition (title card → paced
 * history → leaderboard) driven live, with a music bed and subtle effects.
 */
export default function VideoMode({ repo, privacy, clock = true, tracks, onClose }) {
  const host = useRef(null), canvasRef = useRef(null), audioRef = useRef(null)
  const [duration, setDuration] = useState(30)
  const remembered = (() => { try { return localStorage.getItem('gource-video-music') } catch { return null } })()
  const [music, setMusicState] = useState(remembered && (remembered === 'none' || tracks.some(t => t.id === remembered)) ? remembered : (tracks[0]?.id || 'none'))
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  const setMusic = id => {
    setMusicState(id)
    try { localStorage.setItem('gource-video-music', id) } catch { /* private mode */ }
    const t = tracks.find(t => t.id === id)
    setToast(id === 'none' ? '♪ Music off' : `♪ ${t?.title || id}`)
    clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 1800)
  }
  const stepMusic = dir => {
    const ids = [...tracks.map(t => t.id), 'none']
    setMusic(ids[(ids.indexOf(music) + dir + ids.length) % ids.length])
  }
  const [effects, setEffects] = useState(true)
  const [playing, setPlaying] = useState(true)
  const [phase, setPhase] = useState('intro')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [restartKey, setRestartKey] = useState(0)
  const state = useRef({ elapsed: 0, playing: true, effects: true })
  state.current.playing = playing; state.current.effects = effects

  // fullscreen on entry, back out on exit
  useEffect(() => {
    const el = host.current
    el?.requestFullscreen?.().catch(() => {})
    const onFs = () => { if (!document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', onFs)
    return () => { document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  }, [onClose])

  // auto-hiding controls
  useEffect(() => {
    let timer
    const show = () => { setControlsVisible(true); clearTimeout(timer); timer = setTimeout(() => setControlsVisible(false), 2500) }
    show()
    window.addEventListener('mousemove', show); window.addEventListener('touchstart', show)
    return () => { clearTimeout(timer); window.removeEventListener('mousemove', show); window.removeEventListener('touchstart', show) }
  }, [])

  // keyboard: space pause, esc exit, r restart
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'r') setRestartKey(k => k + 1)
      else if (e.key === 'm' || e.key === 'M') stepMusic(e.shiftKey ? -1 : 1)
      setControlsVisible(true)
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, music, tracks]) // eslint-disable-line react-hooks/exhaustive-deps

  // the render loop: one renderer + composition per (repo, duration, privacy, restart)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !repo) return
    const ctx = canvas.getContext('2d')
    const fx = makeEffects()
    const config = { title: '', privacy, intro: INTRO, outro: OUTRO, duration, credit: '' }
    let renderer, composition, raf, last = performance.now(), W = 1920, H = 1080, events = [], nextEvent = 0, disposed = false
    state.current.elapsed = 0
    const size = () => {
      const r = host.current.getBoundingClientRect()
      const portrait = r.height > r.width
      W = portrait ? 1080 : 1920; H = portrait ? 1920 : 1080
      const scale = Math.min(r.width / W, r.height / H), dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.style.width = `${W * scale}px`; canvas.style.height = `${H * scale}px`
      canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr)
      renderer?.destroy()
      renderer = createGource(canvas, repo, { manual: true, duration, pixelRatio: canvas.width / W, privacy, clock })
      composition = createComposition({ ctx, data: repo, config, renderer, W, H })
      events = composition.soundEvents().sort((a, b) => a.t - b.t); nextEvent = events.findIndex(e => e.t >= state.current.elapsed); if (nextEvent < 0) nextEvent = events.length
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(host.current)
    document.fonts?.load?.(`700 32px ${FONT_SANS}`); document.fonts?.load?.(`500 16px ${FONT_MONO}`)
    const total = INTRO + duration + OUTRO
    const loop = now => {
      if (disposed) return
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      const s = state.current
      if (s.playing && s.elapsed < total + 1) {
        s.elapsed += dt
        while (nextEvent < events.length && events[nextEvent].t <= s.elapsed) { if (s.effects) fx.blip(events[nextEvent].files); nextEvent++ }
      }
      const t = composition.drawFrame(Math.min(s.elapsed, total + 1), canvas)
      setPhase(p => (p === t.phase ? p : t.phase))
      // music: fade in over 1.5 s, out over the last 3 s, paused with playback
      const a = audioRef.current
      if (a) {
        const target = !s.playing || s.elapsed >= total ? 0 : Math.min(1, s.elapsed / 1.5) * Math.min(1, Math.max(0, (total - s.elapsed) / 3))
        a.volume = Math.max(0, Math.min(1, target * 0.30))
        if (s.playing && s.elapsed < total && a.paused) a.play().catch(() => {})
        if ((!s.playing || s.elapsed >= total) && !a.paused) a.pause()
      }
      raf = requestAnimationFrame(loop)
    }
    fx.resume()
    raf = requestAnimationFrame(loop)
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); renderer?.destroy(); fx.close() }
  }, [repo, duration, privacy, clock, restartKey])

  useEffect(() => { const a = audioRef.current; if (!a) return; a.volume = 0; a.currentTime = 0; if (music !== 'none' && playing) a.play().catch(() => {}) }, [music, restartKey, playing])

  return (
    <div ref={host} className="video-mode" data-phase={phase} onClick={e => { if (e.target === host.current) setPlaying(p => !p) }}>
      <canvas ref={canvasRef} className="video-canvas" aria-label="Video playback" />
      {music !== 'none' && <audio ref={audioRef} src={musicFileUrl(music)} loop preload="auto" />}
      {toast && <div className="video-toast" role="status">{toast}</div>}
      <div className={`video-controls ${controlsVisible || !playing || phase === 'end' ? 'is-visible' : ''}`} onClick={e => e.stopPropagation()} onMouseEnter={() => setControlsVisible(true)}>
        <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Play'} className="video-play">{playing ? '❚❚' : '▶'}</button>
        <button type="button" onClick={() => { setRestartKey(k => k + 1); setPlaying(true) }}>↺ Replay</button>
        <label>Length <select value={duration} onChange={e => { setDuration(+e.target.value); setRestartKey(k => k + 1) }}><option value={15}>15 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select></label>
        <span className="video-music" role="group" aria-label="Music">
          <button type="button" aria-label="Previous track" onClick={() => stepMusic(-1)}>‹</button>
          <select value={music} onChange={e => setMusic(e.target.value)} aria-label="Music track">{tracks.map(t => <option key={t.id} value={t.id}>♪ {t.title}</option>)}<option value="none">♪ No music</option></select>
          <button type="button" aria-label="Next track" onClick={() => stepMusic(1)}>›</button>
        </span>
        <label><input type="checkbox" checked={effects} onChange={e => setEffects(e.target.checked)} /> effects</label>
        <span className="video-hint">space pause · m next track · r replay · esc exit</span>
        <button type="button" onClick={onClose} className="video-exit">Exit ×</button>
      </div>
    </div>
  )
}
