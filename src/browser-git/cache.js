const DB = 'gource-browser-histories-v1', STORE = 'histories'
const MAX_AGE = 24 * 60 * 60 * 1000, MAX_ENTRIES = 5
const open = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export const historyKey = (repo, ref, limit) => JSON.stringify([repo.toLowerCase(), ref || '', limit])
export async function cachedHistory(key) {
  let db
  try {
    db = await open()
    const row = await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key)
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
    return row && Date.now() - row.savedAt < MAX_AGE ? { ...row.result, browser: { ...row.result.browser, cached: true, savedAt: row.savedAt } } : null
  } catch { return null } finally { db?.close() }
}
export async function saveHistory(key, result) {
  let db
  try {
    // Large histories can still play when persistent storage is constrained.
    if (JSON.stringify(result).length > 20 * 1024 * 1024) return false
    db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE)
      const savedAt = Date.now()
      store.put({ key, savedAt, result })
      const r = store.getAll()
      r.onsuccess = () => {
        const rows = r.result.sort((a, b) => b.savedAt - a.savedAt)
        rows.forEach((row, i) => { if (i >= MAX_ENTRIES || savedAt - row.savedAt >= MAX_AGE) store.delete(row.key) })
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
    return true
  } catch { return false } finally { db?.close() }
}
export async function clearHistories() {
  const db = await open()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear()
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}
