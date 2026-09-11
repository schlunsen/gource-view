import { useCallback, useEffect, useRef, useState } from 'react'
import { BASE, STATIC, trending, startLoad, pollStatus, cancelJob } from './api.js'
import { createGource } from './gource/renderer.js'
import { weeklyLeaders, WEEK } from './landing-data.js'
import { repoLink } from './repo-link.js'
import './styles/landing.css'

const date = ts => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const PLAYBACK_SECONDS = 30 // the whole week, on screen
const viewer = name => `${BASE}viewer.html${name ? `?repo=${encodeURIComponent(name)}` : ''}`

function Preview({ repo, timestamp, engines, onSettled }) {
  const canvas = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Loading repository history…')
  const [error, setError] = useState(false)
  useEffect(() => {
    const registry = engines.current
    let stopped = false, job, timer, engine, observer, busyRetries = 0
    setError(false); setStatus('Loading repository history…')
    async function load() {
      try {
        job = (await startLoad(repo.name, { maxCommits: 3000, prebuiltOnly: STATIC })).job
        if (stopped) { await cancelJob(job); return }
        const poll = async () => {
          try {
            const result = await pollStatus(job)
            if (stopped) return
            if (result.status === 'error' || result.ok === false) throw new Error(result.error || 'Could not load history.')
            if (result.status !== 'done') {
              setStatus(result.progress?.detail || 'Reading commits…')
              timer = setTimeout(poll, 800); return
            }
            const data = result.result
            if (!data.commits?.length) {
              setStatus('No commit history available.'); onSettled(repo.name); return
            }
            const element = canvas.current
            const resize = () => {
              const box = element.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
              element.width = Math.max(1, Math.round(box.width * dpr))
              element.height = Math.max(1, Math.round(box.height * dpr))
              if (engine) engine.renderAt(timestamp, 0, 0)
            }
            resize()
            engine = createGource(element, data, { manual: true, clock: false })
            resize()
            observer = new ResizeObserver(resize); observer.observe(element.parentElement)
            registry.set(repo.name, { engine, canvas: element, from: data.stats.from })
            onSettled(repo.name)
            setStatus('')
          } catch (e) { if (!stopped) { setError(true); setStatus(e.message); onSettled(repo.name) } }
        }
        await poll()
      } catch (e) {
        if (stopped) return
        if (e.status === 429 && busyRetries++ < 12) {
          setStatus('Waiting for a preview slot…'); timer = setTimeout(load, 10000); return
        }
        setError(true); setStatus(e.message); onSettled(repo.name)
      }
    }
    // Stagger jobs so the shared server does not receive four cold clones at once.
    timer = setTimeout(load, STATIC ? 0 : repo.rank * 1000)
    return () => { stopped = true; clearTimeout(timer); if (job) void cancelJob(job); observer?.disconnect(); registry.delete(repo.name); engine?.destroy() }
  }, [repo.name, repo.rank, timestamp, attempt, engines, onSettled])
  return <article className="landing-card">
    <header><span className="landing-rank">0{repo.rank + 1}</span><a href={viewer(repo.name)}>{repo.name}</a><span className="landing-stars">+{repo.gained.toLocaleString()} ★</span></header>
    <div className="landing-canvas"><canvas ref={canvas} role="img" aria-label={`${repo.name} animated file history over the last seven days`} />
      {status && <div className="landing-status" role={error ? 'alert' : 'status'}><p>{status}</p>{error && <button onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}</div>}
    </div>
    <footer><div><span>{repo.language || 'Open source'}</span><p>{repo.description || 'Explore the people and commits behind this project.'}</p></div><div className="landing-links"><a href={repoLink({ repo: repo.name, source: 'github' })} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repo.name} on GitHub`}>GitHub ↗</a><a href={viewer(repo.name)} aria-label={`Explore ${repo.name}`}>Explore ↗</a></div></footer>
  </article>
}

export default function Landing() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [timestamp] = useState(() => Math.floor(Date.now() / 1000) - WEEK)
  const engines = useRef(new Map()), settled = useRef(new Set())
  const [readyCount, setReadyCount] = useState(0)
  const [playing, setPlaying] = useState(true), [progress, setProgress] = useState(0)
  const clock = useRef({ progress: 0, seconds: 0 })
  const onSettled = useCallback(name => {
    settled.current.add(name); setReadyCount(settled.current.size)
  }, [])
  const ready = !!data && readyCount >= data.repos.length
  const seek = value => { clock.current.progress = value; clock.current.seconds = value * PLAYBACK_SECONDS; setProgress(value) }
  useEffect(() => {
    let raf, last = null, lastUpdate = 0
    const frame = now => {
      const dt = last === null ? 0 : Math.max(0, Math.min(.1, (now - last) / 1000))
      last = now
      if (playing && ready && !document.hidden) {
        clock.current.progress = Math.min(1, clock.current.progress + dt / PLAYBACK_SECONDS)
        clock.current.seconds += dt
        if (clock.current.progress === 1) setPlaying(false)
      }
      const time = timestamp + WEEK * clock.current.progress
      for (const { engine, canvas, from } of engines.current.values()) {
        // The renderer clamps to its first commit; hide it until that commit
        // enters our shared calendar instead of showing a future tree early.
        canvas.style.visibility = time < from ? 'hidden' : 'visible'
        engine.renderAt(time, 0, clock.current.seconds)
      }
      if (now - lastUpdate > 100) { setProgress(clock.current.progress); lastUpdate = now }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, ready, timestamp])
  useEffect(() => {
    let stopped = false
    setError('')
    trending().then(result => {
      const repos = weeklyLeaders(result)
      if (!repos.length) throw new Error('No weekly projects are available yet.')
      if (!stopped) setData({ repos, fetchedAt: result.fetchedAt })
    }).catch(e => { if (!stopped) setError(e.message) })
    return () => { stopped = true }
  }, [attempt])
  return <main className="landing">
    <nav className="landing-nav" aria-label="Main navigation"><a className="landing-brand" href={BASE}>✳ Gource<span>View</span></a><div className="landing-links"><a className="landing-nav-link" href={`${BASE}screensaver/`}>Screen saver</a><a className="landing-cta" href={viewer()}>Open viewer ↗</a></div></nav>
    <section className="landing-hero"><span className="eyebrow">OPEN SOURCE, IN MOTION</span><h1>Every project<br />has a story.</h1><p>See the code, the people, and the moments that make a project grow. Explore GitHub history as a living file tree.</p><a className="landing-cta" href={viewer()}>Visualize a repository ↗</a></section>
    <section aria-labelledby="weekly-title"><div className="landing-section-head"><div><span className="eyebrow">THE WEEK IN OPEN SOURCE</span><h2 id="weekly-title">Four projects catching attention.</h2><p>Ranked by stars gained this week on GitHub Trending.</p></div><div className="landing-date">Last seven days<span>{date(timestamp)} — {date(timestamp + WEEK)}</span></div></div>
      {error ? <div className="landing-feed-error" role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div> : <div className="landing-grid">{data ? data.repos.map((repo, rank) => <Preview key={repo.name} repo={{ ...repo, rank }} timestamp={timestamp} engines={engines} onSettled={onSettled} />) : Array.from({ length: 4 }, (_, i) => <div key={i} className="landing-skeleton" role="status">Finding this week’s projects…</div>)}</div>}
      {data && <div className="landing-playback" role="group" aria-label="Weekly playback">
        <button disabled={!ready} onClick={() => { if (progress >= 1) seek(0); setPlaying(p => progress >= 1 || !p) }}>{playing ? 'Pause' : progress >= 1 ? 'Replay' : 'Play'}</button>
        <button disabled={!ready} onClick={() => { seek(0); setPlaying(true) }}>Replay week</button>
        <input type="range" aria-label="Weekly timeline" min="0" max="1" step="0.0001" value={progress} onChange={e => seek(Number(e.target.value))} />
        <time dateTime={new Date((timestamp + WEEK * progress) * 1000).toISOString()}>{date(timestamp + WEEK * progress)}</time>
        <span>{ready ? `7 days in ${PLAYBACK_SECONDS} seconds` : 'Preparing previews…'}</span>
      </div>}
      <p className="landing-source">{data && <>Ranking refreshed {date(data.fetchedAt / 1000)} · </>}<a href="https://github.com/trending?since=weekly" target="_blank" rel="noreferrer">Source: GitHub Trending ↗</a> · Previews use up to 3,000 commits.</p>
    </section>
    <footer className="landing-footer"><span>GourceView · Code in motion.</span><div className="landing-links"><a href={`${BASE}screensaver/`}>Mac screen saver</a><a href={viewer()}>Explore your own project ↗</a></div></footer>
  </main>
}
