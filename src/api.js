// Backend access with a static mode for the GitHub Pages demo: there, the
// viewer reads pre-built JSON for a few repositories and the music files
// directly; loading arbitrary repositories, exports and trending need the
// self-hosted server.
export const STATIC = import.meta.env.VITE_STATIC === '1'
export const BASE = import.meta.env.BASE_URL || '/'
export const REPO_URL = import.meta.env.VITE_REPO_URL || 'https://github.com'

let indexPromise = null
const demoIndex = () => (indexPromise ||= json(`${BASE}data/index.json`).catch(e => { indexPromise = null; throw e }))
const norm = s => String(s || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')

async function json(url, options) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(d.error || `${url} → ${r.status}`); e.status = r.status; throw e }
  return d
}

export async function getConfig() {
  if (!STATIC) return json('/api/config')
  const idx = await demoIndex()
  return { defaultRepo: idx.demos[0]?.name || '', gitea: null, static: true, demos: idx.demos, builtAt: idx.builtAt }
}

/** Start a load. Returns { job } (server) or { job } for a demo slug (static). */
export async function startLoad(repo, options) {
  if (!STATIC) return json('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, options }) })
  const idx = await demoIndex()
  const demo = idx.demos.find(d => d.name.toLowerCase() === norm(repo) || d.slug === norm(repo))
  if (!demo) { const e = new Error(`This demo hosts ${idx.demos.length} pre-built repositories (${idx.demos.map(d => d.name).join(', ')}). Run Gource View yourself to load any repository — see the README.`); e.status = 404; throw e }
  return { job: demo.slug, static: true }
}

export async function pollStatus(job) {
  if (!STATIC) {
    const r = await fetch('/api/status/' + encodeURIComponent(job), { signal: AbortSignal.timeout(15000) })
    const s = await r.json()
    return { ok: r.ok, ...s }
  }
  const result = await json(`${BASE}data/${job}.json`)
  return { ok: true, status: 'done', result }
}

export async function musicTracks() {
  const d = STATIC ? await json(`${BASE}data/music.json`) : await json('/api/music')
  return d.tracks || []
}
export const musicFileUrl = id => STATIC ? `${BASE}music/${encodeURIComponent(id)}.mp3` : `/api/music/${encodeURIComponent(id)}/file`
export const trending = () => STATIC ? Promise.reject(new Error('Trending needs the server.')) : json('/api/trending')
export const giteaRepos = () => STATIC ? Promise.resolve({ repos: [] }) : json('/api/gitea/repos')
