// A very small Git protocol v2 client — just enough to fetch a *blobless* pack
// (`filter blob:none`). isomorphic-git cannot ask for a partial clone, and for
// a large repository the blobs are almost all of the download: 3,000 commits of
// a 3.7 GB repository arrive in ~8 MB this way. Trees still come, so every
// commit's file list is exact; only line counts need the blobs we skip.
const enc = new TextEncoder(), dec = new TextDecoder()
export const FLUSH = Uint8Array.from([48, 48, 48, 48])      // 0000
export const DELIM = Uint8Array.from([48, 48, 48, 49])      // 0001

/** One pkt-line: a 4-digit hex length (counting itself) then the payload. */
export function pkt(line) {
  const body = enc.encode(line)
  const head = enc.encode((body.length + 4).toString(16).padStart(4, '0'))
  const out = new Uint8Array(head.length + body.length)
  out.set(head); out.set(body, head.length)
  return out
}
const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** Pulls whole pkt-lines out of a rolling buffer, leaving any partial tail behind. */
function drain(buffer, onLine) {
  let i = 0
  while (i + 4 <= buffer.length) {
    const len = Number.parseInt(dec.decode(buffer.subarray(i, i + 4)), 16)
    if (Number.isNaN(len)) throw new Error('Malformed Git response.')
    if (len < 2) { onLine(null, len); i += 4; continue }   // 0000 flush / 0001 delimiter
    if (i + len > buffer.length) break                      // wait for more bytes
    onLine(buffer.subarray(i + 4, i + len), null)
    i += len
  }
  return buffer.subarray(i)
}

const headers = { 'Content-Type': 'application/x-git-upload-pack-request', 'Git-Protocol': 'version=2', Accept: 'application/x-git-upload-pack-result' }
const endpoint = (url, proxy) => `${proxy ? `${proxy}/${url.replace(/^https?:\/\//, '')}` : url}/git-upload-pack`

async function post(url, proxy, body, signal) {
  const r = await fetch(endpoint(url, proxy), { method: 'POST', headers, body, credentials: 'omit', signal })
  if (!r.ok) throw new Error(`Git server returned HTTP ${r.status}.`)
  return r
}

/** Branch names, the default branch and the oid to fetch. */
export async function lsRefs({ url, corsProxy, signal }) {
  const body = concat([pkt('command=ls-refs\n'), pkt('object-format=sha1\n'), DELIM, pkt('symrefs\n'), pkt('ref-prefix HEAD\n'), pkt('ref-prefix refs/heads/\n'), FLUSH])
  const res = await post(url, corsProxy, body, signal)
  const lines = []
  drain(new Uint8Array(await res.arrayBuffer()), data => { if (data) lines.push(dec.decode(data).trim()) })
  const branches = [], refs = new Map()
  let head = '', defaultRef = ''
  for (const line of lines) {
    const [oid, name, ...rest] = line.split(' ')
    if (!/^[0-9a-f]{40}$/.test(oid || '')) continue
    if (name === 'HEAD') { head = oid; defaultRef = (rest.find(r => r.startsWith('symref-target:')) || '').split(':')[1]?.replace('refs/heads/', '') || '' }
    else if (name?.startsWith('refs/heads/')) { const b = name.slice(11); branches.push(b); refs.set(b, oid) }
  }
  branches.sort()
  return { head, defaultRef: defaultRef || branches[0] || '', branches, oidOf: b => refs.get(b) }
}

/**
 * Fetch a shallow, blobless pack. Returns the raw packfile plus the shallow
 * boundary commits, streaming so progress and the size cap are honoured.
 */
export async function fetchPack({ url, corsProxy, want, depth, onProgress = () => {}, maxBytes = Infinity, signal }) {
  const body = concat([pkt('command=fetch\n'), pkt('object-format=sha1\n'), DELIM,
    pkt('no-progress\n'), pkt('ofs-delta\n'), pkt(`deepen ${depth}\n`), pkt('filter blob:none\n'),
    pkt(`want ${want}\n`), pkt('done\n'), FLUSH])
  const res = await post(url, corsProxy, body, signal)
  const reader = res.body.getReader()
  let buffer = new Uint8Array(0), section = '', received = 0
  const shallow = [], packParts = []
  let failure = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > maxBytes) { reader.cancel().catch(() => {}); throw new Error(`The download exceeds the ${Math.round(maxBytes / 1048576)} MB browser limit.`) }
    const merged = new Uint8Array(buffer.length + value.length)
    merged.set(buffer); merged.set(value, buffer.length)
    buffer = drain(merged, data => {
      if (!data) return
      // Section headers are bare words; inside "packfile" every line is sidebanded.
      if (section !== 'packfile') {
        const text = dec.decode(data).trim()
        if (/^(acknowledgments|shallow-info|wanted-refs|packfile)$/.test(text)) { section = text; return }
        if (section === 'shallow-info') { const m = text.match(/^shallow ([0-9a-f]{40})/); if (m) shallow.push(m[1]) }
        return
      }
      if (data[0] === 1) packParts.push(data.subarray(1))
      else if (data[0] === 3) failure = dec.decode(data.subarray(1)).trim()
    })
    onProgress(received)
  }
  if (failure) throw new Error(`Git server error: ${failure}`)
  const pack = concat(packParts)
  if (!pack.length) throw new Error('The Git server returned no pack data.')
  return { pack, shallow, received }
}
