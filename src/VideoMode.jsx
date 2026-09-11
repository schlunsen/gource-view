import { useEffect, useRef, useState } from 'react'
import { createGource } from './gource/renderer.js'
import { createComposition } from './gource/composition.js'
import { musicFileUrl } from './api.js'

const INTRO = 3, OUTRO = 4
const timecode = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
function preference(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
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
export default function VideoMode({ repo, privacy, clock = true, tracks, onClose, shareLink, embed = false }) {
  const host = useRef(null), canvasRef = useRef(null), audioRef = useRef(null)
  const [duration, setDuration] = useState(30)
  const total = INTRO + duration + OUTRO
  const [elapsed, setElapsed] = useState(0)
  // ?music=<track id>&volume=<0-100> (e.g. from an embedding page) win over the saved preferences.
  const urlParams = new URLSearchParams(window.location.search)
  const urlVolume = urlParams.get('volume'), urlMusic = urlParams.get('music')
  const [volume, setVolume] = useState(() => {
    if (urlVolume !== null && Number.isFinite(+urlVolume)) return Math.max(0, Math.min(100, +urlVolume))
    const saved = preference('gource-video-volume', 30)
    return typeof saved === 'number' && Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 30
  })
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const fxRef = useRef(null)
  const togglePlayback = () => {
    if (state.current.elapsed >= total) { setRestartKey(k => k + 1); setPlaying(true) }
    else setPlaying(p => !p)
  }
  const seek = value => { state.current.seek = Math.max(0, Math.min(total, value)); setElapsed(state.current.seek) }
  const playAudio = () => {
    fxRef.current?.resume()
    const a = audioRef.current
    if (a) a.play().then(() => setAudioBlocked(false)).catch(e => {
      if (e.name === 'NotAllowedError') setAudioBlocked(true)
    })
  }
  const remembered = (() => { try { return localStorage.getItem('gource-video-music') } catch { return null } })()
  const known = id => id && (id === 'none' || tracks.some(t => t.id === id))
  const [music, setMusicState] = useState(known(urlMusic) ? urlMusic : known(remembered) ? remembered : (tracks[0]?.id || 'none'))
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
  const [effects, setEffects] = useState(() => preference('gource-video-effects', true) !== false)
  // Embedded players wait on the title card until the host page has revealed
  // them (it posts { source: 'git-city', type: 'play' }); 4 s fallback.
  const [playing, setPlaying] = useState(!embed)
  useEffect(() => {
    if (!embed) return
    const start = () => setPlaying(true)
    const onMessage = e => { if (e.source === window.parent && e.data?.type === 'play') start() }
    window.addEventListener('message', onMessage)
    const fallback = setTimeout(start, 4000)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(fallback) }
  }, [embed])
  const [phase, setPhase] = useState('intro')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [restartKey, setRestartKey] = useState(0)
  const state = useRef({ elapsed: 0, playing: true, effects: true })
  state.current.playing = playing; state.current.effects = effects; state.current.volume = volume / 100
  useEffect(() => {
    try {
      if (!embed) localStorage.setItem('gource-video-volume', JSON.stringify(volume)) // an embed's volume is its host's choice, not yours
      localStorage.setItem('gource-video-effects', JSON.stringify(effects))
    } catch { /* Storage can be disabled. */ }
  }, [volume, effects, embed])
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  useEffect(() => {
    const previous = document.activeElement
    host.current?.focus()
    return () => previous?.focus?.()
  }, [])

  // fullscreen on entry, back out on exit
  useEffect(() => {
    // Embedded players stay in their frame: no fullscreen, so leaving it can't close the video.
    if (embed) return
    const el = host.current
    el?.requestFullscreen?.().catch(() => {})
    const onFs = () => { if (!document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', onFs)
    return () => { document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  }, [onClose, embed])

  // auto-hiding controls
  useEffect(() => {
    let timer
    const show = () => { setControlsVisible(true); clearTimeout(timer); timer = setTimeout(() => setControlsVisible(false), 2500) }
    show()
    window.addEventListener('mousemove', show); window.addEventListener('touchstart', show)
    return () => { clearTimeout(timer); window.removeEventListener('mousemove', show); window.removeEventListener('touchstart', show) }
  }, [])

  // Let native selects, sliders and buttons keep their own keyboard behavior.
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      setControlsVisible(true)
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'Tab') {
        const nodes = [...host.current.querySelectorAll('button, select, input')].filter(el => !el.disabled)
        const first = nodes[0], last = nodes.at(-1)
        if (e.shiftKey && (document.activeElement === first || document.activeElement === host.current)) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
        return
      }
      if (e.target.closest('input, select, textarea, button, [contenteditable="true"]')) return
      switch (e.key.toLowerCase()) {
        case ' ': togglePlayback(); break
        case 'r': setRestartKey(k => k + 1); setPlaying(true); break
        case 'm': stepMusic(e.shiftKey ? -1 : 1); break
        case 'arrowleft': seek(state.current.elapsed - 5); break
        case 'arrowright': seek(state.current.elapsed + 5); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, music, tracks, total]) // eslint-disable-line react-hooks/exhaustive-deps

  // the render loop: one renderer + composition per (repo, duration, privacy, restart)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !repo) return
    const ctx = canvas.getContext('2d')
    const fx = makeEffects(); fxRef.current = fx
    const config = { title: '', privacy, intro: INTRO, outro: OUTRO, duration, credit: '' }
    let renderer, composition, raf, last = performance.now(), W = 1920, H = 1080, events = [], nextEvent = 0, disposed = false
    state.current.elapsed = 0; state.current.seek = null; setElapsed(0)
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
    // Embedded: tell the host once the title card is really on screen (fonts
    // loaded, first frame drawn and painted), so it can reveal the player.
    let fontsReady = false, announced = !embed
    Promise.all([document.fonts?.load?.(`700 32px ${FONT_SANS}`), document.fonts?.load?.(`500 16px ${FONT_MONO}`)])
      .catch(() => {}).finally(() => { fontsReady = true })
    const total = INTRO + duration + OUTRO
    const loop = now => {
      if (disposed) return
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      const s = state.current
      if (s.seek != null) {
        s.elapsed = s.seek; s.seek = null
        nextEvent = events.findIndex(e => e.t > s.elapsed)
        if (nextEvent < 0) nextEvent = events.length
        const a = audioRef.current
        if (a && Number.isFinite(a.duration) && a.duration > 0) a.currentTime = s.elapsed % a.duration
      }
      if (s.playing && s.elapsed < total + 1) {
        s.elapsed += dt
        while (nextEvent < events.length && events[nextEvent].t <= s.elapsed) { if (s.effects) fx.blip(events[nextEvent].files); nextEvent++ }
      }
      const shown = Math.min(total, Math.floor(s.elapsed * 10) / 10)
      setElapsed(p => p === shown ? p : shown)
      if (s.elapsed >= total && s.playing) setPlaying(false)
      const t = composition.drawFrame(Math.min(s.elapsed, total + 1), canvas)
      setPhase(p => (p === t.phase ? p : t.phase))
      if (!announced && fontsReady) {
        announced = true
        requestAnimationFrame(() => { if (!disposed) window.parent.postMessage({ source: 'gource-view', type: 'video-ready' }, '*') })
      }
      // music: fade in over 1.5 s, out over the last 3 s, paused with playback
      const a = audioRef.current
      if (a) {
        const target = !s.playing || s.elapsed >= total ? 0 : Math.min(1, s.elapsed / 1.5) * Math.min(1, Math.max(0, (total - s.elapsed) / 3))
        // Smooth track starts and volume changes; never retry blocked play every frame.
        const desired = target * s.volume
        a.volume = Math.max(0, Math.min(1, a.volume + (desired - a.volume) * (1 - Math.exp(-dt / 0.25))))
      }
      raf = requestAnimationFrame(loop)
    }
    fx.resume()
    raf = requestAnimationFrame(loop)
    return () => { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); renderer?.destroy(); fx.close(); fxRef.current = null }
  }, [repo, duration, privacy, clock, restartKey, embed])

  // Reset only for a new track or replay, never for pause/resume.
  useEffect(() => {
    const a = audioRef.current
    if (a) { a.volume = 0; a.currentTime = 0 }
    setAudioBlocked(false); setAudioFailed(false)
  }, [music, restartKey, duration])
  useEffect(() => {
    if (playing) playAudio()
    else audioRef.current?.pause()
  }, [music, restartKey, duration, playing])


  return (
    <div ref={host} className="video-mode" role="dialog" aria-modal="true" aria-label="Video mode" tabIndex={-1} data-phase={phase} onClick={e => { if (e.target === host.current || e.target === canvasRef.current) togglePlayback() }}>
      <canvas ref={canvasRef} className="video-canvas" aria-label="Video playback" />
      {music !== 'none' && <audio ref={audioRef} src={musicFileUrl(music)} loop preload="auto" onError={() => setAudioFailed(true)} />}
      {toast && <div className="video-toast" role="status">{toast}</div>}
      <div className={`video-controls ${controlsVisible || !playing || audioBlocked || audioFailed || phase === 'end' ? 'is-visible' : ''}`} onClick={e => e.stopPropagation()} onMouseEnter={() => setControlsVisible(true)}>
        {!embed && <div className="video-timeline">
          <span className="video-phase">{phase === 'intro' ? 'Opening' : phase === 'history' ? 'History' : 'Leaderboard'}</span>
          <input type="range" aria-label="Playback position" aria-valuetext={`${timecode(elapsed)} of ${timecode(total)}`} min="0" max={total} step="0.1" value={elapsed} onChange={e => seek(+e.target.value)} />
          <span className="video-time">{timecode(elapsed)} <span>/ {timecode(total)}</span></span>
        </div>}
        <div className="video-control-row">
        <button type="button" onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'} className="video-play">{playing ? '❚❚' : '▶'}</button>
        <button type="button" onClick={() => { setRestartKey(k => k + 1); setPlaying(true) }}>↺ Replay</button>
        <label>Length <select value={duration} onChange={e => { setDuration(+e.target.value); setRestartKey(k => k + 1) }}><option value={15}>15 s</option><option value={30}>30 s</option><option value={60}>60 s</option></select></label>
        <span className="video-music" role="group" aria-label="Music">
          <button type="button" aria-label="Previous track" onClick={() => stepMusic(-1)}>‹</button>
          <select value={music} onChange={e => setMusic(e.target.value)} aria-label="Music track">{tracks.map(t => <option key={t.id} value={t.id}>♪ {t.title}</option>)}<option value="none">♪ No music</option></select>
          <button type="button" aria-label="Next track" onClick={() => stepMusic(1)}>›</button>
        </span>
        <label className="video-volume">Volume <input type="range" aria-label="Music volume" min="0" max="100" step="1" value={volume} onChange={e => setVolume(+e.target.value)} /><output>{volume}%</output></label>
        <label><input type="checkbox" checked={effects} onChange={e => setEffects(e.target.checked)} /> effects</label>
        <span className="video-hint">space pause · ← → seek · m music · esc exit</span>
        {shareLink && <button type="button" className="video-share" title="Copy a link that opens this repository straight in video mode" onClick={async () => {
          const url = shareLink()
          try { await navigator.clipboard.writeText(url); setToast('Video link copied') } catch { setToast(url) }
          clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2500)
        }}>Copy video link</button>}
        <button type="button" onClick={onClose} className="video-exit">Exit ×</button>
        </div>
        {audioBlocked && <button type="button" className="video-audio-notice" onClick={playAudio}>Enable audio</button>}
        {audioFailed && <span className="video-audio-notice" role="status">Track unavailable — try another track.</span>}
      </div>
    </div>
  )
}
