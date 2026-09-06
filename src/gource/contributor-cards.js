// Broadcast-style contributor cards ("lower thirds") and the date scoreboard.
//
// Everything here is a pure function of the loaded history, so seeking and the
// frame-exact video export show the exact same cards at the exact same moments.

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000]

/**
 * Build the card schedule for a commit list (sorted by ts).
 *  - debut: an author's first commit in the loaded window
 *  - milestone: an author's Nth commit for N in MILESTONES
 * Cards are queued into `lanes` slots: a burst of debuts is shown one after
 * another rather than on top of each other, and anything that would have to
 * wait too long is dropped so the cards never lag far behind the action.
 */
export function buildContributorCards(commits, { histPerSec, colorOf, lanes = 3, lifeSeconds = 4.6 }) {
  const life = histPerSec * lifeSeconds
  const stats = new Map()
  const events = []
  for (const c of commits) {
    let s = stats.get(c.name)
    if (!s) { s = { n: 0, files: new Set(), join: stats.size + 1 }; stats.set(c.name, s) }
    s.n++
    for (const f of c.files) s.files.add(f.p)
    const base = { ts: c.ts, name: c.name, col: colorOf(c.name), join: s.join, commits: s.n, files: s.files.size }
    if (s.n === 1) events.push({ ...base, kind: 'debut' })
    else if (MILESTONES.includes(s.n)) events.push({ ...base, kind: 'milestone' })
  }
  const free = new Array(lanes).fill(-Infinity)
  const gap = histPerSec * 0.35 // stagger so two cards never slide in on the same frame
  let lastShow = -Infinity
  const cards = []
  for (const ev of events) {
    let lane = 0
    for (let i = 1; i < lanes; i++) if (free[i] < free[lane]) lane = i
    const showTs = Math.max(ev.ts, free[lane] + gap, lastShow + gap)
    const maxDelay = histPerSec * (ev.kind === 'debut' ? 10 : 3)
    if (showTs - ev.ts > maxDelay) continue
    free[lane] = showTs + life
    lastShow = showTs
    cards.push({ ...ev, showTs, lane, life })
  }
  return cards
}

export function initials(name) {
  const words = String(name || '').trim().split(/[\s._-]+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Pieces of the scoreboard date for a unix timestamp (UTC, so exports are stable). */
export function dateParts(ts) {
  const d = new Date(ts * 1000)
  return {
    day: String(d.getUTCDate()).padStart(2, '0'),
    month: MONTHS[d.getUTCMonth()],
    year: String(d.getUTCFullYear()),
    weekday: DAYS[d.getUTCDay()],
  }
}

/** Number of commits with ts <= t (commits sorted by ts). */
export function commitsBefore(times, t) {
  let lo = 0, hi = times.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid }
  return lo
}
