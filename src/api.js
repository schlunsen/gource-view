// Static hosting supports prebuilt examples and Git history processed on-device.
import { cachedHistory, historyKey } from './browser-git/cache.js'
import { parseRepository, browserLimit, DEFAULT_COMMITS } from './browser-git/options.js'
export { DEFAULT_COMMITS }
export const STATIC = import.meta.env.VITE_STATIC === '1'
export const BASE = import.meta.env.BASE_URL || '/'
export const REPO_URL = import.meta.env.VITE_REPO_URL || 'https://github.com'

// Histories fetched from the history server, held between startLoad and the
// poll that collects them. One entry, taken out as it is read.
const served = new Map()
let indexPromise = null
// Always an object with a demos array, whatever came back. A host that answers
// a missing file with its own index.html rather than a 404 -- which any SPA
// fallback does, including `vite preview` -- parses as an empty object, and
// `idx.demos.find` on that took the whole viewer down with "Cannot read
// properties of undefined". A build with no demos is a normal state; a crash
// on the way to reading one is not.
const demoIndex = () => (indexPromise ||= json(`${BASE}data/index.json`)
  .then(d => ({ ...d, demos: Array.isArray(d?.demos) ? d.demos : [] }))
  .catch(e => { indexPromise = null; throw e }))

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
  const name = parseRepository(repo), maxCommits = browserLimit(options?.maxCommits ?? DEFAULT_COMMITS)
  const idx = await demoIndex().catch(() => ({ demos: [] }))
  const demo = idx.demos.find(d => d.name.toLowerCase() === name.toLowerCase())
  if (options?.prebuiltOnly) {
    if (!demo) throw new Error('This preview is unavailable in the current daily build. Please try again after the next update.')
    return { job: demo.slug, static: true }
  }
  // Prebuilt demos load instantly. Use one when nobody asked for a specific
  // depth, or when the request matches what it was baked at; an explicit deeper
  // request ("Load more history") falls through to a real clone.
  const bakedLimit = demo?.limit ?? 300
  if (demo && (maxCommits === DEFAULT_COMMITS || maxCommits === bakedLimit) && !options?.ref && !options?.refresh && !await cachedHistory(historyKey(name, '', maxCommits))) return { job: demo.slug, static: true }

  // Gitilla's history server has usually done this already, on a token with a
  // budget this page does not have, and keeps the answer -- so ask it before
  // asking the browser to clone anything. Skipped for a branch or a refresh,
  // neither of which a cached answer can honour.
  //
  // `maxCommits` is a ceiling, not a demand -- an embed passes max=3000 meaning
  // "no more than this", and torvalds/linux has rather more than 3000. Judging
  // the server's answer against that number rejected a thousand commits of
  // linux, served from cache in three milliseconds, in favour of a clone this
  // browser cannot finish: strictly worse, and slower about it. Only the
  // "Load more history" button is an actual demand for depth, and it now says
  // so; everything else takes what the server has.
  if (!options?.ref && !options?.refresh && !options?.deeper) {
    const { gitillaHistory } = await import('./browser-git/gitilla-history.js')
    const history = await gitillaHistory(name)
    if (history) {
      const job = `gitilla-${name}`
      served.set(job, history)
      return { job, static: true }
    }
  }

  const { startBrowserLoad } = await import('./browser-git/client.js')
  return startBrowserLoad(name, { ...options, maxCommits })
}

export async function pollStatus(job) {
  if (!STATIC) {
    const r = await fetch('/api/status/' + encodeURIComponent(job), { signal: AbortSignal.timeout(15000) })
    const s = await r.json()
    return { ok: r.ok, ...s }
  }
  if (job.startsWith('gitilla-')) {
    const result = served.get(job)
    served.delete(job)
    return result ? { ok: true, status: 'done', result } : { ok: false, error: 'That history is no longer in hand. Try again.' }
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
