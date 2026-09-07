/** The payload the viewer consumes. */
export function summarize(commits, meta = {}) {
  const authors = Object.create(null)
  let loc = 0
  for (const c of commits) for (const f of c.files) loc += f.a
  for (const c of commits) authors[c.name] = (authors[c.name] || 0) + 1
  const times = commits.map(c => c.ts)
  const topPaths = Object.create(null)
  for (const c of commits) for (const f of c.files) {
    const top = f.p.split('/')[0] || f.p
    topPaths[top] = (topPaths[top] || 0) + f.a + f.d
  }
  return {
    ...meta,
    commits,
    stats: {
      commits: commits.length,
      authors: Object.keys(authors).length,
      loc,
      from: times[0] || 0,
      to: times[times.length - 1] || 0,
      topAuthors: Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 12),
      topPaths: Object.entries(topPaths).sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
    generatedAt: Date.now(),
  }
}
