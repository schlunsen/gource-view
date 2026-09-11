// Where the repository being visualized actually lives. Every history carries a
// `sourceUrl` — from the server clone, the browser clone, the GitHub API path and
// the prebuilt demos alike — so one helper turns any of them into a link we are
// willing to open, and into a label that says where it goes.

const HOSTS = { 'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'bitbucket.org': 'Bitbucket', 'codeberg.org': 'Codeberg', 'sr.ht': 'SourceHut' }

/** An https web address, or null. Rejects anything we would not hand a user:
 *  other schemes, embedded credentials, and hosts that are not public names. */
export function safeRepoUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return null
  url.search = ''; url.hash = ''
  return url.href.replace(/\.git$/, '').replace(/\/$/, '')
}

/** The repository's own page, or null when there isn't one we can trust.
 *  Privacy mode hides the repository's identity, so it hides this link too. */
export function repoLink(repo, privacy = 'off') {
  if (!repo || privacy !== 'off') return null
  return safeRepoUrl(repo.sourceUrl || (repo.repo && (!repo.source || repo.source === 'github') ? `https://github.com/${repo.repo}` : ''))
}

/** "GitHub", "GitLab", … or the bare host, so a link can name its destination. */
export function repoHost(url) {
  const safe = safeRepoUrl(url)
  if (!safe) return ''
  const host = new URL(safe).hostname.replace(/^www\./, '')
  return HOSTS[host] || Object.entries(HOSTS).find(([h]) => host.endsWith(`.${h}`))?.[1] || host
}
