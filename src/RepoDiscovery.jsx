import { useRef, useState } from 'react'

export default function RepoDiscovery({ suggestions, onPick, staticDemo }) {
  const panel = useRef(null), search = useRef(null)
  const [query, setQuery] = useState('')
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches = suggestions.filter(s => terms.every(t => `${s.label} ${s.note} ${s.description || ''}`.toLowerCase().includes(t)))
  return (
    <details className="repo-discovery" ref={panel} onToggle={e => { if (e.currentTarget.open) search.current?.focus() }} onKeyDown={e => { if (e.key === 'Escape') { panel.current.open = false; panel.current.querySelector('summary').focus() } }}>
      <summary><span>✳ Explore repositories</span><span className="discovery-caption">{staticDemo ? 'Ready-to-play demos · no setup needed' : 'Find a good story in the code'}</span><span className="discovery-count">{suggestions.length} examples <span aria-hidden="true">↗</span></span></summary>
      <div className="discovery-panel">
        <div className="discovery-heading"><div><span className="eyebrow">PICK YOUR NEXT STORY</span><h2>Small repos. Big ideas.</h2><p>{staticDemo ? 'These histories are ready to explore in your browser.' : 'Start with a manageable history, then explore more commits when you’re ready.'}</p></div><button type="button" aria-label="Close repository browser" onClick={() => { panel.current.open = false; panel.current.querySelector('summary').focus() }}>×</button></div>
        <input ref={search} className="gitea-search" type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search example repositories" placeholder="Search by repository, language or idea…" />
        <nav aria-label="Suggested repos" className="discovery-grid">
          {matches.map(s => <button type="button" key={s.label} aria-label={s.label} onClick={() => { panel.current.open = false; onPick(s.label) }}><span className="discovery-language">{s.note || 'Repository'}</span><strong>{s.label.split('/').pop()}</strong><span className="discovery-owner">{s.label}</span><span className="discovery-description">{s.description || 'Explore the people and changes behind this project.'}</span><span className="discovery-open">Explore history <span aria-hidden="true">→</span></span></button>)}
        </nav>
        {!matches.length && <p className="discovery-empty" role="status">No matches. Try a language like Python or clear your search.</p>}
      </div>
    </details>
  )
}
