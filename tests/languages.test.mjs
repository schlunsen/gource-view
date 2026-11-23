import test from 'node:test'
import assert from 'node:assert/strict'
import { languageOf, languageRows, LANGUAGE_LABELS } from '../src/gource/languages.js'
import { PALETTES } from '../src/gource/palette.js'

test('files are grouped by the extension of their own name, not of a folder', () => {
  assert.equal(languageOf('src/App.tsx'), 'ts')
  assert.equal(languageOf('lib/index.MJS'), 'js')
  assert.equal(languageOf('docs/README.md'), 'data')
  assert.equal(languageOf('public/logo.svg'), 'image')
  assert.equal(languageOf('v1.2/Makefile'), 'code')
  assert.equal(languageOf('src/main.zig'), 'code')
})

test('every named language has a label and a hue in both editions', () => {
  for (const key of Object.keys(LANGUAGE_LABELS)) {
    if (['code', 'data', 'image'].includes(key)) continue
    for (const edition of ['dark', 'light']) assert.equal(PALETTES[edition].lang[key]?.length, 3, `${edition} ${key}`)
  }
})

test('legend rows are largest first with shares of the files alive', () => {
  const rows = languageRows(new Map([['js', 1], ['ts', 3], ['py', 0]]), { js: [1, 1, 1], ts: [2, 2, 2] })
  assert.deepEqual(rows.map(r => [r.key, r.label, r.files, r.share]), [['ts', 'TypeScript', 3, 0.75], ['js', 'JavaScript', 1, 0.25]])
})
