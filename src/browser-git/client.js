import { cachedHistory, saveHistory, historyKey } from './cache.js'
// Keep heavy Git/diff code in the worker; this module only manages jobs and storage.
const jobs = new Map()
window.addEventListener('pagehide', () => { for (const state of jobs.values()) state.cancel() })
export function startBrowserLoad(repo, options = {}) {
  const job = `browser-${crypto.randomUUID()}`, database = `gource-clone-${crypto.randomUUID()}`
  const state = { ok: true, status: 'loading', progress: { pct: 1, detail: 'Checking saved history…' } }
  jobs.set(job, state)
  let worker, timeout, cancelled = false
  const cleanup = () => {
    clearTimeout(timeout); worker?.terminate()
    try { indexedDB.deleteDatabase(database); indexedDB.deleteDatabase(database + '_lock') } catch { /* storage may be unavailable */ }
  }
  state.cancel = () => { cancelled = true; cleanup(); jobs.delete(job) }
  const key = historyKey(repo, options.ref, options.maxCommits)
  void (async () => {
    const cached = !options.refresh && await cachedHistory(key)
    if (cancelled) return
    if (cached) { Object.assign(state, { status: 'done', result: cached }); return }
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    timeout = setTimeout(() => { Object.assign(state, { status: 'error', error: 'This repository is taking too long. Try fewer commits.' }); cleanup() }, 8 * 60 * 1000)
    worker.onerror = () => { Object.assign(state, { status: 'error', error: 'The browser Git worker stopped. Try fewer commits or reload the page.' }); cleanup() }
    worker.onmessage = async ({ data }) => {
      if (cancelled) return
      if (data.status === 'done') {
        cleanup()
        const saved = await saveHistory(key, data.result)
        if (cancelled) return
        data.result.browser.saved = saved
      } else if (data.status === 'error') cleanup()
      if (data.progress) data.progress.pct = Math.max(state.progress?.pct || 0, data.progress.pct)
      Object.assign(state, data)
    }
    worker.postMessage({ repo, ...options, database, proxy: import.meta.env.VITE_GIT_PROXY || 'https://cors.isomorphic-git.org' })
  })().catch(e => { if (!cancelled) { Object.assign(state, { status: 'error', error: e.message }); cleanup() } })
  return { job, static: true }
}
export function browserStatus(job) {
  const state = jobs.get(job)
  if (!state) return { ok: false, error: 'This browser load was cancelled. Try again.' }
  const { cancel: _cancel, ...status } = state
  if (state.status !== 'loading') jobs.delete(job)
  return status
}
export function cancelBrowserLoad(job) { jobs.get(job)?.cancel() }
