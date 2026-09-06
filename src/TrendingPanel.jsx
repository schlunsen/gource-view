import { useEffect, useRef, useState } from 'react'
import { trending } from './api.js'

const ago = ms => { const h = (Date.now() - ms) / 3600000; return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago` }
const k = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

/** GitHub "trending this week" list; the server refreshes it once a day. */
export default function TrendingPanel({ onPick }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const root = useRef(null)
  useEffect(() => {
    if (!open || data) return
    trending().then(setData).catch(e => setError(e.message))
  }, [open, data])
  useEffect(() => {
    if (!open) return
    const away = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="trending" ref={root}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)} className="trending-button">🔥 Trending</button>
      {open && (
        <div className="trending-panel">
          <div className="trending-head"><span className="eyebrow">GITHUB · TRENDING THIS WEEK</span><span className="trending-when">{data ? `refreshed ${ago(data.fetchedAt)}` : ''}</span></div>
          {error && <p className="trending-empty">{error}</p>}
          {!data && !error && <p className="trending-empty">Loading…</p>}
          {data && (
            <ul role="listbox" aria-label="Trending repositories" className="trending-list">
              {data.repos.map(r => (
                <li key={r.name} role="option" aria-selected="false" onMouseDown={e => { e.preventDefault(); setOpen(false); onPick(r.name) }}>
                  <span className="trending-name"><span className="trending-owner">{r.name.split('/')[0]}/</span>{r.name.split('/')[1]}{r.language && <span className="trending-lang">{r.language}</span>}{r.sizeMb > 300 && <span className="trending-large" title={`${r.sizeMb} MB clone — slow`}>large</span>}</span>
                  <span className="trending-meta"><span className="trending-desc">{r.description}</span><span className="trending-stars">★ {k(r.starsWeek)} this week{r.stars ? ` · ${k(r.stars)}` : ''}</span></span>
                </li>
              ))}
            </ul>
          )}
          {data && <div className="gitea-hint">{data.source} · click to load the last 300 commits</div>}
        </div>
      )}
    </div>
  )
}
