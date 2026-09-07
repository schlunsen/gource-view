// GitHub trending across several windows. github.com/trending has no official
// API but serves daily/weekly/monthly lists; longer windows come from the
// search API (most-starred repositories created in the window). Refreshed
// once a day and cached on disk so restarts keep it.
import fs from 'node:fs'

export const REFRESH_MS = 24 * 3600000
const UA = 'gource-viewer (+https://github.com/Lunar-Rails/n0-app-skill)'

export const PERIODS = [
  { id: 'daily', label: 'Today', short: 'today', since: 'daily', days: 1 },
  { id: 'weekly', label: 'This week', short: 'this week', since: 'weekly', days: 7 },
  { id: 'monthly', label: 'This month', short: 'this month', since: 'monthly', days: 30 },
  { id: 'quarter', label: '3 months', short: 'in the last 3 months', days: 90 },
  { id: 'year', label: 'This year', short: 'in the last year', days: 365 },
]

const num = s => Number(String(s || '0').replace(/[^\d]/g, '')) || 0
const text = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const headers = (accept, token) => ({ 'User-Agent': UA, Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) })

/** Parse a trending page into [{ name, description, language, gained, stars }]. */
export function parseTrending(html) {
  const out = []
  for (const article of String(html).split('<article class="Box-row">').slice(1)) {
    const name = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"?#]+)"/)?.[1]?.trim()
    if (!name || !/^[\w.-]+\/[\w.-]+$/.test(name)) continue
    out.push({
      name,
      description: text(article.match(/<p class="[^"]*col-9[^"]*">([\s\S]*?)<\/p>/)?.[1]).slice(0, 160),
      language: article.match(/itemprop="programmingLanguage">([^<]+)</)?.[1]?.trim() || '',
      gained: num(article.match(/([\d,]+)\s+stars (?:today|this week|this month)/)?.[1]),
      stars: num(article.match(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1]),
    })
  }
  return out
}

export async function fetchTrendingPage(fetchImpl = fetch, since = 'weekly') {
  const r = await fetchImpl(`https://github.com/trending?since=${since}`, { headers: headers('text/html'), signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`trending page ${r.status}`)
  const repos = parseTrending(await r.text())
  if (repos.length < 5) throw new Error('trending page changed shape')
  return repos
}

/** Most-starred repositories created in the last `days` days. */
export async function fetchTrendingFallback(fetchImpl = fetch, days = 7, token = '') {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const r = await fetchImpl(`https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=25`, { headers: headers('application/vnd.github+json', token), signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`search api ${r.status}`)
  const d = await r.json()
  return (d.items || []).map(i => ({ name: i.full_name, description: (i.description || '').slice(0, 160), language: i.language || '', gained: i.stargazers_count, stars: i.stargazers_count, sizeMb: Math.round((i.size || 0) / 1024) }))
}

/** One window: the trending page when GitHub offers it, otherwise search. */
export async function fetchPeriod(period, fetchImpl = fetch, token = '') {
  if (period.since) {
    try { return { source: 'github.com/trending', repos: await fetchTrendingPage(fetchImpl, period.since) } }
    catch { /* fall through to search */ }
  }
  return { source: `search · created ${period.short}`, repos: await fetchTrendingFallback(fetchImpl, period.days, token) }
}

/** Repository sizes (MB) so the UI can warn about heavy clones; best effort, one lookup per distinct repo. */
export async function annotateSizes(repos, fetchImpl = fetch, token = '') {
  const byName = new Map()
  for (const r of repos) if (r.sizeMb == null) (byName.get(r.name) || byName.set(r.name, []).get(r.name)).push(r)
  await Promise.all([...byName].map(async ([name, entries]) => {
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${name}`, { headers: headers('application/vnd.github+json', token), signal: AbortSignal.timeout(15000) })
      if (r.ok) { const mb = Math.round(((await r.json()).size || 0) / 1024); for (const e of entries) e.sizeMb = mb }
    } catch { /* leave unknown */ }
  }))
  return repos
}

/** Every window, sequentially (polite to github.com), sizes looked up once across windows. Windows that fail are omitted. */
export async function fetchAllPeriods(fetchImpl = fetch, token = '') {
  const periods = {}
  for (const p of PERIODS) {
    try { periods[p.id] = await fetchPeriod(p, fetchImpl, token) } catch { /* omitted */ }
  }
  if (!Object.keys(periods).length) throw new Error('no trending window could be fetched')
  await annotateSizes(Object.values(periods).flatMap(p => p.repos), fetchImpl, token)
  return { fetchedAt: Date.now(), periods }
}

export function createTrendingStore({ file = '/tmp/gource-trending.json', fetchImpl = fetch, refreshMs = REFRESH_MS, token = process.env.GITHUB_TOKEN || '' } = {}) {
  let state = { fetchedAt: 0, periods: {} }
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s.periods) state = s } catch { /* cold start, or the old single-window cache */ }
  let inflight = null
  async function refresh() {
    state = await fetchAllPeriods(fetchImpl, token)
    try { fs.writeFileSync(file, JSON.stringify(state)) } catch { /* cache is optional */ }
    return state
  }
  const empty = () => !Object.keys(state.periods).length
  return {
    async get() {
      const stale = Date.now() - state.fetchedAt > refreshMs
      if (stale && !inflight) inflight = refresh().catch(() => state).finally(() => { inflight = null })
      if (empty() && inflight) await inflight // first request waits; later ones serve stale data while refreshing
      return state
    },
    refresh,
  }
}
