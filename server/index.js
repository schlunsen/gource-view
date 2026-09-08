import express from 'express'
import { installExportRoutes } from './exports.js'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { parseRepo as parseSource, authHeaders, isValidRef, jobKeyFor } from './sources.js'
import { makeLimiter, clientIp, isPrivateAddress, planEviction } from './limits.js'
import { createTrendingStore } from './trending.js'
import { run, collectCommits, summarize } from './history.js'
import { createDescriptionLoader } from './repo-description.js'
import { musicTrack } from './music.js'
import dns from 'node:dns'

const app = express()
// ── public-instance hardening ──────────────────────────────────────────────
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://gravatar.com; media-src 'self' blob:; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'self'")
  next()
})
app.use('/api/exports', express.json({ limit: '40mb' })) // custom export music arrives base64 in the body
app.use(express.json({ limit: '256kb' }))
const loadLimiter = makeLimiter({ max: Number(process.env.LOAD_LIMIT_PER_HOUR || 30), windowMs: 3600000 })
const exportLimiter = makeLimiter({ max: Number(process.env.EXPORT_LIMIT_PER_HOUR || 4), windowMs: 3600000 })
const limited = (limiter, what) => (req, res, next) => {
  const r = limiter.take(clientIp(req))
  if (r.ok) return next()
  res.setHeader('Retry-After', String(r.retryAfter))
  res.status(429).json({ error: `Too many ${what} from this address. Try again in ${Math.ceil(r.retryAfter / 60)} min.` })
}
app.use('/api/exports', (req, res, next) => (req.method === 'POST' ? limited(exportLimiter, 'video exports')(req, res, next) : next()))
const MAX_CONCURRENT_CLONES = Number(process.env.MAX_CONCURRENT_CLONES || 3)
const CLONE_CAP_MB = Number(process.env.CLONE_CAP_MB || 1536)      // a single repository
const CACHE_CAP_MB = Number(process.env.CACHE_CAP_MB || 6144)      // the whole clone cache
app.use(express.static(path.join(process.cwd(), 'dist')))

const CACHE_DIR = '/tmp/gource-cache'
fs.mkdirSync(CACHE_DIR, { recursive: true })

const jobs = new Map()

// ── Sources: public GitHub, plus an optional authenticated Gitea instance ──
// GITEA_URL + GITEA_TOKEN enable Gitea; GITEA_ORG narrows the picker to one org.
const GITEA_URL = (process.env.GITEA_URL || '').trim().replace(/\/+$/, '')
const GITEA_TOKEN = (process.env.GITEA_TOKEN || '').trim()
const DEFAULT_REPO = (process.env.DEFAULT_REPO || '').trim() || 'expressjs/express'
const gitea = GITEA_URL && GITEA_TOKEN ? {
  url: GITEA_URL,
  host: new URL(GITEA_URL).host.toLowerCase(),
  org: (process.env.GITEA_ORG || '').trim(),
  label: (process.env.GITEA_LABEL || '').trim() || new URL(GITEA_URL).host,
} : null

const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim()
const GITLAB_TOKEN = (process.env.GITLAB_TOKEN || '').trim()
const GITLAB_HOST = (process.env.GITLAB_HOST || 'gitlab.com').trim().toLowerCase()
function parseRepo(raw) { return parseSource(raw, gitea) }

// git child env. Tokens travel as URL-scoped extra headers so they never
// appear in argv, remotes, or error output — and never reach another host.
function gitEnv(job) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
  delete env.GITEA_TOKEN; delete env.GITHUB_TOKEN; delete env.GITLAB_TOKEN
  return { ...env, ...authHeaders(job, { gitea, giteaToken: GITEA_TOKEN, githubToken: GITHUB_TOKEN, gitlabToken: GITLAB_TOKEN, gitlabHost: GITLAB_HOST }) }
}

async function giteaApi(p) {
  const r = await fetch(`${gitea.url}/api/v1${p}`, { headers: { Authorization: `token ${GITEA_TOKEN}` }, signal: AbortSignal.timeout(10000) })
  if (!r.ok) throw new Error(`Gitea API responded ${r.status}`)
  return r.json()
}

