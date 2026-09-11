import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExportVideo from './ExportVideo.jsx'
import GiteaPicker from './GiteaPicker.jsx'
import TrendingPanel from './TrendingPanel.jsx'
import RepoDiscovery from './RepoDiscovery.jsx'
import VideoMode from './VideoMode.jsx'
import { BASE, STATIC, REPO_URL, getConfig, startLoad, pollStatus, cancelJob, musicTracks, giteaRepos as fetchGiteaRepos, DEFAULT_COMMITS } from './api.js'
import { PRIVACY_LABELS, buildPseudonyms, nextPrivacy, normalizePrivacy } from './gource/privacy.js'
import { clearHistories } from './browser-git/cache.js'
import GithubToken from './GithubToken.jsx'
import RepoSearch from './RepoSearch.jsx'
import CompareView from './CompareView.jsx'
import { createGource } from './gource/renderer.js'
import { repoLink, repoHost } from './repo-link.js'
import { gitCityUrl, ownerOf, githubRepoOf, resolveAuthorLogins } from './git-city.js'
import { COMPACT_QUERY, useMediaQuery } from './use-media-query.js'

const DEFAULT_REPO = 'expressjs/express'

// Fast clones (≤ 30 MB) with real teams and clear folder trees — each loads in a few seconds.
const DEFAULT_SUGGESTIONS = [
  { label: 'pallets/flask', note: 'Python', description: 'A compact web framework with a clear package and test tree.' },
  { label: 'gin-gonic/gin', note: 'Go', description: 'Follow a web framework growing through community contributions.' },
  { label: 'tokio-rs/tokio', note: 'Rust', description: 'Explore the runtime behind asynchronous Rust applications.' },
  { label: 'fastify/fastify', note: 'Node', description: 'Routes, plugins and tests evolving together.' },
  { label: 'axios/axios', note: 'JS', description: 'The HTTP client connecting applications to the web.' },
]

const SPEEDS = [0.5, 1, 2, 4]
const PARAMS = new URLSearchParams(window.location.search)

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toISOString().slice(0, 10)
}
function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

