import { Buffer } from 'buffer'
import * as git from 'isomorphic-git'
import webHttp from 'isomorphic-git/http/web'
import LightningFS from '@isomorphic-git/lightning-fs'
import { collectBrowserCommits } from './history.js'
import { parseRepository, browserLimit } from './options.js'
import { summarize } from '../history-summary.js'

globalThis.Buffer = Buffer

const MAX_DOWNLOAD = 100 * 1024 * 1024
self.onmessage = async ({ data }) => {
  const report = progress => self.postMessage({ status: 'loading', progress })
  try {
    const repo = parseRepository(data.repo), limit = browserLimit(data.maxCommits)
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
    let description = ''
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}`, { credentials: 'omit', signal: AbortSignal.timeout(5000) })
      if (r.ok) description = String((await r.json()).description || '').replace(/\s+/g, ' ').trim().slice(0, 280)
    } catch { /* optional metadata */ }
    const result = summarize(history.commits, { repo, source: 'github', sourceUrl: `https://github.com/${repo}`, description, ref, refs: branches, defaultRef, maxCommits: limit, browser: { cached: false, hasMore: history.hasMore, countsOmitted: history.countsOmitted, downloadedBytes: received } })
    self.postMessage({ status: 'done', result })
  } catch (e) {
    const error = e.name === 'QuotaExceededError' ? 'Browser storage is full. Clear saved histories or try fewer commits.' : /fetch|network|timeout|Load failed/i.test(e.message) ? 'Could not download Git history. Check your connection and try again, or open a ready-to-play example.' : e.message
    self.postMessage({ status: 'error', error })
  }
}
