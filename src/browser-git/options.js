export const MAX_BROWSER_COMMITS = 3000
export function parseRepository(value) {
  let name = String(value || '').trim()
  if (/^(https?:\/\/|(?:www\.)?github\.com\/)/i.test(name)) {
    const url = new URL(/^https?:/i.test(name) ? name : `https://${name}`)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) throw new Error('Enter a public GitHub repository, such as nuxt/nuxt.')
    name = url.pathname.replace(/^\//, '').split('/').slice(0, 2).join('/')
  }
  name = name.replace(/\/+$/, '').replace(/\.git$/i, '')
  if (!/^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d_.-]+$/i.test(name) || /\/(\.|\.\.)$/.test(name)) throw new Error('Enter a public GitHub repository, such as nuxt/nuxt.')
  return name
}

export function browserLimit(value = 3000) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_BROWSER_COMMITS) throw new Error(`Choose between 1 and ${MAX_BROWSER_COMMITS.toLocaleString()} commits for browser loading.`)
  return n
}
