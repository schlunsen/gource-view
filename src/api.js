// Static hosting supports prebuilt examples and Git history processed on-device.
import { cachedHistory, historyKey } from './browser-git/cache.js'
import { parseRepository, browserLimit } from './browser-git/options.js'
export const STATIC = import.meta.env.VITE_STATIC === '1'
export const BASE = import.meta.env.BASE_URL || '/'
export const REPO_URL = import.meta.env.VITE_REPO_URL || 'https://github.com'

let indexPromise = null
const demoIndex = () => (indexPromise ||= json(`${BASE}data/index.json`).catch(e => { indexPromise = null; throw e }))

async function json(url, options) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(d.error || `${url} → ${r.status}`); e.status = r.status; throw e }
  return d
}

export async function getConfig() {
  if (!STATIC) return json('/api/config')
  const idx = await demoIndex().catch(() => ({ demos: [] }))
  return { defaultRepo: idx.demos[0]?.name || '', gitea: null, static: true, demos: idx.demos, builtAt: idx.builtAt }
}

/** Start a server job, prebuilt example, or browser worker job. */
export async function startLoad(repo, options) {
  if (!STATIC) return json('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, options }) })
  const name = parseRepository(repo), maxCommits = browserLimit(options?.maxCommits ?? 300)
  const idx = await demoIndex().catch(() => ({ demos: [] }))
  const demo = idx.demos.find(d => d.name.toLowerCase() === name.toLowerCase())
  if (demo && maxCommits === 300 && !options?.ref && !options?.refresh && !await cachedHistory(historyKey(name, '', maxCommits))) return { job: demo.slug, static: true }
  const { startBrowserLoad } = await import('./browser-git/client.js')
  return startBrowserLoad(name, { ...options, maxCommits })
}

export async function pollStatus(job) {
  if (!STATIC) {
    const r = await fetch('/api/status/' + encodeURIComponent(job), { signal: AbortSignal.timeout(15000) })
    const s = await r.json()
    return { ok: r.ok, ...s }
  }
  if (job.startsWith('browser-')) return (await import('./browser-git/client.js')).browserStatus(job)
  const result = await json(`${BASE}data/${job}.json`)
  return { ok: true, status: 'done', result: { ...result, prebuilt: true } }
}

export async function musicTracks() {
  const d = STATIC ? await json(`${BASE}data/music.json`) : await json('/api/music')
  return d.tracks || []
}
export const musicFileUrl = id => STATIC ? `${BASE}music/${encodeURIComponent(id)}.mp3` : `/api/music/${encodeURIComponent(id)}/file`
export const trending = () => STATIC ? json(`${BASE}data/trending.json`).catch(e => { throw new Error(e.status === 404 ? 'Trending is not available in this build.' : e.message) }) : json('/api/trending')
export const giteaRepos = () => STATIC ? Promise.resolve({ repos: [] }) : json('/api/gitea/repos')

export async function cancelJob(job) {
  if (STATIC && job?.startsWith('browser-')) (await import('./browser-git/client.js')).cancelBrowserLoad(job)
}
