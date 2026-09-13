// History from Gitilla's history server, for the static build.
//
// On GitHub Pages there is no backend, so a history is either a prebuilt demo
// or something this browser works out for itself -- a partial clone over a CORS
// relay, or a walk of the GitHub API against the visitor's own 60-an-hour
// budget. Both work. Neither scales to the repositories people actually type
// first: a blobless clone of torvalds/linux does not finish in a tab, and the
// API walk needs one request per commit from a budget that is gone after sixty.
//
// gitilla.com/api has already done that work, on a 5,000-an-hour token, and
// keeps the answer. So it is tried first and everything else stays exactly
// where it was, behind it: this is a fast path, never a dependency. If the
// server is slow, unreachable, or has nothing for this repository, the browser
// does what it did before.
export const HISTORY_API = 'https://gitilla.com/api'

// Long enough for a cached answer from the edge (which is the common case, and
// arrives in well under a second), short enough that nobody sits watching a
// spinner because another machine is having a bad day.
const TIMEOUT_MS = 6000

/** GitHub's status words in the shape the rest of the code already uses. */
const mapFiles = files => (files || []).map(f => ({
  p: f.path,
  a: f.added | 0,
  d: f.deleted | 0,
  ...(f.action === 'D' ? { s: 'D' } : {}),
})).filter(f => f.p)

/**
 * @returns a history in the prebuilt-demo shape, or null to fall through.
 * Never throws: every failure here is "the browser should just do it itself".
 */
export async function gitillaHistory(repo, { signal, fetchImpl = fetch } = {}) {
  let body
  try {
    const r = await fetchImpl(`${HISTORY_API}/history/${repo}`, {
      credentials: 'omit',
      signal: signal || AbortSignal.timeout(TIMEOUT_MS),
    })
    // 503 is the server saying "this one is too big to build while you wait,
    // it is being prepared" -- true, and not something to wait on here.
    if (!r.ok) return null
    body = await r.json()
  } catch {
    return null
  }
  if (!Array.isArray(body?.commits) || body.commits.length === 0) return null

  const commits = body.commits
    .map(c => ({
      hash: c.sha,
      ts: c.ts | 0,
      name: c.author || 'unknown',
      // The server keeps neither address nor message, by design. Avatars fall
      // back to initials, which is what an absent address already meant here.
      email: '',
      subject: '',
      files: mapFiles(c.files),
    }))
    .filter(c => c.files.length && c.ts > 0)
    .sort((a, b) => a.ts - b.ts)
  if (!commits.length) return null

  const byAuthor = new Map()
  let loc = 0
  for (const c of commits) {
    byAuthor.set(c.name, (byAuthor.get(c.name) || 0) + 1)
    for (const f of c.files) loc += f.a + f.d
  }
  const topAuthors = [...byAuthor.entries()].sort((a, b) => b[1] - a[1])

  return {
    repo,
    source: 'gitilla',
    sourceUrl: `https://github.com/${repo}`,
    description: '',
    ref: '', refs: [], defaultRef: '',
    maxCommits: commits.length,
    commits,
    stats: {
      commits: commits.length,
      authors: byAuthor.size,
      loc,
      from: commits[0].ts,
      to: commits[commits.length - 1].ts,
      topAuthors,
    },
    generatedAt: Date.now(),
    // Flagged so the footer can say where this came from, and so the
    // "line counts unavailable" note stays honest for the big repositories
    // the server gathers without them.
    gitilla: true,
    linesUnavailable: loc === 0,
    // The server's own word for "there is more of this than I returned".
    // Whether that matters depends on what the caller asked for, so it is
    // reported rather than decided here.
    truncated: !!body.truncated,
  }
}
