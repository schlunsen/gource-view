import { useEffect, useRef, useState } from 'react'
import { BASE, STATIC, trending, startLoad, pollStatus, cancelJob } from './api.js'
import { createGource } from './gource/renderer.js'
import { PALETTES } from './gource/palette.js'
import { todaysLeaders } from './landing-data.js'
import { repoLink } from './repo-link.js'
import './styles/landing.css'

const date = ts => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const PLAYBACK_SECONDS = 40 // a whole project history, on screen
const viewer = name => `${BASE}viewer.html${name ? `?repo=${encodeURIComponent(name)}` : ''}`
const num = n => Number.isFinite(n) ? n.toLocaleString() : '—'


// The legend reads its swatches from the renderer's own palette, so the key on
// the page cannot drift from the colours actually being drawn above it.
const rgb = c => `rgb(${c[0]} ${c[1]} ${c[2]})`
const FILE_KEY = [
  { colour: PALETTES.dark.code, name: 'Source', note: 'code, in whatever language the project is written' },
  { colour: PALETTES.dark.data, name: 'Text & data', note: 'Markdown, JSON, YAML, XML, CSV, SQL' },
  { colour: PALETTES.dark.image, name: 'Images & binaries', note: 'PNG, SVG, PDF and anything else not text' },
  { colour: PALETTES.dark.dir, name: 'Folders', note: 'the branches everything else hangs from' },
]

const GLYPH = {
  tree: <g fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M28 28 12 14M28 28 44 15M28 28 18 44M28 28 45 40" /><circle cx="28" cy="28" r="4.5" fill="currentColor" stroke="none" /><circle cx="12" cy="14" r="3" /><circle cx="44" cy="15" r="3" /><circle cx="18" cy="44" r="3" /><circle cx="45" cy="40" r="3" /></g>,
  people: <g fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="17" cy="28" r="8" /><path d="M25 25.5 42 19M25 29 43 30M25 32.5 41 41" strokeDasharray="2 3" /><circle cx="44" cy="18" r="2.6" fill="currentColor" stroke="none" /><circle cx="45" cy="30" r="2.6" fill="currentColor" stroke="none" /><circle cx="43" cy="42" r="2.6" fill="currentColor" stroke="none" /></g>,
  glow: <g fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="28" cy="28" r="4.5" fill="currentColor" stroke="none" /><circle cx="28" cy="28" r="11" opacity=".62" /><circle cx="28" cy="28" r="18" opacity=".3" /></g>,
  card: <g fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="8" y="18" width="40" height="20" rx="4" /><circle cx="18" cy="28" r="4" /><path d="M26 25h16M26 31h10" /></g>,
}

const MOTION = [
  { glyph: 'tree', title: 'The tree is the repository', body: 'Every leaf is a file and every branch a folder, drawn at the moment it first appears in the history. Watch the shape spread and you are watching the codebase get its structure.' },
  { glyph: 'people', title: 'The circles are people', body: 'Each contributor is a figure in their own colour. They fly to the folder they are committing in, beam once at every file that commit touched, and drift away after a few quiet seconds.' },
  { glyph: 'glow', title: 'The glow is what is hot', body: 'A file that has just changed lights up, and the light runs back along its folder path to the centre — so the brightest limb of the tree is the part of the project being worked on that week.' },
  { glyph: 'card', title: 'The cards mark milestones', body: 'A card announces someone’s first commit to the project, and their 10th, 25th, 100th after that. The panel in the corner is the date you are watching and how far into the history it is.' },
]

function Legend() {
  return <section className="landing-legend" aria-labelledby="legend-title">
    <div className="landing-wrap">
      <div className="landing-legend-head">
        <span className="eyebrow">READING THE PICTURE</span>
        <h2 id="legend-title">What the animation is actually showing.</h2>
        <p>Each frame is the repository exactly as it stood on that date, rebuilt from its Git history. Nothing is decorative: the tree is the file system, the lights are the people working in it, and the clock never moves backwards.</p>
      </div>
      <div className="landing-legend-grid">
        {MOTION.map(item => <article key={item.glyph}>
          <svg viewBox="0 0 56 56" width="42" height="42" aria-hidden="true">{GLYPH[item.glyph]}</svg>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>)}
      </div>
      <dl className="landing-key">
        <dt>Colour is the kind of file</dt>
        {FILE_KEY.map(file => <dd key={file.name}><i style={{ background: rgb(file.colour), boxShadow: `0 0 12px ${rgb(file.colour)}` }} /><b>{file.name}</b><span>{file.note}</span></dd>)}
      </dl>
    </div>
  </section>
}

