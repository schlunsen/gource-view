// Abuse controls for a publicly reachable instance: per-IP rate limits,
// private-address detection for SSRF, and clone-cache eviction planning.
// Pure where possible so they are unit-testable.

/** Sliding-window counter per key (IP). */
export function makeLimiter({ max, windowMs }) {
  const hits = new Map()
  return {
    take(key, now = Date.now()) {
      const cutoff = now - windowMs
      const list = (hits.get(key) || []).filter(t => t > cutoff)
      if (list.length >= max) { hits.set(key, list); return { ok: false, retryAfter: Math.ceil((list[0] + windowMs - now) / 1000) } }
      list.push(now); hits.set(key, list)
      if (hits.size > 10000) for (const [k, v] of hits) if (v.every(t => t <= cutoff)) hits.delete(k)
      return { ok: true, remaining: max - list.length }
    },
  }
}

/** Client IP behind the platform proxy: first X-Forwarded-For entry, else the socket. */
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return xff || req.socket?.remoteAddress || 'unknown'
}

/** True for loopback, RFC1918, link-local, CGNAT, multicast, unspecified, and their IPv6 counterparts / mappings. */
export function isPrivateAddress(ip) {
  let a = String(ip || '').trim().toLowerCase()
  if (!a) return true
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) a = mapped[1]
  if (a.includes(':')) {
    if (a === '::' || a === '::1') return true
    if (/^fe[89ab]/.test(a) || /^f[cd]/.test(a)) return true // link-local, unique-local
    if (/^ff/.test(a)) return true // multicast
    if (a.startsWith('64:ff9b:')) return true // NAT64 → treat as untrusted
    return false
  }
  const p = a.split('.').map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true
  const [x, y] = p
  return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224
}

/** Given cache entries {key, bytes, mtime, busy}, return the keys to delete to get under capBytes (oldest first, never busy ones). */
export function planEviction(entries, capBytes) {
  let total = entries.reduce((s, e) => s + e.bytes, 0)
  if (total <= capBytes) return []
  const victims = []
  for (const e of [...entries].filter(e => !e.busy).sort((a, b) => a.mtime - b.mtime)) {
    if (total <= capBytes) break
    victims.push(e.key); total -= e.bytes
  }
  return victims
}
