import { useEffect, useMemo, useRef, useState } from 'react'
import { trending } from './api.js'

const PERIODS = [
  { id: 'daily', label: 'Today', short: 'today' },
  { id: 'weekly', label: 'This week', short: 'this week' },
  { id: 'monthly', label: 'This month', short: 'this month' },
  { id: 'quarter', label: '3 months', short: 'in the last 3 months' },
  { id: 'year', label: 'This year', short: 'in the last year' },
]
const ago = ms => { const h = (Date.now() - ms) / 3600000; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago` }
const k = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

/** GitHub trending across windows: today/week/month from github.com/trending, 3 months/year from search. Refreshed daily. */
export default function TrendingPanel({ onPick, staticDemo = false }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('weekly')
  const [language, setLanguage] = useState('')
  const root = useRef(null), input = useRef(null), trigger = useRef(null)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  // Browser loads stop at 100 MB of Git data; the server merely gets slow.
  const largeMb = staticDemo ? 100 : 300
  const largeTitle = mb => staticDemo ? `${mb} MB — loads through the GitHub API (add a token for longer histories)` : `${mb} MB clone — slow`
  const current = data?.periods?.[period]
  const meta = PERIODS.find(p => p.id === period)
  const fromSearch = current?.source?.startsWith('search')
  const languages = useMemo(() => [...new Set((current?.repos || []).map(r => r.language).filter(Boolean))].sort(), [current])
  const matches = (current?.repos || []).filter(r => (!language || r.language === language) && `${r.name} ${r.description} ${r.language}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pick = name => { setOpen(false); trigger.current?.focus(); onPick(name) }
  useEffect(() => {
    if (!open || data) return
    let cancelled = false
    setError('')
    trending().then(d => { if (!cancelled) setData(d) }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [open, data, attempt])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const choosePeriod = id => { setPeriod(id); setLanguage(''); input.current?.focus() }
  return (
    <div className="trending" ref={root} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } e.stopPropagation() }}>
      <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)} className="trending-button">🔥 Trending</button>
      {open && (
        <div className="trending-panel" role="dialog" aria-label="GitHub trending">
          <div className="trending-head"><span className="eyebrow">GITHUB · TRENDING</span><span className="trending-when">{data ? `refreshed ${ago(data.fetchedAt)}` : ''}</span></div>
          <div className="trending-tabs" role="tablist" aria-label="Trending window">
            {PERIODS.map(p => <button key={p.id} type="button" role="tab" aria-selected={p.id === period} className={`trending-tab${p.id === period ? ' is-active' : ''}`} onClick={() => choosePeriod(p.id)} onKeyDown={e => {
              const i = PERIODS.findIndex(x => x.id === period)
              if (e.key === 'ArrowRight') { e.preventDefault(); choosePeriod(PERIODS[(i + 1) % PERIODS.length].id) }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); choosePeriod(PERIODS[(i + PERIODS.length - 1) % PERIODS.length].id) }
            }}>{p.label}</button>)}
          </div>
          <div className="trending-filters">
            <input ref={input} className="gitea-search" aria-label="Search trending repositories" placeholder="Search by name, description or language…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); root.current?.querySelector('[role=option]')?.focus() } }} />
            <select aria-label="Filter trending by language" className="trending-language" value={language} onChange={e => setLanguage(e.target.value)} disabled={!languages.length}>
              <option value="">All languages</option>
              {languages.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {error && <div className="trending-empty" role="alert">{error}<button type="button" className="recovery-button" onClick={() => setAttempt(a => a + 1)}>Try again</button></div>}
          {!data && !error && <p className="trending-empty">Loading…</p>}
          {data && !current && <p className="trending-empty">The {meta.label.toLowerCase()} window is not available right now.</p>}
          {current && (
            <ul role="listbox" aria-label="Trending repositories" className="trending-list">
              {matches.map((r, i) => (
                <li key={r.name} role="option" aria-selected="false" tabIndex={0} onClick={() => pick(r.name)} onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r.name) }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.nextElementSibling?.focus() }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling || input.current)?.focus() }
                }}>
                  <span className="trending-name"><span className="trending-rank">{i + 1}</span><span className="trending-owner">{r.name.split('/')[0]}/</span>{r.name.split('/')[1]}{r.language && <span className="trending-lang">{r.language}</span>}{r.sizeMb > largeMb && <span className="trending-large" title={largeTitle(r.sizeMb)}>large</span>}</span>
                  <span className="trending-meta"><span className="trending-desc">{r.description}</span><span className="trending-stars">{fromSearch ? `★ ${k(r.stars)} · created ${meta.short}` : `★ ${k(r.gained)} ${meta.short}${r.stars ? ` · ${k(r.stars)} total` : ''}`}</span></span>
                </li>
              ))}
              {!matches.length && <li className="trending-empty">No matching repositories.</li>}
            </ul>
          )}
          {current && <div className="gitea-hint">{current.source} · {staticDemo ? 'refreshed daily · choose a repository to load its history on this device' : 'choose a repository to explore its history'}</div>}
        </div>
      )}
    </div>
  )
}