export default function App() {
  const [repoInput, setRepoInput] = useState(PARAMS.get('repo') || DEFAULT_REPO)
  const [config, setConfig] = useState(null)
  const SUGGESTIONS = config?.demos ? config.demos.map(d => ({ label: d.name, note: d.note })) : DEFAULT_SUGGESTIONS
  const [giteaRepos, setGiteaRepos] = useState([])
  const [repo, setRepo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const lastLoad = useRef(null)
  const [loadSeconds, setLoadSeconds] = useState(0)
  const [error, setError] = useState(null)
  const [maxCommits, setMaxCommits] = useState(PARAMS.has('max') && (STATIC ? [300, 1000, 1500, 3000] : [0, 300, 1000, 1500, 3000]).includes(+PARAMS.get('max')) ? +PARAMS.get('max') : DEFAULT_COMMITS)
  const refRef = useRef(PARAMS.get('ref') || '') // branch override; '' = the repository default
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeedState] = useState(SPEEDS.includes(+PARAMS.get('speed')) ? +PARAMS.get('speed') : 1)
  const [curTs, setCurTs] = useState(0)
  const [showStats, setShowStats] = useState(true)

  const speedRef = useRef(SPEEDS.includes(+PARAMS.get('speed')) ? +PARAMS.get('speed') : 1)
  speedRef.current = speed
  const canvasRef = useRef(null)
  const gourceRef = useRef(null)
  const pollRef = useRef(null)
  const activeJob = useRef(null)
  const loadId = useRef(0)
  const [flyover, setFlyover] = useState(PARAMS.get('flyover') !== '0')
  const flyoverRef = useRef(PARAMS.get('flyover') !== '0')
  const [pace, setPace] = useState(PARAMS.get('pace') !== '0')
  const [privacy, setPrivacyState] = useState(normalizePrivacy(PARAMS.get('privacy')))
  const [clock, setClockState] = useState(PARAMS.get('clock') !== '0')
  const [clockHidden, setClockHidden] = useState(false) // on, but faded out at high speed
  const clockRef = useRef(PARAMS.get('clock') !== '0')
  const privacyRef = useRef(normalizePrivacy(PARAMS.get('privacy')))
  const paceRef = useRef(PARAMS.get('pace') !== '0')
  const pendingSeek = useRef(PARAMS.get('t') ? +PARAMS.get('t') : null)
  const autoCompare = useRef((PARAMS.get('vs') || '') !== '')
  const autoVideo = useRef(PARAMS.get('video') === '1') // a video link opens fullscreen playback once the history is in
  const [showHelp, setShowHelp] = useState(false)
  const [videoMode, setVideoMode] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const compareInitial = useRef((PARAMS.get('vs') || '').split(',').map(s => s.trim()).filter(Boolean))
  const [tracks, setTracks] = useState([])
  useEffect(() => { musicTracks().then(setTracks).catch(() => {}) }, [])
  const openVideo = useCallback(() => { if (!repo) return; gourceRef.current?.pause(); setVideoMode(true) }, [repo])
  const closeVideo = useCallback(() => setVideoMode(false), [])
  const [toast, setToast] = useState(null)
  // Compact (phone) layout: the canvas is the hero; everything else lives in a bottom sheet.
  const compact = useMediaQuery(COMPACT_QUERY)
  const [sheet, setSheet] = useState(null) // null | 'repo' | 'view' | 'explore'
  const sheetRef = useRef(null), moreRef = useRef(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])
  const lastPlaying = useRef(false)
  const actions = useRef({})

  const stop = useCallback(() => {
    if (activeJob.current) { void cancelJob(activeJob.current); activeJob.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const cancelLoad = useCallback(() => {
    ++loadId.current; stop(); setLoading(false); setProgress(null); setError(null)
  }, [stop])
  useEffect(() => {
    if (!loading) return
    setLoadSeconds(0)
    const timer = setInterval(() => setLoadSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  const load = useCallback(async (name, branch = '', settings = {}) => {
    const limit = settings.maxCommits ?? maxCommits
    const id = ++loadId.current
    stop()
    lastLoad.current = { name, branch, settings }
    gourceRef.current?.pause()
    setError(null); setLoading(true); setLoadSeconds(0)
    const fail = message => { stop(); setLoading(false); setProgress(null); setError(message) }
    setProgress({ pct: 0, detail: STATIC ? 'Opening repository history…' : 'Contacting server…' })
    try {
      const { job } = await startLoad(name, { ...settings, maxCommits: limit, ...(branch ? { ref: branch } : {}) })
      if (id !== loadId.current) { void cancelJob(job); return }
      activeJob.current = job
      let polling = false
      let finished = false, failures = 0
      const started = Date.now()
      pollRef.current = setInterval(async () => {
        if (polling || finished || id !== loadId.current) return
        polling = true
        try {
          if (Date.now() - started > 10 * 60 * 1000) { finished = true; fail('This load is taking too long. Try a smaller commit limit.'); return }
          const s = await pollStatus(job)
          if (id !== loadId.current) return
          failures = 0
          if (!s.ok) { finished = true; stop(); setLoading(false); setError(s.error || 'The server lost this load. Try again.'); return }
          if (s.status === 'done') {
            finished = true
            stop(); setLoading(false); setProgress(null)
            const data = { ...s.result, jobKey: job, loadLimit: s.result.maxCommits ?? limit }
            let g
            try {
              gourceRef.current?.destroy(); gourceRef.current = null
              g = createGource(canvasRef.current, data)
            } catch (e) { setRepo(null); fail(`Could not display this history: ${e.message}`); return }
            setRepo(data)
            refRef.current = data.ref && data.ref !== data.defaultRef ? data.ref : ''
            window.__gource = g // test/debug hook
            g.setFlyover(flyoverRef.current)
            g.setAutoPace(paceRef.current)
            g.setPrivacy(privacyRef.current)
            g.setClock(clockRef.current)
            gourceRef.current = g
            g.onTick = (t, p) => {
              setCurTs(t); setPlaying(p); setClockHidden(g.clockHidden)
              if (lastPlaying.current && !p) actions.current.syncUrl?.(t) // paused: freeze the moment in the URL
              lastPlaying.current = p
            }
            g.setSpeed(speedRef.current)
            if (pendingSeek.current != null) {
              // a shared link opens exactly at its moment, paused
              g.seek(pendingSeek.current); pendingSeek.current = null
              g.pause(); setCurTs(g.time); setPlaying(false)
            } else g.play()
            if (autoVideo.current) { autoVideo.current = false; g.pause(); setPlaying(false); setVideoMode(true) }
            if (autoCompare.current) { autoCompare.current = false; g.pause(); setPlaying(false); setCompareOpen(true) }
          } else if (s.status === 'error') {
            finished = true
            stop(); setLoading(false); setError(s.error)
          } else {
            setProgress(s.progress)
          }
        } catch {
          if (id !== loadId.current) return
          failures++
          if (failures >= 5) { finished = true; fail('Connection interrupted. Check your connection and try again.') }
          else setProgress(p => ({ ...p, detail: `Reconnecting… attempt ${failures} of 5` }))
        }
        finally { polling = false }
      }, 600)
    } catch (e) {
      if (id !== loadId.current) return
      stop(); setLoading(false); setError(e.message)
    }
  }, [maxCommits, stop])

  useEffect(() => () => { ++loadId.current; stop(); if (gourceRef.current) gourceRef.current.destroy() }, [stop])

  // size the canvas to fill its parent
  useEffect(() => {
    const c = document.getElementById('gource-canvas')
    if (!c) return
    function resize() {
      const p = c.parentElement
      if (!p) return
      const r = p.getBoundingClientRect()
      const w = Math.floor(r.width), h = Math.floor(r.height)
      if (w < 50 || h < 50) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = w * dpr
      c.height = h * dpr
      c.style.width = w + 'px'
      c.style.height = h + 'px'
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (c.parentElement) ro.observe(c.parentElement)
    window.addEventListener('resize', resize)
    return () => { ro.disconnect(); window.removeEventListener('resize', resize) }
  }, [])

  // read server config (default repo, optional Gitea source), then auto-load
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let cfg = null
      try { cfg = await getConfig() } catch { /* fall back to the built-in default */ }
      if (cancelled) return
      setConfig(cfg)
      const initial = PARAMS.get('repo') || cfg?.defaultRepo || DEFAULT_REPO // a shared link wins over the server default
      setRepoInput(initial)
      load(initial, refRef.current)
      if (!cfg?.gitea) return
      try {
        const d = await fetchGiteaRepos()
        if (!cancelled) setGiteaRepos(d.repos || [])
      } catch { /* the picker simply stays empty */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const span = repo ? Math.max(1, repo.stats.to - repo.stats.from) : 1

  const activity = useMemo(() => {
    const bins = Array(72).fill(0)
    if (repo) for (const c of repo.commits) bins[Math.min(71, Math.floor((c.ts - repo.stats.from) / Math.max(1, repo.stats.to - repo.stats.from) * 72))]++
    const peak = Math.max(1, ...bins)
    return bins.map(n => n / peak)
  }, [repo])
  const pseudonyms = useMemo(() => buildPseudonyms(repo?.commits || []), [repo])
  // Git City: the owner and the top authors link to their GitHub profile cities.
  // Logins resolve lazily, only for GitHub repositories and only with privacy off.
  const [authorLogins, setAuthorLogins] = useState(() => new Map())
  useEffect(() => {
    setAuthorLogins(new Map())
    const gh = githubRepoOf(repo)
    if (!gh || privacy !== 'off') return
    const top = repo.stats.topAuthors.slice(0, 6).map(([name]) => ({ name, email: repo.commits.find(c => c.name === name && c.email)?.email || '' }))
    const ctrl = new AbortController()
    resolveAuthorLogins(gh, top, { signal: ctrl.signal }).then(m => { if (!ctrl.signal.aborted) setAuthorLogins(m) })
    return () => ctrl.abort()
  }, [repo, privacy])
  const cityOwner = privacy === 'off' ? ownerOf(repo) : ''
  const played = repo ? Math.max(0, Math.min(100, (curTs - repo.stats.from) / span * 100)) : 0

  // bursts: activity bins well above the typical bin, merged into runs
  const bursts = useMemo(() => {
    if (!repo) return { starts: [], bins: new Set() }
    const N = 72, counts = Array(N).fill(0)
    for (const c of repo.commits) counts[Math.min(N - 1, Math.floor((c.ts - repo.stats.from) / span * N))]++
    const nonZero = counts.filter(Boolean).sort((a, b) => a - b)
    const median = nonZero.length ? nonZero[Math.floor(nonZero.length / 2)] : 0
    const threshold = Math.max(2, median * 2)
    const bins = new Set(), starts = []
    counts.forEach((n, i) => { if (n >= threshold) { bins.add(i); if (!bins.has(i - 1)) starts.push(repo.stats.from + i * span / N) } })
    return { starts, bins }
  }, [repo, span])

  const buildLink = useCallback((t, video = false) => {
    const q = new URLSearchParams()
    if (repo) q.set('repo', repo.repo)
    q.set('max', String(repo?.loadLimit ?? maxCommits))
    if (refRef.current) q.set('ref', refRef.current)
    if (repo && t != null) q.set('t', String(Math.round(t)))
    if (speedRef.current !== 1) q.set('speed', String(speedRef.current))
    if (!flyoverRef.current) q.set('flyover', '0')
    if (!paceRef.current) q.set('pace', '0')
    if (privacyRef.current !== 'off') q.set('privacy', privacyRef.current)
    if (!clockRef.current) q.set('clock', '0')
    if (video) q.set('video', '1')
    return `${window.location.pathname}?${q}`
  }, [repo, maxCommits])
  const syncUrl = useCallback((t) => { try { window.history.replaceState(null, '', buildLink(t)) } catch { /* sandboxed */ } }, [buildLink])
  useEffect(() => { if (repo && gourceRef.current) syncUrl(gourceRef.current.time) }, [repo, syncUrl])
  const seekTo = useCallback((t) => {
    const g = gourceRef.current; if (!g || !repo) return
    const clamped = Math.max(repo.stats.from, Math.min(repo.stats.to, t))
    g.seek(clamped); setCurTs(clamped); syncUrl(clamped)
  }, [repo, syncUrl])
  const jumpBurst = useCallback((dir) => {
    const g = gourceRef.current; if (!g || !repo) return
    const t = g.time, margin = span * 0.005
    const target = dir > 0 ? bursts.starts.find(b => b > t + margin) : [...bursts.starts].reverse().find(b => b < t - margin)
    if (target != null) seekTo(target)
  }, [repo, span, bursts, seekTo])
  const applySpeed = useCallback((s) => { setSpeedState(s); speedRef.current = s; gourceRef.current?.setSpeed(s) }, [])
  const toggleFlyover = useCallback(() => { const v = !flyoverRef.current; flyoverRef.current = v; setFlyover(v); gourceRef.current?.setFlyover(v) }, [])
  const cyclePrivacy = useCallback(() => { const v = nextPrivacy(privacyRef.current); privacyRef.current = v; setPrivacyState(v); gourceRef.current?.setPrivacy(v); actions.current.syncUrl?.(gourceRef.current?.time) }, [])
  const toggleClock = useCallback(() => { const v = !clockRef.current; clockRef.current = v; setClockState(v); gourceRef.current?.setClock(v); actions.current.syncUrl?.(gourceRef.current?.time) }, [])
  const togglePace = useCallback(() => { const v = !paceRef.current; paceRef.current = v; setPace(v); gourceRef.current?.setAutoPace(v) }, [])
  const share = useCallback(async () => {
    const url = new URL(buildLink(gourceRef.current?.time), window.location.href).toString()
    try { await navigator.clipboard.writeText(url); setToast('Link copied') } catch { setToast(url) }
  }, [buildLink])
  // A video link opens straight into fullscreen playback of this repository.
  const videoLink = useCallback(() => new URL(buildLink(null, true), window.location.href).toString(), [buildLink])
  const repoRef = useRef(repo)
  repoRef.current = repo
  const sourceUrl = repoLink(repo, privacy), sourceHost = repoHost(sourceUrl)
  const openSource = useCallback(() => { const url = repoLink(repoRef.current, privacyRef.current); if (url) window.open(url, '_blank', 'noopener,noreferrer') }, [])
  actions.current = { syncUrl, seekTo, jumpBurst, applySpeed, toggleFlyover, togglePace, share, cyclePrivacy, openVideo, toggleClock, openSource }

  // keyboard shortcuts (ignored while typing or with a dialog open)
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable || document.querySelector('dialog[open]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('.video-mode')) return
      const a = actions.current, g = gourceRef.current
      if (e.key === '?') { setShowHelp(v => !v); return }
      if (e.key === 'Escape') { setShowHelp(false); setSheet(null); return }
      if (!g) return
      switch (e.key) {
        case ' ': e.preventDefault(); g.toggle(); break
        case 'ArrowLeft': case 'ArrowRight': {
          e.preventDefault()
          const d = (e.shiftKey ? 0.1 : 0.02) * (g.to - g.from) * (e.key === 'ArrowLeft' ? -1 : 1)
          a.seekTo(g.time + d); break
        }
        case 'Home': a.seekTo(g.from); break
        case 'End': a.seekTo(g.to); break
        case '[': case ']': { const i = SPEEDS.indexOf(speedRef.current); a.applySpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + (e.key === ']' ? 1 : -1)))]); break }
        case 'n': a.jumpBurst(1); break
        case 'p': a.jumpBurst(-1); break
        case 'f': a.toggleFlyover(); break
        case 'a': a.togglePace(); break
        case 'h': a.cyclePrivacy(); break
        case 'v': a.openVideo(); break
        case 'k': a.toggleClock(); break
        case 'r': g.resetView(); break
        case 's': setShowStats(v => !v); break
        case 'c': a.share(); break
        case 'g': a.openSource(); break
        default: return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Compact layout: frame the tree tighter and keep it above the open sheet.
  useEffect(() => {
    const g = gourceRef.current
    if (!g?.setInsets) return
    if (!compact) { g.setInsets(null); return }
    const apply = () => {
      const stage = canvasRef.current?.getBoundingClientRect()
      const panel = sheetRef.current?.getBoundingClientRect()
      g.setInsets({ pad: 28, bottom: stage && panel ? Math.max(0, stage.bottom - panel.top) : 0 })
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [compact, sheet, repo, loading])
  // The sheet takes focus when it opens and hands it back to the ⋯ button when it closes.
  const sheetWasOpen = useRef(false)
  useEffect(() => {
    if (sheet && !sheetWasOpen.current) sheetRef.current?.focus()
    if (!sheet && sheetWasOpen.current) moreRef.current?.focus()
    sheetWasOpen.current = !!sheet
  }, [sheet])
  useEffect(() => { if (!compact) setSheet(null) }, [compact])

  // Shared pieces: the desktop layout places them in the header / overlays / transport,
  // the compact layout gathers them in one bottom sheet.
  const headerTools = (
    <>
        {sourceUrl && !loading && (
          <a className="repo-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open ${repo.repo} on ${sourceHost} (g)`} aria-label={`Open ${repo.repo} on ${sourceHost}`}>
            <span className="repo-source-host">{sourceHost}</span><span className="repo-source-name">{repo.repo}</span><span aria-hidden="true">↗</span>
          </a>
        )}

        {config?.gitea && (
          <GiteaPicker label={config.gitea.label} repos={giteaRepos} onPick={name => { setSheet(null); setRepoInput(`gitea:${name}`); load(`gitea:${name}`) }} />
        )}

        <select
          value={maxCommits}
          onChange={(e) => setMaxCommits(+e.target.value)}
          aria-label="Max commits to load"
          title="Max commits to load"
          className="rounded-lg bg-ink border border-line font-mono text-[11px] text-ink-300 px-2 transition-colors duration-150"
          style={{ height: 40 }}
        >
          <option value={300}>300 commits</option>
          <option value={1000}>1 000 commits</option>
          <option value={1500}>1 500 commits</option>
          <option value={3000}>3 000 commits</option>
          {!STATIC && <option value={0}>All (slow)</option>}
        </select>

        {repo?.refs?.length > 1 && (
          <select
            value={repo.ref}
            onChange={(e) => { const b = e.target.value; refRef.current = b === repo.defaultRef ? '' : b; load(repo.repo, b); setSheet(null) }}
            aria-label="Branch"
            title="Branch to visualize"
            className="rounded-lg bg-ink border border-line font-mono text-[11px] text-ink-300 px-2 max-w-[160px] transition-colors duration-150"
            style={{ height: 40 }}
          >
            {repo.refs.map(r => <option key={r} value={r}>{r === repo.defaultRef ? `${r} · default` : r}</option>)}
          </select>
        )}

        <button type="button" className="export-button" disabled={!repo || loading} title="Compare this project with others on one clock" onClick={() => { setSheet(null); setCompareOpen(true) }}>⇄ Compare</button>

        <ExportVideo repo={repo} privacy={privacy} clock={clock} staticDemo={STATIC} repoUrl={REPO_URL} />

        <TrendingPanel staticDemo={STATIC} onPick={name => { setSheet(null); setRepoInput(name); load(name, '') }} />
    </>
  )
  const historyBar = STATIC ? (
<div className="browser-history-bar">
        <span>{repo?.browser?.cached ? 'Saved history · on this device' : repo?.browser?.source === 'api' ? `History from the GitHub API · ${repo.browser.reason}` : repo?.browser?.source === 'blobless' ? `History from a partial clone · ${repo.browser.reason}` : repo?.browser ? 'History processed on your device' : 'Public GitHub repositories · ready-to-play examples'}<span className="browser-relay-note"> · Downloads via <a href="https://github.com/isomorphic-git/cors-proxy" target="_blank" rel="noreferrer">Git relay</a> or the <a href="https://docs.github.com/rest" target="_blank" rel="noreferrer">GitHub API</a></span>{repo?.browser?.rateLimited && <span className="browser-rate-note" role="status"> · GitHub's rate limit stopped this at {repo.stats.commits} commits{repo.browser.tokenUsed ? '' : ' — add a GitHub token for 5,000 requests an hour'}</span>}</span>
        <div>
          <GithubToken />
          {repo && <button type="button" disabled={loading} onClick={() => load(repo.repo, refRef.current, { refresh: true })}>Refresh history</button>}
          {repo && (repo.prebuilt || repo.browser?.hasMore) && repo.loadLimit < 3000 && <button type="button" disabled={loading} onClick={() => { const n = [300, 1000, 1500, 3000].find(n => n > repo.loadLimit); setMaxCommits(n); load(repo.repo, refRef.current, { maxCommits: n }) }}>Load more history</button>}
          <button type="button" disabled={loading} onClick={async () => { try { await clearHistories(); setToast('Saved histories cleared') } catch { setToast('Could not clear browser storage') } }}>Clear saved histories</button>
        </div>
      </div>
  ) : null
  const repoInfo = repo && !loading ? (
    <>
            <div className="rounded-xl bg-panel/90 border border-line px-3.5 py-2.5 backdrop-blur-sm">
              <div className="font-display font-semibold text-[13px] text-ink-100 mb-1.5 flex items-center gap-2">
                <span className="text-accent" aria-hidden="true">●</span>
                {sourceUrl
                  ? <a className="repo-details-link font-mono text-[12px] tracking-tight pointer-events-auto" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open on ${sourceHost}`}>{repo.repo} <span aria-hidden="true">↗</span></a>
                  : <span className="font-mono text-[12px] tracking-tight">{privacy === 'off' ? repo.repo : 'private repository'}</span>}
              </div>
              {cityOwner && <a className="owner-city-link font-mono text-[11px] pointer-events-auto" href={gitCityUrl(cityOwner)} target="_blank" rel="noopener noreferrer" title={`Every public repository of ${cityOwner}, as a city`}>🏙 {cityOwner}&apos;s Git City ↗</a>}
              <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-[3px] font-mono text-[11px]">
                <dt className="text-ink-500">commits</dt><dd className="text-right text-ink-100 tnum">{repo.stats.commits}</dd>
                <dt className="text-ink-500">authors</dt><dd className="text-right text-ink-100 tnum">{repo.stats.authors}</dd>
                <dt className="text-ink-500">lines</dt><dd className="text-right text-ink-100 tnum">{repo.browser?.linesUnavailable ? '—' : repo.stats.loc.toLocaleString()}</dd>
                <dt className="text-ink-500">span</dt><dd className="text-right text-ink-300 tnum">{fmtDate(repo.stats.from)} → {fmtDate(repo.stats.to)}</dd>
              </dl>
              {!!repo.browser?.countsOmitted && <p className="repo-count-note" title="Large or complex text diffs are omitted from line totals; their file activity is still shown.">{repo.browser.countsOmitted} large diffs excluded from lines.</p>}
              {repo.browser?.linesUnavailable && <p className="repo-count-note" title="This repository was too large to download in full, so file contents were skipped. Every commit, file and contributor is exact; only line counts need the contents.">Line counts unavailable · file contents not downloaded.</p>}
              {privacy === 'off' && repo.description && <p className="repo-description" title={repo.description}>{repo.description}</p>}
            </div>
            {repo.stats.topAuthors.length > 0 && (
              <div className="author-card rounded-xl bg-panel/90 border border-line px-3.5 py-2.5 backdrop-blur-sm max-h-44 overflow-y-auto">
                <div className="font-mono text-[10px] uppercase tracking-wide text-ink-500 mb-1.5">top authors</div>
                {repo.stats.topAuthors.slice(0, 6).map(([name, n]) => (
                  <div key={name} className="author-row flex justify-between gap-3 font-mono text-[11px] leading-relaxed">
                    {authorLogins.get(name)
                      ? <a className="author-city-link text-ink-300 truncate pointer-events-auto" href={gitCityUrl(authorLogins.get(name))} target="_blank" rel="noopener noreferrer" title={`See ${authorLogins.get(name)}'s Git City`}>{name} <span aria-hidden="true">🏙</span></a>
                      : <span className="text-ink-300 truncate">{privacy === 'all' ? pseudonyms.get(name) || 'Contributor' : name}</span>}
                    <span className="text-ink-500 tnum shrink-0">{n}</span>
                  </div>
                ))}
              </div>
            )}
    </>
  ) : null
  const viewTools = (
    <>
            <button aria-label="Zoom out" onClick={() => gourceRef.current?.zoomBy(0.8)} className="text-accent px-1">−</button>
            <button aria-label="Zoom in" onClick={() => gourceRef.current?.zoomBy(1.25)} className="text-accent px-1">+</button>
            <button onClick={() => gourceRef.current?.resetView()} className="text-accent">Reset view</button>
            <button aria-pressed={flyover} onClick={toggleFlyover} className="text-accent">Flyover {flyover ? 'on' : 'off'}</button>
            <button onClick={() => { setSheet(null); openVideo() }} disabled={!repo || loading} className="text-accent" title="Play the export composition fullscreen with music (v)">▶ Video</button>
            <button aria-pressed={clock} onClick={toggleClock} title={clock && clockHidden ? 'Clock on — hidden while history moves faster than a day per second; slow down to see it (k)' : 'Show or hide the clock (k)'} className={clock ? 'text-accent' : 'text-ink-500'}>Clock {clock ? (clockHidden ? 'auto' : 'on') : 'off'}</button>
            <button onClick={share} className="text-accent">Share</button>
            <button aria-pressed={privacy !== 'off'} onClick={cyclePrivacy} title="Hide file/folder names (and contributors) for closed-source demos" className={privacy === 'off' ? 'text-accent' : 'text-warn'}>{PRIVACY_LABELS[privacy]}</button>
            <button aria-label="Keyboard shortcuts" aria-pressed={showHelp} onClick={() => { setSheet(null); setShowHelp(v => !v) }} className="text-accent">?</button>
    </>
  )
  const transportExtras = (
    <>
          <div className="flex items-center gap-1" role="group" aria-label="Bursts">
            <button aria-label="Previous burst" disabled={!repo || loading} onClick={() => jumpBurst(-1)} className="px-2 py-1.5 rounded-md font-mono text-[11px] bg-panel2 text-ink-300 hover:text-ink-100 disabled:opacity-40">«</button>
            <button aria-label="Next burst" disabled={!repo || loading} onClick={() => jumpBurst(1)} className="px-2 py-1.5 rounded-md font-mono text-[11px] bg-panel2 text-ink-300 hover:text-ink-100 disabled:opacity-40">»</button>
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
            {SPEEDS.map(s => (
              <button key={s}
                onClick={() => applySpeed(s)}
                aria-pressed={speed === s}
                className={`px-2.5 py-1.5 rounded-md font-mono text-[11px] font-medium transition-colors duration-150 ${speed === s ? 'bg-accent text-accent-ink' : 'bg-panel2 text-ink-300 hover:text-ink-100'}`}>
                {s}×
              </button>
            ))}
          </div>

          <button
            onClick={togglePace}
            aria-pressed={pace}
            title="Run 4× faster through quiet stretches"
            className={`px-3 py-1.5 rounded-md font-mono text-[11px] transition-colors duration-150 ${pace ? 'bg-panel2 text-accent' : 'bg-panel2 text-ink-500'}`}
          >
            auto-pace
          </button>

          <button
            onClick={() => setShowStats(v => !v)}
            aria-pressed={showStats}
            className="stats-toggle px-3 py-1.5 rounded-md font-mono text-[11px] transition-colors duration-150 bg-panel2 text-ink-300 hover:text-ink-100"
          >
            stats
          </button>
    </>
  )

  return (
    <div className={`gource-app ${compact ? 'is-compact' : ''} flex flex-col h-full min-h-dvh bg-ink text-ink-100 font-display`}>
      {/* ── Header ── */}
      <header className="app-header flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-line bg-panel">
        <div className="flex items-baseline gap-2 shrink-0">
          <span aria-hidden="true" className="text-accent font-mono text-sm tracking-tight">✳</span>
          <a href={BASE} aria-label="GourceView home" className="font-display font-semibold text-[15px] tracking-tight text-ink-100">
            Gource<span className="text-accent">View</span>
          </a>
          <span className="hidden sm:inline font-mono text-[11px] text-ink-500">CODE IN MOTION</span>
          {STATIC && <a className="github-source-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GourceView on GitHub <span aria-hidden="true">↗</span>
          </a>}
        </div>

        <RepoSearch
          id="repo"
          className="repo-search--header"
          label="Repository"
          value={repoInput}
          onChange={setRepoInput}
          onPick={name => load(name, name === repo?.repo ? refRef.current : '')}
          buttonLabel={loading ? 'Loading' : 'Load'}
          disabled={loading}
          placeholder={config?.gitea ? `Search GitHub, owner/repo or ${config.gitea.label} URL…` : 'Search GitHub, or owner/repo…'}
        />

        {!compact && headerTools}

      </header>
      {!compact && <RepoDiscovery suggestions={SUGGESTIONS} staticDemo={STATIC} onPick={name => { setRepoInput(name); load(name) }} />}

      {!compact && historyBar}

      {/* ── Stage ── */}
      <main className="visual-stage relative flex-1 min-h-0 bg-stage overflow-hidden">
        <canvas
          id="gource-canvas"
          ref={canvasRef}
          className="absolute inset-0 block"
          role="img"
          aria-label={repo ? `Animated file-tree history of ${privacy === 'off' ? repo.repo : 'private repository'}` : 'Repository history visualization'}
        />

        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70" role="status">
            <div className="load-card w-80 max-w-[88%] rounded-xl border border-line bg-panel p-5 shadow-2xl">
              <span className="eyebrow">BUILDING YOUR STORY</span>
              <h2>Bringing history to life</h2>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full bg-accent animate-pulse" aria-hidden="true" />
                <span className="font-mono text-[12px] text-ink-300">{progress?.detail || 'Working…'}</span>
              </div>
              <div className="h-1.5 rounded-full bg-ink overflow-hidden" aria-hidden="true">
                <div className="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${progress?.pct ?? 0}%` }} />
              </div>
              <div className="mt-2 font-mono text-[11px] text-ink-500 tnum">{Math.round(progress?.pct ?? 0)}% · {loadSeconds}s elapsed</div>
              <p className="load-hint">{loadSeconds > 15 ? 'Large histories take longer. You can stop waiting and try fewer commits.' : 'Reading commits, mapping files and finding the people behind them.'}</p>
              <button type="button" className="recovery-button" onClick={cancelLoad}>{STATIC ? 'Cancel download' : 'Stop waiting'}</button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/70" role="alert">
            <div className="rounded-xl border border-line bg-panel px-5 py-4 max-w-md text-center">
              <div className="font-display font-semibold text-ink-100 text-sm mb-1">Couldn't load that repo</div>
              <div className="font-mono text-[12px] text-ink-300 break-words">{error}</div>
              <div className="recovery-actions"><button type="button" className="recovery-button" onClick={() => lastLoad.current && load(lastLoad.current.name, lastLoad.current.branch, lastLoad.current.settings)}>Try again</button>{repo && <button type="button" className="recovery-button" onClick={() => { setError(null); setRepoInput(repo.repo) }}>Back to viewer</button>}</div>
            </div>
          </div>
        )}

        {!repo && !loading && !error && <div className="empty-stage"><span className="eyebrow">EVERY REPOSITORY HAS A STORY</span><h2>Watch yours unfold.</h2><p>Paste a repository above, or explore an example to see code come to life.</p><button type="button" className="recovery-button" onClick={() => { const d = document.querySelector('.repo-discovery'); if (d) d.open = true }}>Explore examples</button></div>}

        {!compact && repo && !loading && (
          <div className="scene-heading pointer-events-none">
            <span className="eyebrow">REPOSITORY EXPLORER</span>
            <h2>{privacy === 'off' ? repo.repo.split('/').pop() : 'private repository'}</h2>
            <span className="scene-status"><i className={playing ? 'is-playing' : ''} />{playing ? 'Playing history' : 'Paused'}<span> / </span>{fmtDate(curTs)}</span>
          </div>
        )}

        {/* Stats overlay */}
        {!compact && repoInfo && (
          <div className={`repo-details absolute top-3 left-3 space-y-2 pointer-events-none transition-opacity duration-200 ${showStats ? 'opacity-100' : 'hidden'}`}>
            {repoInfo}
          </div>
        )}

        {!compact && repo && !loading && (
          <div className="view-tools absolute bottom-3 left-3 flex items-center gap-3 rounded-lg bg-panel/90 px-3 py-2 font-mono text-[11px] text-ink-300">
            {viewTools}
            <span className="hidden sm:inline">Scroll to zoom · drag to pan · hover to inspect</span>
          </div>
        )}

        {toast && <div className="toast" role="status">{toast}</div>}
        {showHelp && (
          <div className="help-overlay" role="dialog" aria-label="Keyboard shortcuts">
            <div className="help-top"><span className="eyebrow">KEYBOARD</span><button aria-label="Close shortcuts" onClick={() => setShowHelp(false)}>×</button></div>
            <dl>
              <dt>space</dt><dd>play / pause</dd>
              <dt>← →</dt><dd>seek 2% (shift: 10%)</dd>
              <dt>n / p</dt><dd>next / previous burst</dd>
              <dt>[ ]</dt><dd>slower / faster</dd>
              <dt>home / end</dt><dd>start / end</dd>
              <dt>f</dt><dd>flyover on / off</dd>
              <dt>a</dt><dd>auto-pace on / off</dd>
              <dt>r</dt><dd>reset view</dd>
              <dt>s</dt><dd>stats overlay</dd>
              <dt>c</dt><dd>copy share link</dd>
              <dt>g</dt><dd>open the repository’s page</dd>
              <dt>h</dt><dd>privacy: hide names / people</dd>
              <dt>v</dt><dd>play as video (fullscreen)</dd>
              <dt>k</dt><dd>clock on / off (hides itself at high speed)</dd>
              <dt>?</dt><dd>this panel</dd>
            </dl>
          </div>
        )}
        {/* Legend */}
        {!compact && repo && !loading && (
          <div className="file-legend absolute bottom-3 right-3 hidden sm:flex flex-col gap-1 rounded-xl bg-panel/85 border border-line px-3 py-2 backdrop-blur-sm font-mono text-[10px] text-ink-500">
            <LegendSwatch color={[255,160,58]} label="source" />
            <LegendSwatch color={[58,190,255]} label="data / markup" />
            <LegendSwatch color={[140,120,255]} label="assets" />
            <LegendSwatch color={[140,160,190]} label="folders" />
          </div>
        )}
      </main>

      {compareOpen && repo && <CompareView primary={repo} initial={compareInitial.current} privacy={privacy} maxCommits={repo.loadLimit ?? maxCommits} gitea={config?.gitea} giteaRepos={giteaRepos} onClose={() => setCompareOpen(false)} />}
      {videoMode && repo && <VideoMode repo={repo} privacy={privacy} clock={clock} tracks={tracks} onClose={closeVideo} shareLink={videoLink} />}

      {/* ── Transport ── */}
      <footer className="transport border-t border-line bg-panel px-3 py-3 sm:px-5" role="group" aria-label="Playback controls">
        <div className="activity-header"><span className="eyebrow">COMMIT ACTIVITY</span><span>{repo ? `${fmt(repo.stats.from)} — ${fmt(repo.stats.to)}` : 'Waiting for repository'}</span></div>
        <div className="activity-chart" aria-hidden="true">{activity.map((h, i) => <span key={i} className={`${i / activity.length * 100 <= played ? 'elapsed' : ''} ${bursts.bins.has(i) ? 'burst' : ''}`} style={{ height: `${Math.max(5, h * 100)}%` }} />)}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <button
            onClick={() => gourceRef.current && gourceRef.current.toggle()}
            disabled={!repo || loading}
            aria-label={playing ? 'Pause' : 'Play'}
            className="w-11 h-11 rounded-full bg-accent text-accent-ink font-display font-bold text-lg flex items-center justify-center transition-colors duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {playing ? '❚❚' : '▶'}
          </button>

          <div className="flex-1 min-w-[140px] flex items-center gap-3">
            <input
              type="range"
              className="timeline flex-1"
              style={{ background: `linear-gradient(to right, var(--color-accent) ${played}%, var(--color-panel2) ${played}%)` }}
              min={repo?.stats.from ?? 0}
              max={repo?.stats.to ?? 1}
              step={repo ? Math.max(1, span / 1000) : 1}
              value={repo ? curTs : 0}
              disabled={!repo || loading}
              onChange={(e) => seekTo(+e.target.value)}
              aria-label="Timeline position"
              aria-valuetext={repo ? fmt(curTs) : undefined}
            />
            <span className="font-mono text-[11px] text-ink-300 tnum w-[72px] text-right shrink-0">
              {repo ? fmt(curTs) : '——'}
            </span>
          </div>

          {compact ? (
            <>
              <button type="button" className="m-speed" onClick={() => applySpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} disabled={!repo || loading} aria-label={`Playback speed ${speed}×, tap to change`}>{speed}×</button>
              <button type="button" ref={moreRef} className="m-more" onClick={() => setSheet(v => v ? null : 'repo')} aria-haspopup="dialog" aria-expanded={!!sheet} aria-label="Repository, view and explore">⋯</button>
            </>
          ) : transportExtras}
        </div>
      </footer>
      {compact && sheet && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setSheet(null)} aria-hidden="true" />
          <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Repository, view and explore" ref={sheetRef} tabIndex={-1}>
            <div className="m-sheet-handle" aria-hidden="true" />
            <div className="m-sheet-top">
              <div className="m-sheet-tabs" role="tablist">
                {[['repo', 'Repo'], ['view', 'View'], ['explore', 'Explore']].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={sheet === k} className={sheet === k ? 'is-active' : ''} onClick={() => setSheet(k)}>{label}</button>
                ))}
              </div>
              <button type="button" className="m-sheet-close" aria-label="Close" onClick={() => setSheet(null)}>×</button>
            </div>
            <div className="m-sheet-body" role="tabpanel">
              {sheet === 'repo' && (repoInfo || <p className="m-sheet-empty">Load a repository to see its stats and the people behind it.</p>)}
              {sheet === 'view' && (
                <>
                  {repo && !loading && <section><h3 className="eyebrow">VIEW</h3><div className="m-tools">{viewTools}</div></section>}
                  <section><h3 className="eyebrow">PLAYBACK</h3><div className="m-tools">{transportExtras}</div></section>
                  <section><h3 className="eyebrow">REPOSITORY</h3><div className="m-tools">{headerTools}</div></section>
                  {historyBar && <section><h3 className="eyebrow">HISTORY</h3>{historyBar}</section>}
                </>
              )}
              {sheet === 'explore' && (
                <>
                  <RepoDiscovery suggestions={SUGGESTIONS} staticDemo={STATIC} onPick={name => { setSheet(null); setRepoInput(name); load(name) }} />
                  {STATIC && <a className="github-source-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">GourceView on GitHub <span aria-hidden="true">↗</span></a>}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LegendSwatch({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: `rgb(${color[0]},${color[1]},${color[2]})` }} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
