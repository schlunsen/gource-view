import { useEffect, useRef, useState } from 'react'
import { storedToken, storeToken } from './browser-git/github-api.js'

/** Optional personal token for the GitHub API path. Stored only in this browser, sent only to api.github.com. */
export default function GithubToken({ onChange }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(() => !!storedToken())
  const root = useRef(null), input = useRef(null)
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = e => { if (!root.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const save = () => {
    const t = value.trim()
    if (!/^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(t)) return
    storeToken(t); setSaved(true); setValue(''); setOpen(false); onChange?.(true)
  }
  const remove = () => { storeToken(''); setSaved(false); setValue(''); setOpen(false); onChange?.(false) }
  return (
    <span className="github-token" ref={root}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)}>{saved ? 'GitHub token ✓' : 'GitHub token'}</button>
      {open && (
        <div className="github-token-dialog" role="dialog" aria-label="GitHub token" onKeyDown={e => e.stopPropagation()}>
          <p className="github-token-lead">{saved ? 'A token is saved in this browser.' : 'Optional. Large repositories load through the GitHub API, which allows 60 requests an hour without a token and 5,000 with one.'}</p>
          {!saved && <>
            <input ref={input} type="password" autoComplete="off" spellCheck={false} aria-label="GitHub personal access token" placeholder="github_pat_…" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
            <div className="github-token-actions">
              <button type="button" className="recovery-button" disabled={!/^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(value.trim())} onClick={save}>Save on this device</button>
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained token ↗</a>
            </div>
          </>}
          {saved && <div className="github-token-actions"><button type="button" className="recovery-button" onClick={remove}>Remove token</button></div>}
          <p className="github-token-note">Use a fine-grained token with <b>Public repositories</b> read access and nothing else. It stays in this browser's storage and is sent only to api.github.com — never to the Git relay.</p>
        </div>
      )}
    </span>
  )
}
