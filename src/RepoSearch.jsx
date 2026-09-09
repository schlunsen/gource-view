import { useEffect, useRef, useState } from 'react'
import { API, headers, storedToken } from './browser-git/github-api.js'

const k = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)

/**
 * Search GitHub for a repository, entirely from the browser: the search API
 * allows cross-origin requests, so no server and no proxy is involved. Typing
 * `owner/repo` and pressing Enter still works without searching at all.
 */
export default function RepoSearch({
  onPick, placeholder = 'Search GitHub, or owner/repo…', disabled = false, label = 'Search for a project',
  id, value, onChange, buttonLabel = 'Add', className = '', busyLabel,
}) {
  const [internal, setInternal] = useState('')
  const controlled = value !== undefined
  const query = controlled ? value : internal
  const setQuery = next => { if (controlled) onChange(next); else setInternal(next) }
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef(null), input = useRef(null)
  const term = query.trim()

  const direct = /^[\w.-]+\/[\w.-]+$/.test(term) || /^(https?:\/\/|www\.|github\.com\/)/i.test(term) || /^gitea:/i.test(term)
  useEffect(() => {
    if (term.length < 2 || direct) { setResults([]); setError(''); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await fetch(`${API}/search/repositories?q=${encodeURIComponent(term)}&sort=stars&order=desc&per_page=8`, { headers: headers(storedToken()), credentials: 'omit', signal: AbortSignal.timeout(15000) })
        if (cancelled) return
        if (r.status === 403 || r.status === 429) { setResults([]); setError('GitHub search is rate limited for a moment. Type owner/repo to load it directly.'); return }
        if (!r.ok) { setResults([]); setError(`GitHub search returned HTTP ${r.status}.`); return }
        const data = await r.json()
        if (cancelled) return
        setError('')
        setResults((data.items || []).map(i => ({ name: i.full_name, stars: i.stargazers_count, language: i.language || '', description: (i.description || '').slice(0, 90) })))
        setActive(-1)
      } catch (e) { if (!cancelled) { setResults([]); setError(e.name === 'TimeoutError' ? 'GitHub search timed out.' : 'Could not reach GitHub search.') } }
      finally { if (!cancelled) setBusy(false) }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [term, direct])

  useEffect(() => {
    const away = e => { if (!box.current?.contains(e.target)) { setResults([]); setActive(-1) } }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const choose = name => { setQuery(controlled ? name : ''); setResults([]); setActive(-1); onPick(name) }
  const submit = e => {
    e.preventDefault()
    // Enter takes the highlighted result, or the first one when the text is a
    // search rather than a repository you could load as typed.
    if (active >= 0 && results[active]) choose(results[active].name)
    else if (!direct && results.length) choose(results[0].name)
    else if (term) choose(term)
  }
  return (
    <form className={`repo-search ${className}`.trim()} ref={box} onSubmit={submit} role="search">
      <input
        ref={input} id={id} value={query} disabled={disabled} aria-label={label} placeholder={placeholder}
        spellCheck={false} autoCapitalize="none" autoComplete="off"
        aria-autocomplete="list" aria-expanded={results.length > 0}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(-1, i - 1)) }
          else if (e.key === 'Escape') { setResults([]); setActive(-1) }
          e.stopPropagation()
        }} />
      <button type="submit" disabled={disabled || !term}>{busy && !buttonLabel.startsWith('Load') ? '…' : (disabled && busyLabel) || buttonLabel}</button>
      {(results.length > 0 || error) && (
        <div className="repo-search-results">
          {error && <p className="repo-search-note" role="alert">{error}</p>}
          {results.length > 0 && (
            <ul role="listbox" aria-label="Search results">
              {results.map((r, i) => (
                <li key={r.name} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(r.name)}>
                  <span className="repo-search-name">{r.name}{r.language && <span className="repo-search-lang">{r.language}</span>}</span>
                  <span className="repo-search-meta"><span className="repo-search-desc">{r.description}</span><span>★ {k(r.stars)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}
