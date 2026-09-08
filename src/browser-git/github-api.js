// History through the GitHub REST API: no Git objects at all, so repository
// size stops mattering. The cost moves to the request budget — 60 an hour
// without a token, 5,000 with one — so everything here is budget-aware.
export const API = 'https://api.github.com'
export const API_REPO_SIZE_MB = 250 // repositories above this skip the clone attempt
const CONCURRENCY = 4
const RESERVE = 2 // requests kept back so the page can still fetch metadata afterwards

export const TOKEN_KEY = 'gource-github-token'
export const storedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }
export const storeToken = value => { try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY) } catch { /* storage may be unavailable */ } }

export const headers = token => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) })
const request = (fetchImpl, token) => (path, signal) => fetchImpl(`${API}${path}`, { headers: headers(token), credentials: 'omit', signal: signal || AbortSignal.timeout(30000) })

export class RateLimitError extends Error { constructor(reset) { super(reset ? `GitHub's API rate limit is used up until ${new Date(reset * 1000).toLocaleTimeString()}. Add a GitHub token for 5,000 requests an hour.` : 'GitHub API rate limit reached. Add a GitHub token for 5,000 requests an hour.'); this.name = 'RateLimitError'; this.reset = reset } }
const isRateLimited = r => (r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0'

/** Remaining request budget; this endpoint does not count against it. */
export async function rateBudget(fetchImpl = fetch, token = '') {
  const r = await request(fetchImpl, token)('/rate_limit')
  if (r.status === 401) throw new Error('GitHub rejected the token. Remove it or create a new fine-grained token with public repository access.')
  if (!r.ok) return { remaining: 60, limit: 60, reset: 0 }
  const core = (await r.json()).resources?.core || {}
  return { remaining: core.remaining ?? 60, limit: core.limit ?? 60, reset: core.reset || 0 }
}

/** Repository metadata: size decides the loading path, the rest feeds the viewer. */
export async function fetchRepo(repo, fetchImpl = fetch, token = '') {
  const r = await request(fetchImpl, token)(`/repos/${repo}`)
  if (r.status === 404) throw new Error('Repository not found. Browser loading supports public GitHub repositories only.')
  if (r.status === 401) throw new Error('GitHub rejected the token. Remove it or create a new fine-grained token with public repository access.')
  if (isRateLimited(r)) throw new RateLimitError(Number(r.headers.get('x-ratelimit-reset')))
  if (!r.ok) throw new Error(`GitHub API returned HTTP ${r.status}.`)
  const d = await r.json()
  return { sizeMb: Math.round((d.size || 0) / 1024), defaultRef: d.default_branch || 'main', description: String(d.description || '').replace(/\s+/g, ' ').trim().slice(0, 280), private: !!d.private }
}

/** 'api' for repositories the browser cannot clone, otherwise the requested mode. */
export function chooseMode(meta, mode = 'auto') {
  if (mode === 'api' || mode === 'clone') return mode
  return meta && meta.sizeMb > API_REPO_SIZE_MB ? 'api' : 'clone'
}

const mapFiles = files => {
  const out = []
  for (const f of files || []) {
    if (f.status === 'renamed' && f.previous_filename) out.push({ p: f.previous_filename, a: 0, d: 0, s: 'D' })
    out.push({ p: f.filename, a: f.additions || 0, d: f.deletions || 0, ...(f.status === 'removed' ? { s: 'D' } : {}) })
  }
  return out
}

/** Non-merge commits with per-file line counts, newest first from the API, returned oldest first. */
export async function collectApiCommits({ repo, ref = '', maxCommits = 300, token = '', fetchImpl = fetch, onProgress = () => {}, signal } = {}) {
  const get = request(fetchImpl, token)
  const budget = await rateBudget(fetchImpl, token)
  let allowance = budget.remaining - RESERVE
  if (allowance < 3) throw new RateLimitError(budget.reset)
  const heads = []
  let page = 1, hasMore = false, rateLimited = false
  onProgress({ pct: 5, detail: 'Listing commits…' })
  while (heads.length < maxCommits) {
    if (allowance < 1) { rateLimited = true; break }
    const r = await get(`/repos/${repo}/commits?per_page=100&page=${page}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`, signal)
    allowance--
    if (isRateLimited(r)) { rateLimited = true; break }
    if (r.status === 404 || r.status === 422) throw new Error(page === 1 ? 'This repository is empty or the selected branch does not exist.' : 'GitHub stopped listing this history early.')
    if (r.status === 409) throw new Error('This repository is empty.')
    if (!r.ok) throw new Error(`GitHub API returned HTTP ${r.status} while listing commits.`)
    const list = await r.json()
    for (const c of list) {
      if (heads.length >= maxCommits) { hasMore = true; break }
      heads.push({ sha: c.sha, merge: (c.parents || []).length > 1 })
    }
    onProgress({ pct: 5 + Math.min(20, heads.length / maxCommits * 20), detail: `Listing commits · ${heads.length}` })
    if (list.length < 100) break
    page++
    if (heads.length >= maxCommits) { hasMore = true; break }
  }
  if (!heads.length) throw new Error(rateLimited ? new RateLimitError(budget.reset).message : 'No commits found on this branch.')
  const targets = heads.filter(h => !h.merge)
  // Details cost one request each; stop cleanly at the budget and say so.
  const commits = [], errors = []
  let next = 0, done = 0, truncated = 0
  const worker = async () => {
    while (next < targets.length) {
      if (signal?.aborted) return
      if (allowance < 1) { rateLimited = true; return }
      const i = next++
      allowance--
      const r = await get(`/repos/${repo}/commits/${targets[i].sha}`, signal)
      if (isRateLimited(r)) { rateLimited = true; allowance = 0; return }
      if (!r.ok) { errors.push(r.status); continue }
      const d = await r.json()
      if (d.files && d.files.length >= 300) truncated++ // GitHub lists at most 300 files per commit
      const files = mapFiles(d.files)
      if (files.length) commits.push({ hash: d.sha, ts: Math.floor(new Date(d.commit.committer?.date || d.commit.author.date).getTime() / 1000), name: d.commit.author.name, email: d.commit.author.email || '', subject: (d.commit.message || '').split('\n')[0], files })
      done++
      onProgress({ pct: 25 + done / targets.length * 68, detail: `Reading changes · ${done} / ${targets.length} commits` })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
  if (!commits.length) throw new Error(rateLimited ? new RateLimitError(budget.reset).message : errors.length ? `GitHub API returned HTTP ${errors[0]} while reading commits.` : 'No file changes found in this history. Try a different branch or more commits.')
  commits.sort((a, b) => a.ts - b.ts)
  return { commits, hasMore: hasMore || rateLimited, rateLimited, truncated, requestsUsed: budget.remaining - RESERVE - allowance, remaining: Math.max(0, allowance + RESERVE), limit: budget.limit, reset: budget.reset }
}
