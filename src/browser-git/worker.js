import { Buffer } from 'buffer'
import * as git from 'isomorphic-git'
import webHttp from 'isomorphic-git/http/web'
import LightningFS from '@isomorphic-git/lightning-fs'
import { collectBrowserCommits } from './history.js'
import { parseRepository, browserLimit } from './options.js'
import { summarize } from '../history-summary.js'
import { fetchRepo, chooseMode, collectApiCommits, RateLimitError } from './github-api.js'
import { cloneBlobless } from './blobless.js'

globalThis.Buffer = Buffer

const MAX_DOWNLOAD = 100 * 1024 * 1024
const CAP = /100 MB browser limit|too many Git objects/
self.onmessage = async ({ data }) => {
  const report = progress => self.postMessage({ status: 'loading', progress })
  try {
    const repo = parseRepository(data.repo), limit = browserLimit(data.maxCommits), token = data.token || ''
    report({ pct: 2, detail: 'Checking repository…' })
    let meta = null
    // Metadata is optional: a rate-limited or offline API must not block a clone, which needs no API at all.
    try { meta = await fetchRepo(repo, fetch, token) } catch (e) { if (/not found|rejected the token/.test(e.message)) throw e }
    if (meta?.private) throw new Error('Browser loading supports public GitHub repositories only.')
    const done = result => self.postMessage({ status: 'done', result })
    const tooBig = chooseMode(meta, 'auto') === 'api'
    const size = meta ? `${meta.sizeMb.toLocaleString()} MB repository` : 'large repository'
    if (data.mode === 'api') { done(await apiHistory({ repo, limit, token, meta, ref: data.ref, report, reason: 'requested' })); return }
    if (data.mode === 'blobless' || (tooBig && data.mode !== 'clone')) {
      try { done(await bloblessHistory({ repo, limit, meta, data, report, reason: size })); return }
      catch (e) {
        if (data.mode === 'blobless') throw e
        report({ pct: 4, detail: 'Partial clone unavailable · switching to the GitHub API…' })
        done(await apiHistory({ repo, limit, token, meta, ref: data.ref, report, reason: size })); return
      }
    }
    try { done(await cloneHistory({ repo, limit, meta, data, report })) }
    catch (e) {
      if (data.mode === 'clone' || !CAP.test(e.message)) throw e
      report({ pct: 4, detail: 'Too large to clone in full · fetching history without file contents…' })
      try { done(await bloblessHistory({ repo, limit, meta, data, report, reason: 'too large to clone in full' })) }
      catch {
        report({ pct: 4, detail: 'Switching to the GitHub API…' })
        done(await apiHistory({ repo, limit, token, meta, ref: data.ref, report, reason: 'too large to clone in the browser' }))
      }
    }
  } catch (e) {
    const error = e.name === 'QuotaExceededError' ? 'Browser storage is full. Clear saved histories or try fewer commits.' : e instanceof RateLimitError ? e.message : /fetch|network|timeout|Load failed/i.test(e.message) ? 'Could not download Git history. Check your connection and try again, or open a ready-to-play example.' : e.message
    self.postMessage({ status: 'error', error })
  }
}

// No Git objects: commit metadata and per-file line counts straight from the API.
async function apiHistory({ repo, limit, token, meta, ref, report, reason }) {
  const defaultRef = meta?.defaultRef || 'main', branch = ref || defaultRef
  const history = await collectApiCommits({ repo, ref: branch, maxCommits: limit, token, onProgress: report })
  report({ pct: 95, detail: 'Preparing playback…' })
  return summarize(history.commits, { repo, source: 'github', sourceUrl: `https://github.com/${repo}`, description: meta?.description || '', ref: branch, refs: [...new Set([defaultRef, branch])], defaultRef, maxCommits: limit,
    browser: { cached: false, source: 'api', reason, hasMore: history.hasMore, rateLimited: history.rateLimited, countsOmitted: history.truncated, requestsUsed: history.requestsUsed, remaining: history.remaining, limit: history.limit, reset: history.reset, tokenUsed: !!token } })
}

