// The shared clock for a comparison, used by both the live view and the export
// so a rendered video matches exactly what was on screen.

/** Commits at or before `ts`, by binary search over sorted timestamps. */
export function countUpTo(stamps, ts) {
  let lo = 0, hi = stamps.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (stamps[mid] <= ts) lo = mid + 1; else hi = mid }
  return lo
}

/**
 * "dates" spans the calendar covered by every project; "age" spans the longest
 * single project, with each one measured from its own first commit.
 */
export function comparisonWindow(datas, align) {
  if (!datas.length) return { from: 0, to: 1, span: 1 }
  if (align === 'age') {
    const span = Math.max(1, ...datas.map(d => d.stats.to - d.stats.from))
    return { from: 0, to: span, span }
  }
  const from = Math.min(...datas.map(d => d.stats.from)), to = Math.max(...datas.map(d => d.stats.to))
  return { from, to, span: Math.max(1, to - from) }
}

/** History time for one project at progress `u` (0..1). */
export const timeAt = (data, window, align, u) => align === 'age'
  ? data.stats.from + window.span * u
  : window.from + window.span * u
