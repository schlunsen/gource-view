// Optional repository metadata must never prevent history from loading.
export function shortDescription(value) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 300 ? text.slice(0, 299).trimEnd() + '…' : text
}

export function createDescriptionLoader({ fetchImpl = fetch, githubToken = '', giteaLookup = null } = {}) {
  const cache = new Map()
  return async ({ source, repo }) => {
    if (!['github', 'gitea'].includes(source) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return ''
    const key = `${source}:${repo.toLowerCase()}`
    const hit = cache.get(key)
    if (hit && Date.now() < hit.until) return hit.promise
    const entry = { until: Date.now() + 86400000 }
    entry.promise = (async () => {
      try {
        if (source === 'gitea') return shortDescription(await giteaLookup?.(repo))
        const response = await fetchImpl(`https://api.github.com/repos/${repo.split('/').map(encodeURIComponent).join('/')}`, {
          headers: { Accept: 'application/vnd.github+json', ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}) },
          redirect: 'error', signal: AbortSignal.timeout(4000),
        })
        if (!response.ok) throw new Error('Metadata unavailable')
        return shortDescription((await response.json()).description)
      } catch { entry.until = Date.now() + 60000; return '' }
    })()
    if (cache.size >= 500) cache.delete(cache.keys().next().value)
    cache.set(key, entry)
    return entry.promise
  }
}
