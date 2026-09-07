import test from 'node:test'
import assert from 'node:assert/strict'
import { browserExportOptions, musicCredit } from '../src/browser-export/options.js'
import { synthesize, SAMPLE_RATE } from '../src/soundtrack.js'
import { synthesize as serverSynthesize } from '../server/soundtrack.js'

const tracks = [{ id: 'cipher', title: 'Cipher', artist: 'Kevin MacLeod', license: 'CC BY 4.0' }]

test('browser export options mirror the server layout and credits', () => {
  const o = browserExportOptions({ resolution: '1080p', music: 'cipher', duration: 15, title: ' Hello ' }, tracks)
  assert.equal(o.width, 1920); assert.equal(o.height, 1080); assert.equal(o.pixelRatio, 1); assert.equal(o.intro, 3); assert.equal(o.outro, 4)
  assert.equal(o.title, 'Hello'); assert.equal(o.musicTitle, 'Cipher'); assert.equal(o.credit, musicCredit(tracks[0]))
  const p = browserExportOptions({ resolution: '4k', orientation: 'portrait', music: 'none' }, tracks)
  assert.equal(p.width, 2160); assert.equal(p.height, 3840); assert.equal(p.logicalWidth, 1080); assert.equal(p.pixelRatio, 2); assert.equal(p.credit, '')
  const c = browserExportOptions({ music: 'custom', file: new Blob(['x']) }, tracks)
  assert.equal(c.musicTitle, 'Your track')
})

test('browser export options reject what the server rejects', () => {
  assert.throws(() => browserExportOptions({ resolution: '8k' }, tracks), /720p, 1080p or 4K/)
  assert.throws(() => browserExportOptions({ music: 'missing' }, tracks), /bundled track/)
  assert.throws(() => browserExportOptions({ music: 'custom' }, tracks), /Attach an audio file/)
  assert.throws(() => browserExportOptions({ resolution: '4k', fps: 60 }, tracks), /4K exports render at 30 fps/)
  assert.throws(() => browserExportOptions({ duration: 45 }, tracks), /15, 30, or 60/)
  assert.throws(() => browserExportOptions({ title: 'x'.repeat(101) }, tracks), /100 characters/)
})

test('the browser and the server synthesize identical soundtracks', () => {
  const args = { events: [{ t: 4, files: 3 }, { t: 9.5, files: 40 }], duration: 12, intro: 3, outro: 4, pad: false }
  const a = synthesize(args), b = serverSynthesize(args)
  assert.equal(a.length, 12 * SAMPLE_RATE); assert.deepEqual(a, b)
  assert.ok(a.some(v => v !== 0), 'has sound'); assert.ok(a.every(v => Math.abs(v) <= 1), 'limited')
})
