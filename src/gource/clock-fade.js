// The analog clock's single hand turns once per 12 hours of history. Once
// history runs faster than about a day per second the hand strobes instead of
// reading, so the clock fades out while playback is that fast and returns when
// it slows. Pure and time-driven, so exports (driven by presentation time) are
// deterministic.

export const CLOCK_HIDE_RATE = 86400 // history seconds per second: a day a second
export const CLOCK_SHOW_RATE = 43200 // hysteresis: half a day a second

const RATE_SMOOTHING = 1.2 // s — rides out auto-pace's changes of gear
const FADE = 0.25 // s

export function createClockFade(nominalRate) {
  // Rates span orders of magnitude (auto-pace alone is 4×), so smooth in log space.
  let logRate = Math.log(Math.max(1, nominalRate))
  let fast = nominalRate > CLOCK_HIDE_RATE
  let alpha = fast ? 0 : 1
  return {
    /** Record how fast history advanced. Holds, pauses and seeks carry no rate and are ignored. */
    note(rate, dt) {
      if (!(rate > 0) || !(dt > 0) || !Number.isFinite(rate)) return
      logRate += (Math.log(rate) - logRate) * (1 - Math.exp(-dt / RATE_SMOOTHING))
      const r = Math.exp(logRate)
      if (fast ? r < CLOCK_SHOW_RATE : r > CLOCK_HIDE_RATE) fast = !fast
    },
    /** Ease the visible opacity toward the current decision. */
    ease(dt) {
      if (!(dt > 0)) return
      alpha += ((fast ? 0 : 1) - alpha) * (1 - Math.exp(-dt / FADE))
      if (Math.abs(alpha - (fast ? 0 : 1)) < 1e-3) alpha = fast ? 0 : 1
    },
    get alpha() { return alpha },
    get fast() { return fast },
    get rate() { return Math.exp(logRate) },
  }
}
