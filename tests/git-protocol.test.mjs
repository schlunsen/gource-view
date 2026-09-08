import test from 'node:test'
import assert from 'node:assert/strict'
import { pkt, lsRefs, fetchPack } from '../src/browser-git/protocol.js'

const enc = new TextEncoder()
const line = s => { const b = enc.encode(s); const h = enc.encode((b.length + 4).toString(16).padStart(4, '0')); return [...h, ...b] }
const band = (n, s) => line(String.fromCharCode(n) + s)
const FLUSH = [...enc.encode('0000')], DELIM = [...enc.encode('0001')]
const stream = bytes => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(Uint8Array.from(bytes.slice(i, i + 7))); c.close() } }))
const OID = 'a'.repeat(40), OID2 = 'b'.repeat(40), SHALLOW = 'c'.repeat(40)

test('pkt-lines carry a four-digit length that counts itself', () => {
  assert.equal(new TextDecoder().decode(pkt('hi\n')), '0007hi\n')
  assert.equal(pkt('x'.repeat(100)).length, 104)
})

test('lsRefs reads the default branch from the HEAD symref and lists branches', async () => {
  let sent
  globalThis.fetch = async (url, init) => { sent = { url, body: init.body, proto: init.headers['Git-Protocol'] }; return stream([
    ...line(`${OID} HEAD symref-target:refs/heads/trunk\n`),
    ...line(`${OID} refs/heads/trunk\n`), ...line(`${OID2} refs/heads/beta\n`), ...FLUSH]) }
  const r = await lsRefs({ url: 'https://github.com/o/r.git', corsProxy: 'https://relay.test' })
  assert.equal(r.head, OID); assert.equal(r.defaultRef, 'trunk')
  assert.deepEqual(r.branches, ['beta', 'trunk'])
  assert.equal(r.oidOf('beta'), OID2)
  assert.equal(sent.url, 'https://relay.test/github.com/o/r.git/git-upload-pack')
  assert.equal(sent.proto, 'version=2')
  assert.match(new TextDecoder().decode(sent.body), /command=ls-refs/)
})

test('fetchPack asks for a blobless pack and demuxes the sideband', async () => {
  let body
  globalThis.fetch = async (_u, init) => { body = new TextDecoder().decode(init.body); return stream([
    ...line('shallow-info\n'), ...line(`shallow ${SHALLOW}\n`),
    ...line('packfile\n'), ...band(1, 'PACK'), ...band(2, 'noise'), ...band(1, 'DATA'), ...FLUSH]) }
  const seen = []
  const r = await fetchPack({ url: 'https://github.com/o/r.git', corsProxy: 'https://relay.test', want: OID, depth: 300, onProgress: n => seen.push(n) })
  assert.match(body, /filter blob:none/)
  assert.match(body, /deepen 300/)
  assert.match(body, new RegExp(`want ${OID}`))
  assert.equal(new TextDecoder().decode(r.pack), 'PACKDATA', 'band 1 only, progress discarded')
  assert.deepEqual(r.shallow, [SHALLOW])
  assert.ok(seen.length > 1 && seen.at(-1) === r.received, 'progress is reported as bytes arrive')
})

test('fetchPack surfaces a server error band and enforces the size cap', async () => {
  globalThis.fetch = async () => stream([...line('packfile\n'), ...band(3, 'upload-pack died')])
  await assert.rejects(fetchPack({ url: 'u', want: OID, depth: 1 }), /upload-pack died/)
  globalThis.fetch = async () => stream([...line('packfile\n'), ...band(1, 'x'.repeat(500))])
  await assert.rejects(fetchPack({ url: 'u', want: OID, depth: 1, maxBytes: 100 }), /exceeds the 0 MB browser limit|exceeds/)
  globalThis.fetch = async () => stream([...line('packfile\n'), ...FLUSH])
  await assert.rejects(fetchPack({ url: 'u', want: OID, depth: 1 }), /no pack data/)
  globalThis.fetch = async () => ({ ok: false, status: 503 })
  await assert.rejects(fetchPack({ url: 'u', want: OID, depth: 1 }), /HTTP 503/)
})