const repositoryDescription = createDescriptionLoader({ githubToken: GITHUB_TOKEN, giteaLookup: async repo => (await giteaApi(`/repos/${repo.split('/').map(encodeURIComponent).join('/')}`)).description })

let giteaRepoCache = { at: 0, promise: null }
function listGiteaRepos() {
  if (giteaRepoCache.promise && Date.now() - giteaRepoCache.at < 60000) return giteaRepoCache.promise
  const promise = (async () => {
    const out = []
    for (let page = 1; page <= 10; page++) {
      const batch = gitea.org
        ? await giteaApi(`/orgs/${encodeURIComponent(gitea.org)}/repos?limit=50&page=${page}`)
        : (await giteaApi(`/repos/search?limit=50&page=${page}&sort=updated&order=desc`)).data
      for (const r of batch) if (!r.empty) out.push({ name: r.full_name, description: r.description || '', updatedAt: r.updated_at, private: !!r.private, sizeKb: r.size || 0 })
      if (batch.length < 50) break
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  })()
  promise.catch(() => { giteaRepoCache = { at: 0, promise: null } })
  giteaRepoCache = { at: Date.now(), promise }
  return promise
}



// One clone per repository directory at a time; other jobs for the same
// repository wait for it instead of racing into the same folder.
const dirLocks = new Map()
async function withDirLock(dirKey, fn) {
  while (dirLocks.has(dirKey)) await dirLocks.get(dirKey).catch(() => {})
  const p = fn().finally(() => dirLocks.delete(dirKey))
  dirLocks.set(dirKey, p)
  return p
}
const FETCH_AFTER = 10 * 60000
async function refreshClone(dir) {
  // refresh a cached clone at most every 10 minutes; failures keep the old history
  const stamp = path.join(dir, '.git', 'FETCH_HEAD')
  const age = fs.existsSync(stamp) ? Date.now() - fs.statSync(stamp).mtimeMs : Infinity
  if (age < FETCH_AFTER) return false
  try { await run('git', ['fetch', '--quiet', '--prune', 'origin'], { cwd: dir, timeout: 120000 }); return true } catch { return false }
}
async function listRefs(dir) {
  const { stdout } = await run('git', ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', 'refs/remotes/origin'], { cwd: dir })
  // origin/HEAD shortens to plain "origin" — it is an alias, not a branch
  const refs = stdout.split('\n').map(r => r.trim()).filter(r => r.startsWith('origin/') && !r.endsWith('/HEAD')).map(r => r.slice('origin/'.length)).slice(0, 200)
  let defaultRef = refs[0] || 'HEAD'
  try { defaultRef = (await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: dir })).stdout.trim().replace(/^origin\//, '') || defaultRef } catch { /* detached or missing */ }
  return { refs, defaultRef }
}
// parsed histories keyed by (dir, ref, limit, tip) — the tip sha invalidates them when a branch moves
const logCache = new Map()
function remember(key, value) { logCache.delete(key); logCache.set(key, value); while (logCache.size > 12) logCache.delete(logCache.keys().next().value) }

// The host name was vetted syntactically; make sure it does not *resolve* to
// anything private either (the configured Gitea instance is trusted config).
async function assertPublicHost(job) {
  if (job.source === 'gitea') return
  const host = new URL(job.url).hostname
  let addrs
  try { addrs = await dns.promises.lookup(host, { all: true }) } catch { throw new Error(`Could not resolve ${host}.`) }
  if (!addrs.length || addrs.some(a => isPrivateAddress(a.address))) throw new Error(`${host} is not a public host.`)
}
async function repoBytes(dir) {
  try {
    const { stdout } = await run('git', ['count-objects', '-v'], { cwd: dir, timeout: 30000 })
    let kb = 0
    for (const line of stdout.split('\n')) { const m = line.match(/^(size|size-pack): (\d+)/); if (m) kb += Number(m[2]) }
    return kb * 1024
  } catch { return 0 }
}
let activeClones = 0
async function evictCache() {
  const entries = []
  for (const key of fs.readdirSync(CACHE_DIR)) {
    const dir = path.join(CACHE_DIR, key)
    try { if (!fs.statSync(dir).isDirectory()) continue } catch { continue }
    entries.push({ key, bytes: await repoBytes(dir), mtime: fs.statSync(dir).mtimeMs, busy: dirLocks.has(key) })
  }
  for (const key of planEviction(entries, CACHE_CAP_MB * 1024 * 1024)) {
    fs.rmSync(path.join(CACHE_DIR, key), { recursive: true, force: true })
    for (const k of [...logCache.keys()]) if (k.startsWith(key + '|')) logCache.delete(k)
  }
}

async function processJob(job, opts) {
  const dir = path.join(CACHE_DIR, job.dirKey)
  const description = repositoryDescription(job)
  try {
   await withDirLock(job.dirKey, async () => {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      await assertPublicHost(job)
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true, mode: 0o777 })
      job.progress = { pct: 2, detail: 'Cloning…' }
      // limited loads clone shallowly (all branches, depth just past the limit); 'All' clones fully
      const depthArgs = opts.maxCommits > 0 ? [`--depth=${opts.maxCommits + 50}`, '--no-single-branch'] : []
      activeClones++
      const child = spawn('git', ['clone', '--quiet', '--progress', ...depthArgs, job.url, dir], { env: gitEnv(job) })
      let buf = ''
      child.stderr.on('data', d => {
        buf += d.toString()
        const m = [...buf.matchAll(/(\d+)% \(([\d,]+)\/([\d,]+)\)/g)].pop()
        if (m) job.progress = { pct: Math.max(2, Math.min(85, parseInt(m[1], 10))), detail: `Downloading objects… ${m[2]}/${m[3]}` }
        else if (buf.includes('Receiving objects')) job.progress = { pct: Math.max(job.progress.pct, 3), detail: 'Receiving objects…' }
        else if (buf.includes('Resolving deltas')) job.progress = { pct: 88, detail: 'Resolving deltas…' }
      })
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('clone timed out after 5 min')) }, 300000)
          child.on('close', code => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('clone failed: ' + buf.slice(-300))) })
          child.on('error', e => { clearTimeout(t); reject(e) })
        })
      } finally { activeClones-- }
      const bytes = await repoBytes(dir)
      if (bytes > CLONE_CAP_MB * 1024 * 1024) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`This repository is too large for this instance (${Math.round(bytes / 1048576)} MB > ${CLONE_CAP_MB} MB). Try a smaller commit limit.`) }
      job.progress = { pct: 92, detail: 'Clone complete' }
      evictCache().catch(() => {})
    } else {
      job.progress = { pct: 88, detail: 'Refreshing cached clone…' }
      await refreshClone(dir)
      job.progress = { pct: 90, detail: 'Using cached clone' }
    }
   })
    job.status = 'parsing'
    job.progress = { pct: 93, detail: 'Listing branches…' }
    const { refs, defaultRef } = await listRefs(dir)
    const ref = opts.ref || defaultRef
    if (opts.ref && !refs.includes(opts.ref)) throw new Error(`Branch "${opts.ref}" was not found. Available: ${refs.slice(0, 8).join(', ')}${refs.length > 8 ? '…' : ''}`)
    const gitRef = refs.includes(ref) ? `origin/${ref}` : 'HEAD'
    const tip = (await run('git', ['rev-parse', gitRef], { cwd: dir })).stdout.trim()
    const cacheKey = `${job.dirKey}|${ref}|${opts.maxCommits}|${tip}`
    job.progress = { pct: 94, detail: 'Reading commit history…' }
    let commits = logCache.get(cacheKey)
    if (!commits) { commits = await collectCommits(dir, { maxCommits: opts.maxCommits, ref: gitRef }); remember(cacheKey, commits) }
    job.progress = { pct: 99, detail: 'Building tree…' }
    job.result = summarize(commits, { description: await description, repo: job.repo, source: job.source, sourceUrl: job.url.replace(/\.git$/, ''), ref, refs, defaultRef, maxCommits: opts.maxCommits })
    job.status = 'done'
    job.progress = { pct: 100, detail: `Ready — ${commits.length} commits` }
  } catch (e) {
    job.status = 'error'
    job.error = e.message
  }
}