/** One repository's processed history, reloaded whenever the subject changes. */
function useHistory(repo, attempt) {
  const [state, setState] = useState({ status: 'Loading repository history…' })
  useEffect(() => {
    let stopped = false, job, timer, busyRetries = 0
    setState({ status: 'Loading repository history…' })
    async function load() {
      try {
        job = (await startLoad(repo, { maxCommits: 3000, prebuiltOnly: STATIC })).job
        if (stopped) { await cancelJob(job); return }
        const poll = async () => {
          try {
            const result = await pollStatus(job)
            if (stopped) return
            if (result.status === 'error' || result.ok === false) throw new Error(result.error || 'Could not load history.')
            if (result.status !== 'done') {
              setState({ status: result.progress?.detail || 'Reading commits…' })
              timer = setTimeout(poll, 800); return
            }
            if (!result.result.commits?.length) { setState({ status: 'No commit history available.', error: true }); return }
            setState({ data: result.result })
          } catch (e) { if (!stopped) setState({ status: e.message, error: true }) }
        }
        await poll()
      } catch (e) {
        if (stopped) return
        if (e.status === 429 && busyRetries++ < 12) {
          setState({ status: 'Waiting for a preview slot…' }); timer = setTimeout(load, 10000); return
        }
        setState({ status: e.message, error: true })
      }
    }
    void load()
    return () => { stopped = true; clearTimeout(timer); if (job) void cancelJob(job) }
  }, [repo, attempt])
  return state
}

/** The masthead is the visualization: the hero copy and its call to action sit on
 *  the running history, under a nav bar the renderer's own HUD cannot collide with. */
function Header({ children, repos = [], current, label = '', onPick }) {
  return <header className="landing-header">
    <nav className="landing-nav landing-wrap" aria-label="Main navigation"><a className="landing-brand" href={BASE}>✳ Gource<span>View</span></a><div className="landing-links"><a className="landing-nav-link" href={`${BASE}screensaver/`}>Screen saver</a><a className="landing-cta" href={viewer()}>Open viewer ↗</a></div></nav>
    {repos.length > 1 && <div className="landing-switch landing-wrap" role="group" aria-label="Choose the project on show">
      <span className="eyebrow">TRENDING {label.toUpperCase()}</span>
      <div>{repos.map(repo => <button key={repo.name} aria-pressed={repo.name === current} onClick={() => onPick(repo.name)}>{repo.name}<span>+{num(repo.gained)} ★</span></button>)}</div>
    </div>}
    <div className="landing-stage">
      <div className="landing-hero landing-wrap"><span className="eyebrow">OPEN SOURCE, IN MOTION</span><h1>Every project<br />has a story.</h1><p>See the code, the people, and the moments that make a project grow. Today’s most-starred repository on GitHub, playing out from its first commit.</p><a className="landing-cta landing-hero-cta" href={viewer()}>Visualize a repository ↗</a></div>
      {children}
    </div>
  </header>
}

