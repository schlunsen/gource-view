import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLimiter, isPrivateAddress, planEviction, clientIp } from '../server/limits.js'

test('rate limiter allows max hits per window then refuses with a retry hint', () => {
  const l = makeLimiter({ max: 2, windowMs: 1000 })
  assert.equal(l.take('a', 0).ok, true); assert.equal(l.take('a', 10).ok, true)
  const r = l.take('a', 20); assert.equal(r.ok, false); assert.ok(r.retryAfter >= 1)
  assert.equal(l.take('b', 20).ok, true, 'other keys unaffected')
  assert.equal(l.take('a', 1001).ok, true, 'window slides')
})

test('private address detection covers the ranges that matter for SSRF', () => {
  for (const ip of ['127.0.0.1', '10.43.0.1', '172.16.5.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:10.0.0.1', 'fe80::1', 'fd00::1', '224.0.0.1', '', 'nonsense'])
    assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['140.82.121.4', '8.8.8.8', '2606:4700::6810:84e5', '172.32.0.1'])
    assert.equal(isPrivateAddress(ip), false, ip)
})

test('eviction removes the oldest non-busy clones until under the cap', () => {
  const plan = planEviction([{ key: 'a', bytes: 4, mtime: 1, busy: true }, { key: 'b', bytes: 3, mtime: 2 }, { key: 'c', bytes: 3, mtime: 3 }, { key: 'd', bytes: 2, mtime: 4 }], 6)
  assert.deepEqual(plan, ['b', 'c'])
  assert.deepEqual(planEviction([{ key: 'a', bytes: 1, mtime: 1 }], 5), [])
})

test('client ip prefers the first forwarded address', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.9' } }), '1.2.3.4')
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.9' } }), '10.0.0.9')
})
