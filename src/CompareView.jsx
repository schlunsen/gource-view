import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createGource } from './gource/renderer.js'
import { startLoad, pollStatus, cancelJob, STATIC, musicTracks, musicFileUrl } from './api.js'
import RepoSearch from './RepoSearch.jsx'
import TrendingPanel from './TrendingPanel.jsx'
import GiteaPicker from './GiteaPicker.jsx'

import { comparisonWindow, countUpTo, timeAt } from './compare-window.js'
import { repoLink, repoHost } from './repo-link.js'

const PLAYBACK_SECONDS = 30
const SPEEDS = [0.5, 1, 2, 4]
const fmtDate = ts => new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
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
export default function CompareView({ primary, initial = [], privacy = 'off', maxCommits, gitea = null, giteaRepos = [], onClose }) {
  const stampsOf = data => data.commits.map(c => c.ts)
  const [panels, setPanels] = useState(() => [{ name: primary.repo, data: primary, stamps: primary.commits.map(c => c.ts) }])
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [align, setAlign] = useState('dates')
  const [exporting, setExporting] = useState(null)   // null | { status, pct, stage, url, filename, bytes, codecs, error }
  const [exportOpen, setExportOpen] = useState(false)
  const [tracks, setTracks] = useState([])
  const [settings, setSettings] = useState({ resolution: '1080p', seconds: 30, music: 'none' })
  const exportCtl = useRef(null)
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
  useEffect(() => { musicTracks().then(t => { setTracks(t); setSettings(s => ({ ...s, music: t[0]?.id || 'none' })) }).catch(() => setTracks([])) }, [])

  // The video is rendered here, frame by frame, with the same clock the panels use.
  const runExport = useCallback(async () => {
    if (!ready.length) return
    setPlaying(false)
    const { renderComparisonVideo } = await import('./browser-export/compare.js')
    exportCtl.current = new AbortController()
    if (exporting?.url) URL.revokeObjectURL(exporting.url)
    setExporting({ status: 'rendering', pct: 0, stage: 'starting' })
    try {
      const out = await renderComparisonVideo({
        panels: ready, align, seconds: settings.seconds, resolution: settings.resolution, fps: 30, privacy,
        music: settings.music, musicUrl: settings.music !== 'none' ? musicFileUrl(settings.music) : '',
        signal: exportCtl.current.signal,
        onProgress: p => setExporting(e => (e && e.status === 'rendering' ? { ...e, ...p } : e)),
      })
      setExporting({ status: 'done', pct: 100, url: URL.createObjectURL(out.blob), filename: out.filename, bytes: out.blob.size,
        codecs: `${out.video === 'avc' ? 'H.264' : 'VP9'}${out.audio === 'none' ? '' : out.audio === 'aac' ? ' · AAC' : ' · Opus'}` })
    } catch (e) {
      setExporting({ status: e.name === 'AbortError' ? 'cancelled' : 'error', error: e.name === 'AbortError' ? '' : e.message })
    }
  }, [ready, align, settings, privacy, exporting])
  useEffect(() => () => { if (exportCtl.current) exportCtl.current.abort() }, [])

  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    for (const name of initial) if (name && name.toLowerCase() !== primary.repo.toLowerCase()) void add(name)
  }, [initial, primary.repo, add])

  // one shared window: real dates, or each project from its own first commit
  const window_ = useMemo(() => comparisonWindow(ready.map(p => p.data), align), [ready, align])
  const tsFor = useCallback((panel, progress) => timeAt(panel.data, window_, align, progress), [window_, align])

  // keep the canvas backing store matched to its panel. Left unsized, a canvas
  // keeps its default 300×150 and CSS stretches it — the graph renders correct
  // but hugely magnified.
  const sizeCanvas = useCallback(canvas => {
    const box = canvas?.parentElement
    if (!box) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  }, [])
  const readyKey = ready.map(p => p.name).join('|')
  useEffect(() => {
    const boxes = [...document.querySelectorAll('.compare-canvas')]
    for (const el of boxes) sizeCanvas(el.querySelector('canvas'))
    const ro = new ResizeObserver(entries => entries.forEach(e => sizeCanvas(e.target.querySelector('canvas'))))
    boxes.forEach(el => ro.observe(el))
    return () => ro.disconnect()
  }, [readyKey, sizeCanvas])

  // engines follow the panels
  useEffect(() => {
    for (const panel of ready) {
      if (engines.current.has(panel.name)) continue
      const canvas = canvases.current.get(panel.name)
      if (!canvas) continue
      sizeCanvas(canvas) // the renderer reads these dimensions as it starts
      try { engines.current.set(panel.name, createGource(canvas, panel.data, { manual: true, privacy, clock: false })) } catch { /* skipped below */ }
    }
    for (const [name, engine] of engines.current) if (!ready.some(p => p.name === name)) { engine.destroy(); engines.current.delete(name) }
  }, [ready, privacy, sizeCanvas])
  useEffect(() => () => { for (const engine of engines.current.values()) engine.destroy(); engines.current.clear() }, [])

  // one clock drives every panel. requestAnimationFrame reports the *start* of
  // the frame, so seed from it rather than performance.now() — mixing the two
  // yields a negative delta and runs the clock backwards.
  useEffect(() => {
    let raf, last = null, cameraSeconds = 0
    const frame = now => {
      if (last === null) last = now
      const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now
      if (playRef.current) {
        uRef.current = Math.max(0, Math.min(1, uRef.current + dt * speedRef.current / PLAYBACK_SECONDS))
        if (uRef.current >= 1) setPlaying(false)
        setU(uRef.current)
      }
      if (playRef.current) cameraSeconds += dt
      const { ready: current, tsFor: at } = frameRef.current
      for (const panel of current) engines.current.get(panel.name)?.renderAt(at(panel, uRef.current), 0, cameraSeconds)
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
        <div className="compare-add">
          <RepoSearch onPick={add} disabled={!!pending} label="Add a project to compare" placeholder={pending ? `Loading ${pending}…` : 'Search GitHub, or owner/repo…'} />
          <TrendingPanel staticDemo={STATIC} onPick={add} />
          {gitea && <GiteaPicker label={gitea.label} repos={giteaRepos} onPick={name => add(`gitea:${name}`)} />}
          <button type="button" className="compare-export-open" disabled={ready.length < 1} onClick={() => setExportOpen(true)}>Export video ↗</button>
        </div>
        <div className="compare-align" role="group" aria-label="Time alignment">
          <button type="button" aria-pressed={align === 'dates'} className={align === 'dates' ? 'is-active' : ''} onClick={() => setAlign('dates')} title="Put both projects on the same calendar">Same dates</button>
          <button type="button" aria-pressed={align === 'age'} className={align === 'age' ? 'is-active' : ''} onClick={() => setAlign('age')} title="Start each project at its own first commit">By age</button>
        </div>
        <button type="button" className="compare-exit" onClick={onClose}>Exit ×</button>
      </header>
      {error && <p className="compare-error" role="alert">{error}</p>}
      {exportOpen && (
        <div className="compare-export" role="dialog" aria-label="Export comparison video">
          <div className="compare-export-row">
            <label>Resolution<select value={settings.resolution} onChange={e => setSettings(s => ({ ...s, resolution: e.target.value }))}><option value="1080p">1080p</option><option value="720p">720p · faster</option></select></label>
            <label>Length<select value={settings.seconds} onChange={e => setSettings(s => ({ ...s, seconds: +e.target.value }))}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
            <label>Music<select value={settings.music} onChange={e => setSettings(s => ({ ...s, music: e.target.value }))}>
              {tracks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              <option value="none">No music</option>
            </select></label>
            {(!exporting || ['done', 'error', 'cancelled'].includes(exporting.status))
              ? <button type="button" className="compare-export-go" onClick={runExport}>Render {ready.length} projects →</button>
              : <button type="button" className="compare-export-go" onClick={() => exportCtl.current?.abort()}>Cancel</button>}
            <button type="button" className="compare-exit" onClick={() => setExportOpen(false)}>Close</button>
          </div>
          {exporting?.status === 'rendering' && <div className="compare-export-progress"><progress value={exporting.pct || 0} max="100" aria-label="Export progress" /><span>{exporting.stage === 'soundtrack' ? 'Composing the soundtrack…' : exporting.stage === 'encoding' ? 'Finishing your MP4…' : `Rendering · ${exporting.pct || 0}%`} · keep this tab open</span></div>}
          {exporting?.status === 'done' && <p className="compare-export-done"><a href={exporting.url} download={exporting.filename}>Download MP4 ↓ · {(exporting.bytes / 1048576).toFixed(1)} MB</a><span> rendered in your browser ({exporting.codecs})</span></p>}
          {exporting?.status === 'error' && <p className="compare-error" role="alert">{exporting.error}</p>}
          {exporting?.status === 'cancelled' && <p className="compare-export-done">Export cancelled.</p>}
        </div>
      )}
      <div className="compare-grid" data-count={panels.length}>
        {panels.map(panel => (
          <section key={panel.name} className="compare-panel">
            <div className="compare-panel-head">
              {repoLink(panel.data, privacy)
                ? <a className="compare-name" href={repoLink(panel.data, privacy)} target="_blank" rel="noopener noreferrer" title={`Open on ${repoHost(repoLink(panel.data, privacy))}`}>{panel.name} <span aria-hidden="true">↗</span></a>
                : <span className="compare-name">{privacy === 'off' ? panel.name : 'private repository'}</span>}
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