/** The full-width stage: one project's whole history, played out in PLAYBACK_SECONDS. */
function Stage({ repo, label, repos, onPick }) {
  const canvas = useRef(null), engine = useRef(null), clock = useRef({ progress: 0, seconds: 0 })
  const [attempt, setAttempt] = useState(0)
  const { data, status, error } = useHistory(repo.name, attempt)
  const [playing, setPlaying] = useState(true), [progress, setProgress] = useState(0)
  const from = data?.stats?.from, to = data?.stats?.to
  const span = Number.isFinite(from) && to > from
  const seek = value => { clock.current.progress = value; clock.current.seconds = value * PLAYBACK_SECONDS; setProgress(value) }

  useEffect(() => {
    if (!data) return
    const element = canvas.current
    const resize = () => {
      const box = element.parentElement.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
      element.width = Math.max(1, Math.round(box.width * dpr))
      element.height = Math.max(1, Math.round(box.height * dpr))
      engine.current?.renderAt(data.stats.from, 0, 0)
    }
    resize()
    engine.current = createGource(element, data, { manual: true, clock: false, interactive: false })
    resize()
    const observer = new ResizeObserver(resize); observer.observe(element.parentElement)
    clock.current = { progress: 0, seconds: 0 }
    setProgress(0); setPlaying(true)
    return () => { observer.disconnect(); const e = engine.current; engine.current = null; e?.destroy() }
  }, [data])

  useEffect(() => {
    if (!span) return
    let raf, last = null, lastUpdate = 0
    const frame = now => {
      const dt = last === null ? 0 : Math.max(0, Math.min(.1, (now - last) / 1000))
      last = now
      if (playing && !document.hidden) {
        clock.current.progress = Math.min(1, clock.current.progress + dt / PLAYBACK_SECONDS)
        clock.current.seconds += dt
        if (clock.current.progress === 1) setPlaying(false)
      }
      engine.current?.renderAt(from + (to - from) * clock.current.progress, 0, clock.current.seconds)
      if (now - lastUpdate > 100) { setProgress(clock.current.progress); lastUpdate = now }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, span, from, to])

  const now = span ? from + (to - from) * progress : null
  return <>
    <Header repos={repos} current={repo.name} label={label} onPick={onPick}>
      <canvas ref={canvas} role="img" aria-label={`${repo.name} file history, animated from its first commit to today`} />
      <div className="landing-stage-title landing-wrap">
        <span className="eyebrow">MOST STARRED {label.toUpperCase()}</span>
        <h2 id="showcase-title"><a href={viewer(repo.name)}>{repo.name}</a></h2>
        <p><span className="landing-stars">+{num(repo.gained)} ★</span> {label} · {num(repo.stars)} total</p>
        {status && <p className="landing-status" role={error ? 'alert' : 'status'}>{status}{error && <button onClick={() => setAttempt(n => n + 1)}>Retry preview</button>}</p>}
      </div>
    </Header>
    <div className="landing-playback">
      <div className="landing-wrap landing-playback-inner" role="group" aria-label="Project playback">
        <button disabled={!span} onClick={() => { if (progress >= 1) seek(0); setPlaying(p => progress >= 1 || !p) }}>{playing ? 'Pause' : progress >= 1 ? 'Replay' : 'Play'}</button>
        <button disabled={!span} onClick={() => { seek(0); setPlaying(true) }}>Replay history</button>
        <input type="range" aria-label="Project timeline" min="0" max="1" step="0.0001" value={progress} onChange={e => seek(Number(e.target.value))} />
        {now ? <time dateTime={new Date(now * 1000).toISOString()}>{date(now)}</time> : <time>—</time>}
        <span>{span ? `${date(from)} → ${date(to)} in ${PLAYBACK_SECONDS}s` : 'Preparing the preview…'}</span>
      </div>
    </div>
    <div className="landing-wrap landing-about">
      <div className="landing-about-text">
        <span className="landing-language">{repo.language || 'Open source'}</span>
        <p>{repo.description || data?.description || 'Explore the people and commits behind this project.'}</p>
        <div className="landing-links">
          <a href={viewer(repo.name)}>Explore in the viewer ↗</a>
          <a href={repoLink({ repo: repo.name, source: 'github' })} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repo.name} on GitHub`}>GitHub ↗</a>
        </div>
      </div>
      <dl className="landing-stats">
        <div><dt>Commits</dt><dd>{num(data?.stats?.commits)}</dd></div>
        <div><dt>People</dt><dd>{num(data?.stats?.authors)}</dd></div>
        <div><dt>Lines</dt><dd>{num(data?.stats?.loc)}</dd></div>
        <div><dt>First commit</dt><dd>{span ? date(from) : '—'}</dd></div>
      </dl>
    </div>
  </>
}

export default function Landing() {
  const [feed, setFeed] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const [pick, setPick] = useState(0)
  useEffect(() => {
    let stopped = false
    setError('')
    trending().then(result => {
      const leaders = todaysLeaders(result)
      if (!stopped) { setFeed({ ...leaders, fetchedAt: result.fetchedAt }); setPick(0) }
    }).catch(e => { if (!stopped) setError(e.message) })
    return () => { stopped = true }
  }, [attempt])
  const repo = feed?.repos[Math.min(pick, feed.repos.length - 1)]
  return <main className="landing">
    {repo ? <Stage key={repo.name} repo={repo} label={feed.label} repos={feed.repos} onPick={name => setPick(feed.repos.findIndex(r => r.name === name))} />
      : <Header><div className="landing-stage-title landing-wrap">
        {error
          ? <p className="landing-status" role="alert">{error}<button onClick={() => setAttempt(n => n + 1)}>Try again</button></p>
          : <p className="landing-status" role="status">Finding the project of the day…</p>}
      </div></Header>}
    <p className="landing-source landing-wrap">{feed && <>Ranking refreshed {date(feed.fetchedAt / 1000)} · </>}<a href={`https://github.com/trending?since=${feed?.period || 'daily'}`} target="_blank" rel="noreferrer">Source: GitHub Trending ↗</a> · Previews use up to 3,000 commits.</p>
    <Legend />
    <footer className="landing-footer landing-wrap"><span>GourceView · Code in motion.</span><div className="landing-links"><a href={`${BASE}screensaver/`}>Mac screen saver</a><a href={viewer()}>Explore your own project ↗</a></div></footer>
  </main>
}
