import { useEffect, useRef, useState } from 'react'
import { trending } from './api.js'

const ago = ms => { const h = (Date.now() - ms) / 3600000; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago` }
const k = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

/** GitHub "trending this week" list; the server refreshes it once a day. */
export default function TrendingPanel({ onPick }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const root = useRef(null), input = useRef(null), trigger = useRef(null)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const matches = data?.repos.filter(r => `${r.name} ${r.description} ${r.language}`.toLowerCase().includes(query.trim().toLowerCase())) || []
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
  return (
    <div className="trending" ref={root} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } e.stopPropagation() }}>
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)} className="trending-button">🔥 Trending</button>
      {open && (
        <div className="trending-panel">
          <div className="trending-head"><span className="eyebrow">GITHUB · TRENDING THIS WEEK</span><span className="trending-when">{data ? `refreshed ${ago(data.fetchedAt)}` : ''}</span></div>
          <input ref={input} className="gitea-search" aria-label="Search trending repositories" placeholder="Search by name, description or language…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); root.current?.querySelector('[role=option]')?.focus() } }} />
          {error && <div className="trending-empty" role="alert">{error}<button type="button" className="recovery-button" onClick={() => setAttempt(a => a + 1)}>Try again</button></div>}
          {!data && !error && <p className="trending-empty">Loading…</p>}
          {data && (
            <ul role="listbox" aria-label="Trending repositories" className="trending-list">
              {matches.map(r => (
                <li key={r.name} role="option" aria-selected="false" tabIndex={0} onClick={() => pick(r.name)} onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r.name) }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.nextElementSibling?.focus() }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling || input.current)?.focus() }
                }}>
                  <span className="trending-name"><span className="trending-owner">{r.name.split('/')[0]}/</span>{r.name.split('/')[1]}{r.language && <span className="trending-lang">{r.language}</span>}{r.sizeMb > 300 && <span className="trending-large" title={`${r.sizeMb} MB clone — slow`}>large</span>}</span>
                  <span className="trending-meta"><span className="trending-desc">{r.description}</span><span className="trending-stars">★ {k(r.starsWeek)} this week{r.stars ? ` · ${k(r.stars)}` : ''}</span></span>
                </li>
              ))}
              {!matches.length && <li className="trending-empty">No matching repositories.</li>}
            </ul>
          )}
          {data && <div className="gitea-hint">{data.source} · choose a repository to explore its history</div>}
        </div>
      )}
    </div>
  )
}
