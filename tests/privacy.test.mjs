import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPseudonyms, nextPrivacy, normalizePrivacy, describeHidden } from '../src/gource/privacy.js'

test('pseudonyms are stable by first appearance', () => {
  const m = buildPseudonyms([{ name: 'Ada' }, { name: 'Bob' }, { name: 'Ada' }, { name: 'Cy' }])
  assert.deepEqual([...m.entries()], [['Ada', 'Contributor 1'], ['Bob', 'Contributor 2'], ['Cy', 'Contributor 3']])
})
test('levels cycle and unknown values normalize to off', () => {
  assert.equal(nextPrivacy('off'), 'paths'); assert.equal(nextPrivacy('paths'), 'all'); assert.equal(nextPrivacy('all'), 'off')
  assert.equal(normalizePrivacy('bogus'), 'off')
})
test('hidden descriptions carry no path segments', () => {
  const d = describeHidden({ type: 'dir', path: 'secret/project/core' }, 12)
  assert.equal(d, 'folder · depth 3 · 12 files'); assert.ok(!d.includes('secret'))
  assert.equal(describeHidden({ type: 'file', path: 'a/b.js' }), 'file · depth 2')
})
