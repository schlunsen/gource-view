// File lifecycle: per-path event lists (change / delete) so the renderer can
// tell whether a file is alive at any moment in history. Pure and sorted, so
// seeking and export stay deterministic.

/** path -> { times: number[], del: boolean[] } in commit order. */
export function buildEvents(commits) {
  const events = new Map()
  for (const c of commits) for (const f of c.files) {
    let e = events.get(f.p)
    if (!e) { e = { times: [], del: [] }; events.set(f.p, e) }
    e.times.push(c.ts); e.del.push(f.s === 'D')
  }
  return events
}

/** Index of the last event at or before t, or -1. */
export function lastEventIndex(e, t) {
  let lo = 0, hi = e.times.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (e.times[mid] <= t) lo = mid + 1; else hi = mid }
  return lo - 1
}

/** True when the file exists at t (its latest event at/before t is not a deletion). */
export function aliveAt(e, t) {
  if (!e) return true
  const i = lastEventIndex(e, t)
  return i >= 0 && !e.del[i]
}

/** Timestamp of the deletion in force at t, or null when the file is alive/unborn. */
export function deletedAt(e, t) {
  if (!e) return null
  const i = lastEventIndex(e, t)
  return i >= 0 && e.del[i] ? e.times[i] : null
}