// A partial clone: trees but no file contents, so every commit's file list is
// exact while the download stays small. Line counts need blobs, so they are
// reported as unavailable rather than guessed.
async function bloblessHistory({ repo, limit, meta, data, report, reason }) {
  const fs = new LightningFS(data.database), dir = '/repo'
  await fs.promises.mkdir(dir).catch(() => {})
  const { ref, defaultRef, branches } = await cloneBlobless({
    fs, dir, url: `https://github.com/${repo}.git`, corsProxy: data.proxy, ref: data.ref,
    depth: limit + 1, maxBytes: MAX_DOWNLOAD, onProgress: report,
  })
  const history = await collectBrowserCommits({ fs, dir, ref, maxCommits: limit, blobs: false, onProgress: report })
  if (!history.commits.length) throw new Error('No file changes found in this history. Try a different branch or more commits.')
  report({ pct: 96, detail: 'Preparing playback…' })
  return summarize(history.commits, { repo, source: 'github', sourceUrl: `https://github.com/${repo}`, description: meta?.description || '', ref, refs: branches, defaultRef, maxCommits: limit,
    browser: { cached: false, source: 'blobless', reason, hasMore: history.hasMore, linesUnavailable: true } })
}

async function cloneHistory({ repo, limit, meta, data, report }) {
  {
    const fs = new LightningFS(data.database), dir = '/repo'
    await fs.promises.mkdir(dir)
    let received = 0
    const http = { request: async args => {
      const response = await webHttp.request({ ...args, fetchOptions: { credentials: 'omit', signal: AbortSignal.timeout(120000) } })
      if (response.statusCode >= 400) throw new Error(response.statusCode === 401 || response.statusCode === 404 ? 'Repository or branch not found. Browser loading supports public GitHub repositories only.' : `Git download relay returned HTTP ${response.statusCode}. Try again shortly or open an example.`)
      const body = response.body
      return { ...response, body: (async function* () {
        for await (const chunk of body) {
          received += chunk.byteLength
          if (received > MAX_DOWNLOAD) throw new Error('The download exceeds the 100 MB browser limit. Try fewer commits or use the self-hosted app.')
          yield chunk
        }
      })() }
    } }
    const remote = { http, url: `https://github.com/${repo}.git`, corsProxy: data.proxy }
    report({ pct: 3, detail: 'Finding repository branches…' })
    const refs = await git.listServerRefs({ ...remote, symrefs: true })
    const branches = refs.filter(r => r.ref.startsWith('refs/heads/')).map(r => r.ref.slice(11)).sort()
    const defaultRef = refs.find(r => r.ref === 'HEAD')?.target?.replace(/^refs\/heads\//, '') || branches[0]
    const ref = data.ref || defaultRef
    if (!ref || !branches.includes(ref)) throw new Error('This repository is empty or the selected branch does not exist.')
    let lastReport = 0
    await git.clone({ ...remote, fs, dir, ref, singleBranch: true, noCheckout: true, noTags: true, depth: limit + 1,
      onProgress: p => {
        if (p.total > 150000) throw new Error('This repository has too many Git objects for browser loading. Try fewer commits or use the self-hosted app.')
        if (Date.now() - lastReport < 150) return
        lastReport = Date.now()
        const indexing = /index|resolv/i.test(p.phase)
        report({ pct: (indexing ? 40 : 5) + (p.total ? p.loaded / p.total : 0) * (indexing ? 24 : 34), detail: `${indexing ? 'Preparing history' : 'Downloading Git history'} · ${(received / 1024 / 1024).toFixed(1)} MB` })
      },
    })
    const history = await collectBrowserCommits({ fs, dir, maxCommits: limit, onProgress: report })
    if (!history.commits.length) throw new Error('No file changes found in this history. Try a different branch or more commits.')
    return summarize(history.commits, { repo, source: 'github', sourceUrl: `https://github.com/${repo}`, description: meta?.description || '', ref, refs: branches, defaultRef, maxCommits: limit, browser: { cached: false, source: 'clone', hasMore: history.hasMore, countsOmitted: history.countsOmitted, downloadedBytes: received } })
  }
}
