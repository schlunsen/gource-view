export const WEEK = 7 * 86400

// GitHub Trending is a candidate list, not an exhaustive ranking of GitHub.
// Never substitute total stars on newly created repositories for weekly gains.
export function weeklyLeaders(data) {
  const weekly = data?.periods?.weekly
  if (weekly?.source !== 'github.com/trending') throw new Error('Weekly star gains are unavailable. Please try again later.')
  const seen = new Set()
  return weekly.repos.filter(repo => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.name) || seen.has(repo.name.toLowerCase())) return false
    seen.add(repo.name.toLowerCase())
    return Number.isFinite(repo.gained)
  }).sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name)).slice(0, 4)
}
