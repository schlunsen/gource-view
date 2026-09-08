import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createGource } from './gource/renderer.js'
import { startLoad, pollStatus, cancelJob } from './api.js'

const PLAYBACK_SECONDS = 60
const SPEEDS = [0.5, 1, 2, 4]
const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
/** Commits at or before `ts`, by binary search over the sorted timestamps. */
function countUpTo(stamps, ts) {
  let lo = 0, hi = stamps.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (stamps[mid] <= ts) lo = mid + 1; else hi = mid }
  return lo
}

/** Loads one repository through the ordinary browser/server path. */
function loadRepo(name, options, onProgress) {
  return new Promise((resolve, reject) => {
    let job, timer, done = false
    const stop = () => { clearInterval(timer); if (job && !done) cancelJob(job) }
    startLoad(name, options).then(started => {
      job = started.job
      timer = setInterval(async () => {
        try {
          const s = await pollStatus(job)
          if (!s.ok && s.error) { done = true; stop(); reject(new Error(s.error)); return }
          if (s.progress) onProgress(s.progress)
          if (s.status === 'done') { done = true; stop(); resolve(s.result) }
          if (s.status === 'error') { done = true; stop(); reject(new Error(s.error || 'Could not load this repository.')) }
        } catch (e) { done = true; stop(); reject(e) }
      }, 400)
    }).catch(reject)
  })
}

/**
 * Two or more repositories side by side on one clock. "dates" puts them on the
 * same calendar so you see who was busier in the same window; "age" starts each
 * at its own first commit, comparing like for like.
 */
