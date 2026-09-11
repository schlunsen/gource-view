// Git City companion links: https://github.com/schlunsen/git-city renders a
// GitHub profile as a cartoon city. From a visualized repository we link the
// owner and the top authors to their cities.
//
// Commits only carry an author's name and e-mail, so the GitHub login is
// resolved lazily: noreply e-mails name it outright; otherwise one call to the
// repository's commits API maps recent authors to accounts, with a single
// per-author lookup as the fallback. Every failure just leaves an author
// unlinked — this must never cost the viewer its rate-limit budget.
import { API, headers, storedToken } from './browser-git/github-api.js'

export const GIT_CITY_URL = import.meta.env?.VITE_GIT_CITY_URL || 'https://schlunsen.github.io/git-city/'

export const gitCityUrl = login => `${GIT_CITY_URL}?user=${encodeURIComponent(login)}`

// 12345+login@users.noreply.github.com, or the older login@users.noreply.github.com
const NOREPLY = /^(?:\d+\+)?([a-z\d](?:[a-z\d-]{0,38}))@users\.noreply\.github\.com$/i

export function loginFromEmail(email) {
  const m = NOREPLY.exec(String(email || '').trim())
  return m ? m[1] : ''
}

/** "owner/name" when the loaded repository lives on GitHub, else ''. */
export function githubRepoOf(repo) {
  if (!repo?.repo || (repo.source && repo.source !== 'github')) return ''
  return /^[\w.-]+\/[\w.-]+$/.test(repo.repo) ? repo.repo : ''
}

export const ownerOf = repo => githubRepoOf(repo).split('/')[0] || ''

const isBot = u => u?.type === 'Bot' || /\[bot\]$/i.test(u?.login || '')

/**
 * Map author names to GitHub logins.
 * @param {string} repo "owner/name" on GitHub
 * @param {{name: string, email: string}[]} authors
 * @returns {Promise<Map<string, string>>} name → login (only resolved authors)
 */
export async function resolveAuthorLogins(repo, authors, { fetchImpl = fetch, token = storedToken(), signal, maxLookups = 6 } = {}) {
  const out = new Map()
  for (const a of authors) {
    const login = loginFromEmail(a.email)
    if (login) out.set(a.name, login)
  }
  const pending = () => authors.filter(a => !out.has(a.name))
  if (!repo || !pending().length) return out
  const get = path => fetchImpl(`${API}${path}`, { headers: headers(token), credentials: 'omit', signal })
  try {
    const r = await get(`/repos/${repo}/commits?per_page=100`)
    if (!r.ok) return out // rate-limited, private or gone: stop here
    for (const c of await r.json()) {
      if (!c?.author?.login || isBot(c.author)) continue
      const name = c.commit?.author?.name
      const email = String(c.commit?.author?.email || '').toLowerCase()
      for (const a of pending()) {
        if (a.name === name || (email && String(a.email).toLowerCase() === email)) out.set(a.name, c.author.login)
      }
    }
    for (const a of pending().filter(a => a.email).slice(0, maxLookups)) {
      const r2 = await get(`/repos/${repo}/commits?author=${encodeURIComponent(a.email)}&per_page=1`)
      if (!r2.ok) break
      const [c] = await r2.json()
      if (c?.author?.login && !isBot(c.author)) out.set(a.name, c.author.login)
    }
  } catch { /* offline or aborted: authors stay unlinked */ }
  return out
}
