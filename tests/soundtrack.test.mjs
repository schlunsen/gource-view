import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { synthesize, writeWav, SAMPLE_RATE } from '../server/soundtrack.js'

test('soundtrack has the exact length, stays within range, and reacts to events', () => {
  const quiet = synthesize({ events: [], duration: 6, intro: 1, outro: 1 })
  const busy = synthesize({ events: [{ t: 3, files: 40 }, { t: 3.1, files: 2 }], duration: 6, intro: 1, outro: 1 })
  assert.equal(quiet.length, 6 * SAMPLE_RATE)
  assert.ok(busy.every(v => v >= -1 && v <= 1))
  const energy = (a, from, to) => { let e = 0; for (let i = from * SAMPLE_RATE; i < to * SAMPLE_RATE; i++) e += a[i] * a[i]; return e }
  assert.ok(energy(busy, 3, 3.5) > energy(quiet, 3, 3.5) * 1.3, 'events add energy')
  assert.ok(energy(quiet, 0, 0.1) < energy(quiet, 2.5, 2.6), 'fades in')
})

test('writes a valid 16-bit mono WAV', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gource-wav-')), 'a.wav')
  writeWav(synthesize({ duration: 0.5 }), file)
  const b = fs.readFileSync(file)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE')
  assert.equal(b.readUInt32LE(24), SAMPLE_RATE); assert.equal(b.readUInt16LE(22), 1)
  assert.equal(b.length, 44 + Math.round(0.5 * SAMPLE_RATE) * 2)
})