const trending = createTrendingStore()
app.get('/api/trending', async (_req, res) => {
  try { const t = await trending.get(); res.json({ fetchedAt: t.fetchedAt, periods: t.periods }) }
  catch (e) { res.status(502).json({ error: `Trending is unavailable right now: ${e.message}` }) }
})
setTimeout(() => trending.get().catch(() => {}), 5000) // warm the cache shortly after boot

app.get('/api/music/:id/file', (req, res) => {
  const track = musicTrack(String(req.params.id))
  if (!track) return res.status(404).json({ error: 'unknown track' })
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(track.path)
})

app.get('/api/config', (_req, res) => {
  res.json({ defaultRepo: DEFAULT_REPO, gitea: gitea ? { label: gitea.label, org: gitea.org, url: gitea.url } : null })
})

app.get('/api/gitea/repos', async (_req, res) => {
  if (!gitea) return res.status(404).json({ error: 'No Gitea instance is configured.' })
  try { res.json({ repos: await listGiteaRepos() }) }
  catch (e) { res.status(502).json({ error: `Could not list ${gitea.label} repositories: ${e.message}` }) }
})

app.post('/api/load', limited(loadLimiter, 'repository loads'), (req, res) => {
  const raw = String(req.body?.repo || '').trim()
  const opts = { maxCommits: Number(req.body?.options?.maxCommits ?? 3000), ref: req.body?.options?.ref ? String(req.body.options.ref) : '' }
  if (![0, 300, 1000, 1500, 3000].includes(opts.maxCommits)) return res.status(400).json({ error: 'Choose a supported commit limit.' })
  if (opts.ref && !isValidRef(opts.ref)) return res.status(400).json({ error: 'That branch name is not valid.' })
  const parsed = parseRepo(raw)
  if (!parsed) {
    const hint = gitea ? `Use owner/repo, a GitHub URL, a ${gitea.label} URL, or any https git URL.` : 'Use owner/repo, a GitHub URL, or any https git URL (GitLab, Bitbucket, …).'
    return res.status(400).json({ error: `Could not parse repo from "${raw}". ${hint}` })
  }
  const { source, repo, url } = parsed
  // shallow clones are sized to the limit, so each limit (and 'All') keeps its own clone
  const dirKey = jobKeyFor(source, repo) + (opts.maxCommits > 0 ? `--d${opts.maxCommits}` : '--full')
  const key = jobKeyFor(source, repo, opts) // path-safe: the client polls /api/status/<key>
  if (!fs.existsSync(path.join(CACHE_DIR, dirKey, '.git')) && activeClones >= MAX_CONCURRENT_CLONES) {
    res.setHeader('Retry-After', '30')
    return res.status(429).json({ error: 'The server is busy cloning other repositories. Try again in a moment.' })
  }
  const existing = jobs.get(key)
  if (existing && (existing.status === 'cloning' || existing.status === 'parsing')) {
    return res.json({ job: key, status: existing.status, cached: true })
  }
  const job = { key, dirKey, repo, source, url, status: 'cloning', progress: { pct: 0, detail: 'Starting…' }, error: null, result: null }
  jobs.set(key, job)
  processJob(job, opts)
  res.json({ job: key, status: job.status, cached: false })
})

app.get('/api/status/:key', (req, res) => {
  const job = jobs.get(req.params.key)
  if (!job) return res.status(404).json({ error: 'unknown job' })
  if (job.status === 'done') res.json({ status: 'done', progress: job.progress, error: job.error, result: job.result })
  else if (job.status === 'error') res.json({ status: 'error', progress: job.progress, error: job.error })
  else res.json({ status: job.status, progress: job.progress, error: job.error })
})

installExportRoutes(app, jobs, () => `http://127.0.0.1:${server.address().port}`)

const server = createServer(app)
const port = process.env.PORT || 8790

// Never let one bad job take down the whole server
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.message)
})
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.message)
})

server.listen(port, () => console.log(`[gource-viewer] backend on :${port}` + (gitea ? ` · Gitea source: ${gitea.label}` : '')))
