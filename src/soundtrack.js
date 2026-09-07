// Synthesized soundtrack for exports: an ambient pad, a soft blip per commit,
// a whoosh for bursts, a riser under the title card and a chord under the
// leaderboard. Pure arithmetic and deterministic, so the server and the
// browser produce the same samples.
export const SAMPLE_RATE = 44100

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function synthesize({ events = [], duration, intro = 0, outro = 0, pad = true }) {
  const N = Math.max(1, Math.round(duration * SAMPLE_RATE))
  const out = new Float32Array(N)
  const TAU = Math.PI * 2
  const add = (start, length, fn) => {
    const s0 = Math.max(0, Math.floor(start * SAMPLE_RATE)), s1 = Math.min(N, Math.floor((start + length) * SAMPLE_RATE))
    for (let i = s0; i < s1; i++) out[i] += fn((i - s0) / SAMPLE_RATE, i / SAMPLE_RATE)
  }
  // ambient pad: detuned low sines with slow movement, fading in and out
  // (skipped when a music track carries the bed)
  if (pad) add(0, duration, (t, abs) => {
    const env = Math.min(1, abs / 2.5) * Math.min(1, (duration - abs) / 2.5)
    const lfo = 0.6 + 0.4 * Math.sin(TAU * 0.07 * abs)
    return env * 0.03 * (Math.sin(TAU * 55 * abs) + 0.7 * Math.sin(TAU * 82.41 * abs + 0.4) + 0.4 * lfo * Math.sin(TAU * 164.81 * abs))
  })
  // title card: a riser that lands on a soft hit when the history starts
  if (intro > 0) {
    add(0, intro, (t) => { const k = t / intro; const f = 110 * Math.pow(4, k); return Math.min(1, k * 1.5) * 0.035 * Math.sin(TAU * f * t) })
    add(intro, 0.6, (t) => Math.exp(-t * 6) * 0.07 * Math.sin(TAU * 220 * t))
  }
  // commits: blips whose weight follows the commit size; crowded moments are tamed
  const sorted = [...events].sort((a, b) => a.t - b.t)
  sorted.forEach((e, i) => {
    let crowd = 1
    for (let j = i - 1; j >= 0 && e.t - sorted[j].t < 0.25; j--) crowd++
    const amp = 0.075 * Math.min(1, 0.45 + Math.log2(1 + (e.files || 1)) / 7) / Math.sqrt(crowd)
    add(e.t, 0.14, (t) => { const f = 660 * Math.pow(0.5, t / 0.14); return Math.exp(-t * 28) * amp * Math.sin(TAU * f * t) })
    if ((e.files || 0) >= 20) {
      const rnd = mulberry(Math.round(e.t * 1000)); let lp = 0
      add(e.t, 0.7, (t) => { const n = rnd() * 2 - 1; lp += (n - lp) * 0.2; const env = Math.min(1, t / 0.15) * Math.exp(-(t - 0.15) * 4); return env * 0.16 * lp })
    }
  })
  // leaderboard: a warm chord that swells in and settles
  if (outro > 0) {
    add(duration - outro, outro, (t) => { const env = Math.min(1, t / 1.2) * Math.min(1, (outro - t) / 1.5); return env * 0.03 * (Math.sin(TAU * 220 * t) + Math.sin(TAU * 277.18 * t) + Math.sin(TAU * 329.63 * t)) })
  }
  for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * 1.3) // soft limiter
  return out
}
