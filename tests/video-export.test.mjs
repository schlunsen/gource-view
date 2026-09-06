import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { installExportRoutes } from '../server/exports.js'
import { exportOptions } from '../server/video-renderer.js'

const repo = { repo: 'example/history', generatedAt: 123, stats: { from: 1700000000, to: 1700086400, commits: 3, authors: 2 }, commits: [
  { ts: 1700000000, hash: 'a', name: 'Alex', files: [{ p: 'src/app.js', a: 10, d: 0 }] },
  { ts: 1700043200, hash: 'b', name: 'Sam', files: [{ p: 'docs/readme.md', a: 20, d: 0 }] },
  { ts: 1700086400, hash: 'c', name: 'Alex', files: [{ p: 'src/app.js', a: 2, d: 1 }] },
] }
async function setup(t, render) {
  const app = express(); app.use(express.json()); app.use(express.static('dist'))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-export-test-'))
  const repositories = new Map([['fixture', { status: 'done', result: repo }]])
  let server
  const routes = installExportRoutes(app, repositories, () => `http://127.0.0.1:${server.address().port}`, { directory, ...(render ? { render } : {}) })
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { routes.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = (body) => fetch(`${origin}/api/exports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { origin, post, directory }
}
const body = { job: 'fixture', generatedAt: 123, options: { resolution: '720p', fps: 30, duration: 15, music: 'floating-cities' } }
async function completed(origin, id) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const job = await (await fetch(`${origin}/api/exports/${id}`)).json()
    if (!['rendering', 'cancelling'].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Export timed out in test')
}
test('reject invalid settings before starting expensive work', () => {
  for (const options of [{ fps: 120 }, { duration: -1 }, { resolution: '8k' }, { resolution: '4k', fps: 60 }, { orientation: 'square' }, { sound: 'rock' }, { music: 'nope' }, { music: 'custom' }, { title: 'x'.repeat(101) }, null]) assert.throws(() => exportOptions(options))
  assert.equal(exportOptions().width, 1920)
  assert.deepEqual([exportOptions({ resolution: '4k' }).width, exportOptions({ resolution: '4k' }).pixelRatio], [3840, 2])
  const portrait = exportOptions({ orientation: 'portrait' })
  assert.deepEqual([portrait.width, portrait.height, portrait.logicalWidth, portrait.pixelRatio], [1080, 1920, 1080, 1])
  assert.equal(exportOptions({ resolution: '720p' }).height, 720)
})
test('validate snapshots, limit concurrency, and cancel with cleanup', async t => {
  const { origin, post, directory } = await setup(t, async ({ signal, output }) => {
    fs.writeFileSync(output, 'partial')
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  assert.equal((await post({ ...body, job: 'unknown' })).status, 400)
  assert.equal((await post({ ...body, generatedAt: 999 })).status, 409)
  const response = await post(body); assert.equal(response.status, 202)
  const job = await response.json()
  assert.equal((await post(body)).status, 409)
  assert.equal((await fetch(`${origin}/api/exports/${job.id}/download`)).status, 409)
  await fetch(`${origin}/api/exports/${job.id}`, { method: 'DELETE' })
  assert.equal((await completed(origin, job.id)).status, 'cancelled')
  assert.equal(fs.readdirSync(directory).length, 0)
})
test('surface rendering failures and allow a subsequent job', async t => {
  const { origin, post } = await setup(t, async () => { throw new Error('Encoder unavailable') })
  const job = await (await post(body)).json()
  const result = await completed(origin, job.id)
  assert.equal(result.status, 'error'); assert.match(result.error, /Encoder unavailable/)
  assert.equal((await post(body)).status, 202)
})
test('render and download a real H.264 MP4 with exact duration and frame count', { skip: !process.env.TEST_VIDEO_EXPORT, timeout: 150000 }, async t => {
  const { origin, post, directory } = await setup(t)
  const job = await (await post(body)).json()
  const result = await completed(origin, job.id)
  assert.equal(result.status, 'done', result.error)
  assert.equal(result.pct, 100)
  const response = await fetch(origin + result.download)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /example-history-720p-30fps.mp4/)
  assert.ok((await response.arrayBuffer()).byteLength > 1000)
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path.join(directory, `${job.id}.mp4`)], { encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  const media = JSON.parse(probe.stdout), stream = media.streams.find(s => s.codec_type === 'video'), audio = media.streams.find(s => s.codec_type === 'audio')
  assert.equal(audio?.codec_name, 'aac'); assert.equal(audio.channels, 2)
  assert.equal(stream.codec_name, 'h264'); assert.equal(stream.pix_fmt, 'yuv420p')
  assert.equal(stream.width, 1280); assert.equal(stream.height, 720)
  assert.equal(stream.r_frame_rate, '30/1'); assert.equal(Number(stream.nb_frames), 660) // 3 s intro + 15 s history + 4 s outro
  assert.equal(Number(media.format.duration), 22)
})
