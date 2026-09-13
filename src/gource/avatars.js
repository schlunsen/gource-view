// Gravatar avatars keyed by e-mail (SHA-256, the hash Gravatar accepts).
// Images are requested with CORS so a canvas that draws them stays exportable;
// anything that fails or times out falls back to initials.
const cache = new Map()

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Addresses that can never have a Gravatar. GitHub mints the noreply ones for
// anybody who hides their e-mail, so they are the commonest author address in
// modern history and every one of them was a guaranteed miss. The rest are what
// git invents when it has nothing: a local hostname, or literally "(none)".
//
// Worth skipping rather than letting them 404: ?d=404 is how this file detects
// "no avatar, draw initials instead", but a browser prints a failed image load
// to the console whatever onerror does with it. Not asking is the only way to
// not be told.
const NO_GRAVATAR = /@(users\.noreply\.github\.com|localhost|.*\.local|\(none\)|example\.com|invalid)$/

export function loadAvatar(email, size = 96) {
  const key = String(email || '').trim().toLowerCase()
  if (!key || !key.includes('@')) return Promise.resolve(null)
  if (NO_GRAVATAR.test(key)) return Promise.resolve(null)
  if (cache.has(key)) return cache.get(key)
  const p = (async () => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null
    const hex = await sha256Hex(key)
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      const done = ok => resolve(ok ? img : null)
      img.onload = () => done(true)
      img.onerror = () => done(false)
      img.src = `https://gravatar.com/avatar/${hex}?s=${size}&d=404&r=g`
    })
  })().catch(() => null)
  cache.set(key, p)
  return p
}

/** Resolve when every pending avatar has loaded/failed, or after `ms`. */
export function avatarsSettled(ms = 4000) {
  return Promise.race([Promise.allSettled([...cache.values()]), new Promise(r => setTimeout(r, ms))])
}
