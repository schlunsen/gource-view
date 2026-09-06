// Auto-pacing: playback runs at 1× around commits and `fast`× through dead
// stretches. `warp` maps uniform playback progress to history time so video
// exports skip the same gaps; `elapsed` is the playback clock the flyover uses.
export function buildPacing(times, { from, to, histPerSec, near = 2.5, fast = 4, samples = 1200 }) {
  const sorted = [...times].sort((a, b) => a - b)
  const nearH = near * histPerSec
  function distance(t) {
    let lo = 0, hi = sorted.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid }
    let d = Infinity
    if (lo < sorted.length) d = sorted[lo] - t
    if (lo > 0) d = Math.min(d, t - sorted[lo - 1])
    return d
  }
  function paceAt(t) {
    const d = distance(t)
    if (!Number.isFinite(d) || nearH <= 0) return 1
    return 1 + (fast - 1) * Math.max(0, Math.min(1, (d - nearH) / (nearH * 0.5)))
  }
  if (!(to > from) || !sorted.length) {
    return { paceAt: () => 1, elapsed: t => Math.max(0, (t - from) / histPerSec), warp: u => from + (to - from) * Math.max(0, Math.min(1, u)), playbackSeconds: (to - from) / histPerSec }
  }
  const n = samples, dt = (to - from) / n
  const cum = new Float64Array(n + 1)
  for (let i = 1; i <= n; i++) cum[i] = cum[i - 1] + dt / paceAt(from + (i - 0.5) * dt)
  const total = cum[n]
  function elapsed(t) {
    const x = (t - from) / dt
    const i = Math.max(0, Math.min(n - 1, Math.floor(x)))
    const f = Math.max(0, Math.min(1, x - i))
    return (cum[i] + (cum[i + 1] - cum[i]) * f) / histPerSec
  }
  function warp(u) {
    const target = Math.max(0, Math.min(1, u)) * total
    let lo = 0, hi = n
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid }
    if (lo === 0) return from
    const f = (target - cum[lo - 1]) / Math.max(1e-12, cum[lo] - cum[lo - 1])
    return Math.min(to, from + (lo - 1 + f) * dt)
  }
  return { paceAt, elapsed, warp, playbackSeconds: total / histPerSec }
}
