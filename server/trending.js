// GitHub "trending this week": scraped from github.com/trending (there is no
// official API), refreshed once a day, cached on disk so restarts keep it,
// with the search API as a fallback when the page cannot be parsed.
import fs from 'node:fs'

export const REFRESH_MS = 24 * 3600000
const UA = 'gource-viewer (+https://github.com/Lunar-Rails/n0-app-skill)'

const num = s => Number(String(s || '0').replace(/[^\d]/g, '')) || 0
const text = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** Parse the trending page HTML into [{ name, description, language, starsWeek, stars }]. */
export function parseTrending(html) {
  const out = []
  for (const article of String(html).split('<article class="Box-row">').slice(1)) {
    const name = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"?#]+)"/)?.[1]?.trim()
    if (!name || !/^[\w.-]+\/[\w.-]+$/.test(name)) continue
    out.push({
      name,
      description: text(article.match(/<p class="[^"]*col-9[^"]*">([\s\S]*?)<\/p>/)?.[1]).slice(0, 160),
      language: article.match(/itemprop="programmingLanguage">([^<]+)</)?.[1]?.trim() || '',
      starsWeek: num(article.match(/([\d,]+)\s+stars this week/)?.[1]),
      stars: num(article.match(/\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1]),
    })
  }
  return out
}

export async function fetchTrendingPage(fetchImpl = fetch) {
  const r = await fetchImpl('https://github.com/trending?since=weekly', { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`trending page ${r.status}`)
  const repos = parseTrending(await r.text())
  if (repos.length < 5) throw new Error('trending page changed shape')
  return repos
}

/** Fallback: most-starred repositories created in the last 7 days. */
export async function fetchTrendingFallback(fetchImpl = fetch) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const r = await fetchImpl(`https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=25`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error(`search api ${r.status}`)
  const d = await r.json()
  return (d.items || []).map(i => ({ name: i.full_name, description: (i.description || '').slice(0, 160), language: i.language || '', starsWeek: i.stargazers_count, stars: i.stargazers_count, sizeMb: Math.round((i.size || 0) / 1024) }))
}

/** Repository sizes (MB) so the UI can warn about heavy clones; best effort. */
export async function annotateSizes(repos, fetchImpl = fetch) {
  await Promise.all(repos.map(async repo => {
    if (repo.sizeMb != null) return
    try {
      const r = await fetchImpl(`https://api.github.com/repos/${repo.name}`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
      if (r.ok) repo.sizeMb = Math.round(((await r.json()).size || 0) / 1024)
    } catch { /* leave unknown */ }
  }))
  return repos
}

export function createTrendingStore({ file = '/tmp/gource-trending.json', fetchImpl = fetch, refreshMs = REFRESH_MS } = {}) {
  let state = { fetchedAt: 0, source: '', repos: [] }
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* cold start */ }
  let inflight = null
  async function refresh() {
    let repos, source = 'github.com/trending'
    try { repos = await fetchTrendingPage(fetchImpl) } catch { repos = await fetchTrendingFallback(fetchImpl); source = 'search (new this week)' }
    await annotateSizes(repos, fetchImpl)
    state = { fetchedAt: Date.now(), source, repos }
    try { fs.writeFileSync(file, JSON.stringify(state)) } catch { /* cache is optional */ }
    return state
  }
  return {
    async get() {
      const stale = Date.now() - state.fetchedAt > refreshMs
      if (stale && !inflight) inflight = refresh().catch(() => state).finally(() => { inflight = null })
      if (!state.repos.length && inflight) await inflight // first request waits; later ones serve stale data while refreshing
      return state
    },
    refresh,
  }
}
