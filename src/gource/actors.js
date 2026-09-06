// Author actors (after Gource's user avatars): every contributor is a
// persistent figure that flies to the folder they touch, beams at the files,
// lingers, and leaves when idle. State is a pure function of history time so
// seeking and video export reproduce the same motion.
export const TRAVEL = 0.7   // wall seconds at 1× to fly between folders
export const ACT_MIN = 1.4  // beam duration for a small commit …
export const ACT_MAX = 3.2  // … and the cap for huge ones
export const IDLE = 7       // seconds without a commit before leaving
export const FADE = 0.9     // fade-out length

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

export function buildActors(commits, { colorOf }) {
  const byName = new Map()
  commits.forEach((c, index) => {
    let a = byName.get(c.name)
    if (!a) { a = { name: c.name, email: c.email || '', col: colorOf(c.name), phase: (hash(c.name) % 360) * Math.PI / 180, visits: [] }; byName.set(c.name, a) }
    const actSeconds = Math.min(ACT_MAX, ACT_MIN + Math.log2(Math.max(1, c.files.length / 6)) * 0.5)
    a.visits.push({ ts: c.ts, index, count: c.files.length, actSeconds })
  })
  return [...byName.values()]
}

/**
 * Where an actor is at time t.
 *   target    graph-space folder the actor is at / flying to
 *   fromPos   previous folder when flying between two, null when arriving from outside
 *   travel    0..1 progress of the flight
 *   acting    1..0 while beaming at files (0 once done)
 *   alpha     presence (fades out after IDLE)
 * `where(visit)` maps a visit to its graph-space origin.
 */
export function actorState(actor, t, histPerSec, where) {
  const v = actor.visits
  if (!v.length || t < v[0].ts) return null
  let lo = 0, hi = v.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (v[mid].ts <= t) lo = mid; else hi = mid - 1 }
  const cur = v[lo]
  const since = (t - cur.ts) / histPerSec
  const gone = since - IDLE
  if (gone > FADE) return null
  const prev = lo > 0 ? v[lo - 1] : null
  const stayed = prev && (cur.ts - prev.ts) / histPerSec < IDLE + FADE
  const travel = Math.min(1, since / TRAVEL)
  return {
    visit: cur,
    target: where(cur),
    fromPos: stayed ? where(prev) : null,
    travel,
    acting: since < cur.actSeconds ? 1 - since / cur.actSeconds : 0,
    alpha: gone > 0 ? 1 - gone / FADE : 1,
    since,
  }
}
