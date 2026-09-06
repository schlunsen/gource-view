import { useEffect, useMemo, useRef, useState } from 'react'

function ago(iso) {
  if (!iso) return ''
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return 'today'
  if (d < 30) return `${Math.round(d)}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${Math.round(d / 365)}y ago`
}

/** Searchable repository picker for the configured Gitea instance. */
export default function GiteaPicker({ label, repos, onPick }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const root = useRef(null), input = useRef(null), list = useRef(null)

  const matches = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = repos.filter(r => terms.every(t => r.name.toLowerCase().includes(t) || (r.description || '').toLowerCase().includes(t)))
      .map(r => { const n = r.name.toLowerCase(), short = n.split('/').pop(); const q = terms[0] || ''; return { r, score: !q ? 0 : short === q ? 3 : short.startsWith(q) ? 2 : n.includes(q) ? 1 : 0 } })
    scored.sort((a, b) => b.score - a.score || (b.r.updatedAt || '').localeCompare(a.r.updatedAt || ''))
    return scored.map(x => x.r).slice(0, 200)
  }, [repos, query])

  useEffect(() => { setCursor(0) }, [query, open])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  useEffect(() => { list.current?.children[cursor]?.scrollIntoView?.({ block: 'nearest' }) }, [cursor])

  const pick = r => { if (!r) return; setOpen(false); setQuery(''); onPick(r.name) }
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(matches.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[cursor]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="gitea-picker" ref={root}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(v => !v)}
        title={`Load a repository from ${label}`}
        className="rounded-lg bg-ink border border-line font-mono text-[11px] text-ink-300 px-3 transition-colors duration-150 hover:text-ink-100"
        style={{ height: 40 }}>
        {label} · {repos.length} ▾
      </button>
      {open && (
        <div className="gitea-panel">
          <input ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder={`Search ${repos.length} repositories…`} aria-label={`Search ${label} repositories`}
            className="gitea-search" />
          <ul ref={list} role="listbox" aria-label={`${label} repositories`} className="gitea-list">
            {matches.map((r, i) => (
              <li key={r.name} role="option" aria-selected={i === cursor} className={i === cursor ? 'is-active' : ''}
                onMouseEnter={() => setCursor(i)} onMouseDown={e => { e.preventDefault(); pick(r) }}>
                <span className="gitea-name">{r.private ? <span className="gitea-lock" title="private">🔒</span> : null}<span className="gitea-owner">{r.name.split('/')[0]}/</span>{r.name.split('/').slice(1).join('/')}</span>
                <span className="gitea-meta">{r.description ? <span className="gitea-desc">{r.description}</span> : null}<span className="gitea-when">{ago(r.updatedAt)}</span></span>
              </li>
            ))}
            {!matches.length && <li className="gitea-empty">No repositories match “{query}”</li>}
          </ul>
          <div className="gitea-hint">↑↓ to move · enter to load · esc to close</div>
        </div>
      )}
    </div>
  )
}
