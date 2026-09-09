import { useEffect, useRef, useState } from 'react'
import { BASE, trending, startLoad, pollStatus, cancelJob } from './api.js'
import { createGource } from './gource/renderer.js'
import { weeklyLeaders, WEEK } from './landing-data.js'
import './styles/landing.css'

const date = ts => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const viewer = name => `${BASE}viewer.html${name ? `?repo=${encodeURIComponent(name)}` : ''}`

function Preview({ repo, timestamp }) {
  const canvas = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('Loading repository history…')
  const [error, setError] = useState(false)
  useEffect(() => {
    let stopped = false, job, timer, engine, observer, busyRetries = 0
    setError(false); setStatus('Loading repository history…')
    async function load() {
      try {
        job = (await startLoad(repo.name, { maxCommits: 3000 })).job
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
            if (!data.commits?.length || data.stats.from > timestamp) {
              setStatus('No history available for this date in the loaded commits.'); return
            }
            const element = canvas.current
            const resize = () => {
              const box = element.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
              element.width = Math.max(1, Math.round(box.width * dpr))
              element.height = Math.max(1, Math.round(box.height * dpr))
              engine?.renderAt(Math.min(timestamp, data.stats.to), 1, 0)
            }
            resize()
            engine = createGource(element, data, { manual: true, clock: false })
            resize()
            observer = new ResizeObserver(resize); observer.observe(element.parentElement)
            setStatus('')
          } catch (e) { if (!stopped) { setError(true); setStatus(e.message) } }
        }
        await poll()
      } catch (e) {
        if (stopped) return
        if (e.status === 429 && busyRetries++ < 12) {
          setStatus('Waiting for a preview slot…'); timer = setTimeout(load, 10000); return
        }
        setError(true); setStatus(e.message)
      }
    }
    // Stagger jobs so the shared server does not receive four cold clones at once.
    timer = setTimeout(load, repo.rank * 1000)
    return () => { stopped = true; clearTimeout(timer); if (job) void cancelJob(job); observer?.disconnect(); engine?.destroy() }
  }, [repo.name, repo.rank, timestamp, attempt])
  return <article className="landing-card">
    <header><span className="landing-rank">0{repo.rank + 1}</span><a href={viewer(repo.name)}>{repo.name}</a><span className="landing-stars">+{repo.gained.toLocaleString()} ★</span></header>
    <div className="landing-canvas"><canvas ref={canvas} role="img" aria-label={`${repo.name} file tree on ${date(timestamp)}`} />
      {status && <div className="landing-status" role={error ? 'alert' : 'status'}><p>{status}</p>{error && <button onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}</div>}
    </div>
    <footer><div><span>{repo.language || 'Open source'}</span><p>{repo.description || 'Explore the people and commits behind this project.'}</p></div><a href={viewer(repo.name)} aria-label={`Explore ${repo.name}`}>Explore ↗</a></footer>
  </article>
}

export default function Landing() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [timestamp] = useState(() => Math.floor(Date.now() / 1000) - WEEK)
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
    <nav className="landing-nav" aria-label="Main navigation"><a className="landing-brand" href={BASE}>✳ Gource<span>View</span></a><a className="landing-cta" href={viewer()}>Open viewer ↗</a></nav>
    <section className="landing-hero"><span className="eyebrow">OPEN SOURCE, IN MOTION</span><h1>Every project<br />has a story.</h1><p>See the code, the people, and the moments that make a project grow. Explore GitHub history as a living file tree.</p><a className="landing-cta" href={viewer()}>Visualize a repository ↗</a></section>
    <section aria-labelledby="weekly-title"><div className="landing-section-head"><div><span className="eyebrow">THE WEEK IN OPEN SOURCE</span><h2 id="weekly-title">Four projects catching attention.</h2><p>Ranked by stars gained this week on GitHub Trending.</p></div><div className="landing-date">A look back · {date(timestamp)}<span>File trees from seven days ago</span></div></div>
      {error ? <div className="landing-feed-error" role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div> : <div className="landing-grid">{data ? data.repos.map((repo, rank) => <Preview key={repo.name} repo={{ ...repo, rank }} timestamp={timestamp} />) : Array.from({ length: 4 }, (_, i) => <div key={i} className="landing-skeleton" role="status">Finding this week’s projects…</div>)}</div>}
      <p className="landing-source">{data && <>Ranking refreshed {date(data.fetchedAt / 1000)} · </>}<a href="https://github.com/trending?since=weekly" target="_blank" rel="noreferrer">Source: GitHub Trending ↗</a> · Previews use up to 3,000 commits.</p>
    </section>
    <footer className="landing-footer"><span>GourceView · Code in motion.</span><a href={viewer()}>Explore your own project ↗</a></footer>
  </main>
}
