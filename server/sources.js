// Repository sources: GitHub shorthand/URLs, an optional Gitea instance, and
// any other https git host (GitLab, Bitbucket, self-hosted). Pure helpers so
// the parsing and the SSRF guard are unit-testable.

/** Hosts we will clone from: public DNS names only — never loopback, private
 *  suffixes, or IP literals, so a crafted URL cannot reach cluster services. */
export function isSafeHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '')
  if (!h || !h.includes('.') || h.startsWith('[') || /^[\d.]+$/.test(h)) return false
  if (/\.(local|localhost|internal|lan|home|corp|svc|cluster)$/.test(h)) return false
  if (/^(localhost|metadata\.google\.internal)$/.test(h)) return false
  return /^[a-z0-9.-]+$/.test(h)
}

/**
 * Returns { source, repo, url } or null.
 *   github  owner/name, github.com URLs
 *   gitea   gitea:owner/name, the configured instance's URLs, or owner/name inside its org
 *   url     any other https host with a path, e.g. gitlab.com/group/sub/project
 */
export function parseRepo(raw, gitea = null) {
  raw = String(raw || '').trim().replace(/^git@([^:/]+):/, 'https://$1/')
  let m
  if ((m = raw.match(/^gitea:\s*([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i))) return gitea ? { source: 'gitea', repo: `${m[1]}/${m[2]}`, url: `${gitea.url}/${m[1]}/${m[2]}.git` } : null
  if ((m = raw.match(/^(?:https?:\/\/)?([^/\s@]+)\/((?:[\w.-]+\/)*[\w.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i))) {
    const host = m[1].toLowerCase(), pathName = m[2].replace(/\/+$/, '')
    const segments = pathName.split('/')
    // GitHub/Gitea repos are always owner/name; anything after (tree/…, pulls/…) is a page inside it
    const ownerName = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null
    if (host === 'github.com' || host === 'www.github.com') return ownerName ? { source: 'github', repo: ownerName, url: `https://github.com/${ownerName}.git` } : null
    if (gitea && host === gitea.host) return ownerName ? { source: 'gitea', repo: ownerName, url: `${gitea.url}/${ownerName}.git` } : null
    if (host.includes('.')) {
      if (!isSafeHost(host) || segments.length < 2 || segments.some(s => s === '.' || s === '..')) return null
      return { source: 'url', repo: `${host}/${pathName}`, url: `https://${host}/${pathName}.git` }
    }
  }
  if ((m = raw.match(/^([\w.-]+)\/([\w.-]+)$/))) {
    const inOrg = gitea && gitea.org && m[1].toLowerCase() === gitea.org.toLowerCase()
    return inOrg ? { source: 'gitea', repo: `${m[1]}/${m[2]}`, url: `${gitea.url}/${m[1]}/${m[2]}.git` } : { source: 'github', repo: `${m[1]}/${m[2]}`, url: `https://github.com/${m[1]}/${m[2]}.git` }
  }
  return null
}

/**
 * Git config entries (as GIT_CONFIG_* env) that attach credentials as
 * URL-scoped extra headers, so tokens never appear in argv, remotes or logs.
 */
export function authHeaders(job, { gitea = null, giteaToken = '', githubToken = '', gitlabToken = '', gitlabHost = 'gitlab.com' } = {}) {
  const entries = [['http.followRedirects', 'false']] // never let a public host bounce git to an internal address
  if (job.source === 'gitea' && gitea && giteaToken) entries.push([`http.${gitea.url}/.extraHeader`, `Authorization: token ${giteaToken}`])
  if (job.source === 'github' && githubToken) entries.push(['http.https://github.com/.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`])
  if (job.source === 'url' && gitlabToken && job.url.startsWith(`https://${gitlabHost}/`)) entries.push([`http.https://${gitlabHost}/.extraHeader`, `Authorization: Basic ${Buffer.from(`oauth2:${gitlabToken}`).toString('base64')}`])
  const env = {}
  if (entries.length) {
    env.GIT_CONFIG_COUNT = String(entries.length)
    entries.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v })
  }
  return env
}

/** A ref name we are willing to pass to git (no options, no traversal). */
export function isValidRef(ref) {
  return typeof ref === 'string' && /^[\w][\w./-]{0,119}$/.test(ref) && !ref.includes('..') && !ref.endsWith('.lock')
}

/** Job/cache key: URL-path safe (no '#', '?', '/' or '@'), stable for a source + repo + options. */
export function jobKeyFor(source, repo, { ref = '', maxCommits = 300 } = {}) {
  const slug = v => String(v).toLowerCase().replace(/[^a-z0-9.]+/g, '-')
  return (source === 'gitea' ? 'gitea--' : source === 'url' ? 'url--' : '') + slug(repo)
    + (ref ? `--ref-${slug(ref)}` : '') + (maxCommits !== 300 ? `--max${maxCommits}` : '')
}
