const REPO = /^[\w.-]+\/[\w.-]+$/

// GitHub Trending is a candidate list, not an exhaustive ranking of GitHub.
// Never substitute total stars on newly created repositories for gains in a
// window: the search fallback reports lifetime stars, so it cannot stand in.
function byGain(window) {
  if (window?.source !== 'github.com/trending') return []
  const seen = new Set()
  return window.repos.filter(repo => {
    if (!REPO.test(repo.name) || seen.has(repo.name.toLowerCase())) return false
    seen.add(repo.name.toLowerCase())
    return Number.isFinite(repo.gained)
  }).sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name))
}

// The front page showcases one project at a time. The week stands in on the
// rare day GitHub serves no daily list, so the page still has a subject.
const WINDOWS = [
  { period: 'daily', label: 'today', days: 1 },
  { period: 'weekly', label: 'this week', days: 7 },
]

/** Today's most-starred projects, the leader first: { period, label, days, repos }. */
export function todaysLeaders(data, limit = 4) {
  for (const window of WINDOWS) {
    const repos = byGain(data?.periods?.[window.period])
    if (repos.length) return { ...window, repos: repos.slice(0, limit) }
  }
  throw new Error('Star gains are unavailable. Please try again later.')
}