export default function CompareView({ primary, initial = [], privacy = 'off', maxCommits, onClose }) {
  const stampsOf = data => data.commits.map(c => c.ts)
  const [panels, setPanels] = useState(() => [{ name: primary.repo, data: primary, stamps: primary.commits.map(c => c.ts) }])
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [align, setAlign] = useState('dates')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [u, setU] = useState(0)
  const uRef = useRef(0), playRef = useRef(true), speedRef = useRef(1)
  useEffect(() => { playRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed }, [speed])
  const canvases = useRef(new Map()), engines = useRef(new Map())
  const ready = panels.filter(p => p.data)
  const frameRef = useRef({ ready, tsFor: () => 0 })

  const add = useCallback(async name => {
    const clean = name.trim()
    if (!clean || panels.some(p => p.name.toLowerCase() === clean.toLowerCase())) return
    if (panels.length >= 4) { setError('Four projects at a time is the limit.'); return }
    setError(''); setPending(clean)
    setPanels(list => [...list, { name: clean, loading: true, progress: null }])
    try {
      const data = await loadRepo(clean, { maxCommits }, progress => setPanels(list => list.map(p => p.name === clean ? { ...p, progress } : p)))
      setPanels(list => list.map(p => p.name === clean ? { name: data.repo || clean, data, stamps: stampsOf(data) } : p))
    } catch (e) {
      setPanels(list => list.filter(p => p.name !== clean))
      setError(`${clean}: ${e.message}`)
    } finally { setPending('') }
  }, [panels, maxCommits])

  // repositories named in the shared link
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    for (const name of initial) if (name && name.toLowerCase() !== primary.repo.toLowerCase()) void add(name)
  }, [initial, primary.repo, add])

  // one shared window: real dates, or each project from its own first commit
  const window_ = useMemo(() => {
    if (!ready.length) return { from: 0, to: 1, span: 1 }
    if (align === 'age') { const span = Math.max(1, ...ready.map(p => p.data.stats.to - p.data.stats.from)); return { from: 0, to: span, span } }
    const from = Math.min(...ready.map(p => p.data.stats.from)), to = Math.max(...ready.map(p => p.data.stats.to))
    return { from, to, span: Math.max(1, to - from) }
  }, [ready, align])
  const tsFor = useCallback((panel, progress) => align === 'age'
    ? panel.data.stats.from + window_.span * progress
    : window_.from + window_.span * progress, [window_, align])

  // keep the canvas backing store matched to its panel
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = el => {
      const canvas = el.querySelector('canvas')
      if (!canvas) return
      const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }
    const boxes = [...document.querySelectorAll('.compare-canvas')]
    boxes.forEach(size)
    const ro = new ResizeObserver(entries => entries.forEach(e => size(e.target)))
    boxes.forEach(el => ro.observe(el))
    return () => ro.disconnect()
  }, [panels.length])

  // engines follow the panels
  useEffect(() => {
    for (const panel of ready) {
      if (engines.current.has(panel.name)) continue
      const canvas = canvases.current.get(panel.name)
      if (!canvas) continue
      try { engines.current.set(panel.name, createGource(canvas, panel.data, { manual: true, privacy, clock: false })) } catch { /* skipped below */ }
    }
    for (const [name, engine] of engines.current) if (!ready.some(p => p.name === name)) { engine.destroy(); engines.current.delete(name) }
  }, [ready, privacy])
  useEffect(() => () => { for (const engine of engines.current.values()) engine.destroy(); engines.current.clear() }, [])

  // one clock drives every panel. requestAnimationFrame reports the *start* of
  // the frame, so seed from it rather than performance.now() — mixing the two
  // yields a negative delta and runs the clock backwards.
  useEffect(() => {
    let raf, last = null
    const frame = now => {
      if (last === null) last = now
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now
      if (playRef.current) {
        uRef.current = Math.max(0, Math.min(1, uRef.current + dt * speedRef.current / PLAYBACK_SECONDS))
        if (uRef.current >= 1) setPlaying(false)
        setU(uRef.current)
      }
      const { ready: current, tsFor: at } = frameRef.current
      for (const panel of current) engines.current.get(panel.name)?.renderAt(at(panel, uRef.current), 0)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  frameRef.current = { ready, tsFor }
  const seek = value => { uRef.current = value; setU(value) }
  const replay = () => { seek(0); setPlaying(true) }

  return (
    <div className="compare-view" role="dialog" aria-label="Compare projects">
      <header className="compare-head">
        <span className="eyebrow">COMPARING {ready.length} {ready.length === 1 ? 'PROJECT' : 'PROJECTS'}</span>
        <form className="compare-add" onSubmit={e => { e.preventDefault(); add(new FormData(e.currentTarget).get('repo')); e.currentTarget.reset() }}>
          <input name="repo" aria-label="Add a project to compare" placeholder="owner/repo to compare…" disabled={!!pending} />
          <button type="submit" disabled={!!pending}>{pending ? 'Loading…' : 'Add'}</button>
        </form>
        <div className="compare-align" role="group" aria-label="Time alignment">
          <button type="button" aria-pressed={align === 'dates'} className={align === 'dates' ? 'is-active' : ''} onClick={() => setAlign('dates')} title="Put both projects on the same calendar">Same dates</button>
          <button type="button" aria-pressed={align === 'age'} className={align === 'age' ? 'is-active' : ''} onClick={() => setAlign('age')} title="Start each project at its own first commit">By age</button>
        </div>
        <button type="button" className="compare-exit" onClick={onClose}>Exit ×</button>
      </header>
      {error && <p className="compare-error" role="alert">{error}</p>}
      <div className="compare-grid" data-count={panels.length}>
        {panels.map(panel => (
          <section key={panel.name} className="compare-panel">
            <div className="compare-panel-head">
              <span className="compare-name">{panel.name}</span>
              {panel.data && <span className="compare-stat">{countUpTo(panel.stamps, tsFor(panel, u)).toLocaleString()} / {panel.data.stats.commits.toLocaleString()} commits · {panel.data.stats.authors} authors</span>}
              {panel.loading && <span className="compare-stat">{panel.progress?.detail || 'Loading…'}</span>}
            </div>
            <div className="compare-canvas">
              {panel.data
                ? <canvas ref={el => { if (el) canvases.current.set(panel.name, el); else canvases.current.delete(panel.name) }} />
                : <div className="compare-loading">{panel.progress?.detail || 'Loading…'}</div>}
            </div>
          </section>
        ))}
      </div>
      <footer className="compare-controls">
        <button type="button" onClick={() => (u >= 1 ? replay() : setPlaying(p => !p))} className="compare-play">{u >= 1 ? '↻' : playing ? '❚❚' : '▶'}</button>
        <input type="range" min="0" max="1" step="0.0005" value={u} aria-label="Comparison progress" onChange={e => seek(+e.target.value)} />
        <span className="compare-clock tnum">{align === 'age' ? `${Math.round(window_.span * u / 86400)} days in` : fmtDate(window_.from + window_.span * u)}</span>
        <div className="compare-speeds">
          {SPEEDS.map(s => <button key={s} type="button" aria-pressed={speed === s} className={speed === s ? 'is-active' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
      </footer>
    </div>
  )
}
