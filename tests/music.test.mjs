import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { MUSIC, musicTrack, musicList, musicCredit } from '../server/music.js'

test('bundled tracks exist, are unique, and carry a CC BY credit', () => {
  assert.ok(MUSIC.length >= 3)
  assert.equal(new Set(MUSIC.map(t => t.id)).size, MUSIC.length)
  for (const t of MUSIC) { assert.ok(fs.statSync(t.path).size > 1_000_000, t.file); assert.equal(t.license, 'CC BY 4.0') }
  assert.match(musicCredit(musicTrack('cipher')), /Kevin MacLeod.*CC BY 4\.0/)
  assert.equal(musicTrack('nope'), null)
  assert.ok(musicList().every(t => !('path' in t)))
})
