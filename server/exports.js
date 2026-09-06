import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { exportOptions, renderVideo } from './video-renderer.js'
import { musicList, musicTrack } from './music.js'
import { spawn } from 'node:child_process'

const RETENTION = 60 * 60 * 1000
export function installExportRoutes(app, repositories, getOrigin, { render = renderVideo, directory = '/tmp/gource-exports' } = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const exports = new Map()
  let active = null
  const publicJob = job => ({
    id: job.id, status: job.status, pct: job.pct, stage: job.stage, frame: job.frame,
    total: job.options.duration * job.options.fps, repo: job.repo, options: job.options,
    error: job.error, expiresAt: job.expiresAt,
    download: job.status === 'done' ? `/api/exports/${job.id}/download` : null,
  })
  const remove = job => { fs.rmSync(job.output, { force: true }); exports.delete(job.id) }
  function cleanup() {
    for (const job of exports.values()) if (job.id !== active && job.expiresAt < Date.now()) remove(job)
    // Also remove expired outputs left behind by a server restart.
    for (const file of fs.readdirSync(directory)) {
      if (!/^[a-f0-9-]{36}\.mp4$/.test(file)) continue
      const output = path.join(directory, file)
      if (Date.now() - fs.statSync(output).mtimeMs > RETENTION && file !== `${active}.mp4`) fs.rmSync(output, { force: true })
    }
  }
  cleanup()
  const timer = setInterval(cleanup, 60000); timer.unref()

  app.get('/api/music', (_req, res) => res.json({ tracks: musicList() }))

  // A custom track arrives base64-encoded (≤ 25 MB); ffprobe must see an audio stream.
  async function stageCustomTrack(b64, file) {
    const buf = Buffer.from(String(b64).replace(/^data:[^,]*,/, ''), 'base64')
    if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error('Custom music must be an audio file up to 25 MB.')
    fs.writeFileSync(file, buf)
    const ok = await new Promise(resolve => {
      const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file])
      let out = ''; p.stdout.on('data', d => { out += d }); p.on('error', () => resolve(false)); p.on('close', code => resolve(code === 0 && out.includes('audio')))
    })
    if (!ok) { fs.rmSync(file, { force: true }); throw new Error('That file does not contain an audio stream (try MP3, M4A, WAV or OGG).') }
    return file
  }

  app.post('/api/exports', async (req, res) => {
    let options
    try { options = exportOptions(req.body?.options) }
    catch (error) { return res.status(400).json({ error: error.message }) }
    const source = repositories.get(req.body?.job)
    if (!source || source.status !== 'done' || !source.result?.commits?.length) return res.status(400).json({ error: 'Load a repository with commits before exporting.' })
    if (source.result.generatedAt !== req.body?.generatedAt) return res.status(409).json({ error: 'This repository was reloaded. Load it again before exporting.' })
    if (active) return res.status(409).json({ error: 'Another video is rendering. Please try again when it finishes.' })
    cleanup()
    // Bound disk usage and retained job metadata.
    while (exports.size >= 10) remove(exports.values().next().value)
    const id = randomUUID(), controller = new AbortController()
    const job = { id, repo: source.result.repo, options, status: 'rendering', pct: 0, frame: 0, stage: 'starting', error: null, output: path.join(directory, `${id}.mp4`), expiresAt: Date.now() + RETENTION, controller }
    let musicFile = null
    try {
      if (options.music === 'custom') musicFile = await stageCustomTrack(req.body.options.track, path.join(directory, `${id}.music`))
      else if (options.music !== 'none') musicFile = musicTrack(options.music).path
    } catch (error) { return res.status(400).json({ error: error.message }) }
    exports.set(id, job); active = id
    const limit = options.resolution === '4k' ? 40 : 15
    const timeout = setTimeout(() => controller.abort(new Error(`The export exceeded ${limit} minutes. Try a lower resolution or a shorter duration.`)), limit * 60000)
    void (async () => {
      try {
        await render({ repo: source.result, options, output: job.output, origin: getOrigin(), signal: controller.signal, onProgress: p => Object.assign(job, p), musicFile })
        controller.signal.throwIfAborted()
        job.status = 'done'; job.pct = 100; job.stage = 'done'
      } catch (error) {
        job.status = job.status === 'cancelling' ? 'cancelled' : 'error'
        job.error = job.status === 'cancelled' ? null : (controller.signal.reason?.message || error.message)
        fs.rmSync(job.output, { force: true })
      } finally {
        clearTimeout(timeout); active = null; job.expiresAt = Date.now() + RETENTION
        if (options.music === 'custom' && musicFile) fs.rmSync(musicFile, { force: true })
      }
    })()
    res.status(202).json(publicJob(job))
  })
  app.get('/api/exports/:id', (req, res) => {
    const job = exports.get(req.params.id)
    if (!job || job.expiresAt < Date.now()) return res.status(404).json({ error: 'Export expired or the server restarted. Please create a new video.' })
    res.set('Cache-Control', 'no-store').json(publicJob(job))
  })
  app.delete('/api/exports/:id', (req, res) => {
    const job = exports.get(req.params.id)
    if (!job) return res.status(404).json({ error: 'Export not found.' })
    if (job.id === active) { job.status = 'cancelling'; job.controller.abort(new Error('Export cancelled.')) }
    res.json(publicJob(job))
  })
  app.get('/api/exports/:id/download', (req, res) => {
    const job = exports.get(req.params.id)
    if (!job || job.expiresAt < Date.now()) return res.status(404).json({ error: 'Export expired. Please create a new video.' })
    if (job.status !== 'done') return res.status(409).json({ error: 'The video is not ready yet.' })
    res.set('Cache-Control', 'no-store')
    res.download(job.output, `${job.repo.replace(/[^a-zA-Z0-9.-]/g, '-')}-${job.options.resolution}${job.options.orientation === 'portrait' ? '-portrait' : ''}-${job.options.fps}fps.mp4`)
  })
  return { close: () => { clearInterval(timer); for (const job of exports.values()) if (job.id === active) job.controller.abort() } }
}
