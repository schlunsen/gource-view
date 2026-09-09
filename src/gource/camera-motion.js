// Critically damped motion with a speed limit. Keep velocity between frames:
// changing the target changes acceleration, never the camera's position.
export function motion(value) { return { value, velocity: 0 } }
export function glide(state, target, seconds, smoothTime = 1, maxSpeed = Infinity) {
  const dt = Math.max(0, Math.min(0.1, seconds))
  if (!dt || !Number.isFinite(target)) return state.value
  const omega = 2 / smoothTime
  const change = Math.max(-maxSpeed * smoothTime, Math.min(maxSpeed * smoothTime, state.value - target))
  const adjusted = state.value - change
  const temp = (state.velocity + omega * change) * dt
  const decay = Math.exp(-omega * dt)
  state.velocity = (state.velocity - omega * temp) * decay
  state.value = adjusted + (change + temp) * decay
  return state.value
}
export function nearestAngle(target, current) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current))
}
