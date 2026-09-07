// MP4 export without a server: the same composition the server renders is
// drawn frame by frame into an off-screen canvas, encoded with WebCodecs
// (hardware H.264 where available) and muxed to MP4 in memory. Music and the
// synthesized effects are mixed with an OfflineAudioContext and encoded to AAC.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { createGource } from '../gource/renderer.js'
import { createComposition } from '../gource/composition.js'
import { synthesize, SAMPLE_RATE } from '../soundtrack.js'

const FONT_SANS = '"Space Grotesk", sans-serif', FONT_MONO = '"JetBrains Mono", monospace'
const BITRATE = { '720p': 6e6, '1080p': 12e6, '4k': 35e6 }
// H.264 level from the macroblock rate; VP9 level from the pixel rate.
const avcLevel = (w, h, fps) => { const r = Math.ceil(w / 16) * Math.ceil(h / 16) * fps; return r <= 245760 ? '28' : r <= 522240 ? '2a' : r <= 983040 ? '33' : '34' }
const vp9Level = (w, h, fps) => { const r = w * h * fps; return r <= 62914560 ? '40' : r <= 124416000 ? '41' : r <= 251658240 ? '50' : '51' }
const yieldToUi = () => new Promise(r => setTimeout(r, 0))
const aborted = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' })

/** Whether this browser can encode video at all; the codec is chosen per export. */
export async function browserExportSupport() {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || typeof OfflineAudioContext === 'undefined') return { ok: false, reason: 'This browser cannot encode video (no WebCodecs). Use Chrome, Edge or Safari 17+, or self-host the app.' }
  try {
    const codec = await pickVideoCodec(1280, 720, 30)
    return codec ? { ok: true, codec: codec.container } : { ok: false, reason: 'This browser has no usable video encoder. Use Chrome, Edge or Safari 17+, or self-host the app.' }
  } catch (e) { return { ok: false, reason: `Video encoding is unavailable here: ${e.message}` } }
}

async function pickVideoCodec(width, height, fps) {
  const candidates = [
    { container: 'avc', codec: `avc1.6400${avcLevel(width, height, fps)}`, extra: { avc: { format: 'avc' } } },
    { container: 'avc', codec: `avc1.4d00${avcLevel(width, height, fps)}`, extra: { avc: { format: 'avc' } } },
    { container: 'vp9', codec: `vp09.00.${vp9Level(width, height, fps)}.08`, extra: {} },
  ]
  for (const c of candidates) {
    const config = { codec: c.codec, width, height, bitrate: BITRATE['1080p'], framerate: fps, ...c.extra }
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return c } catch { /* next */ }
  }
  return null
}

async function pickAudioCodec() {
  if (typeof AudioEncoder === 'undefined') return null
  for (const c of [{ container: 'aac', codec: 'mp4a.40.2' }, { container: 'opus', codec: 'opus' }]) {
    try { if ((await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 })).supported) return c } catch { /* next */ }
  }
  return null
}

async function decodeMusic(ctx, { musicUrl, musicFile }) {
  const bytes = musicFile ? await musicFile.arrayBuffer() : await (await fetch(musicUrl)).arrayBuffer()
  try { return await ctx.decodeAudioData(bytes) } catch { throw new Error('That file does not contain playable audio (try MP3, M4A, WAV or OGG).') }
}

/** Effects (quiet, ducked under music) + looped, trimmed, faded music → limiter, rendered offline. */
async function renderAudio({ events, options, musicUrl, musicFile, signal }) {
  const total = options.duration + options.intro + options.outro
  const effects = options.sound !== 'none', music = options.music !== 'none'
  if (!effects && !music) return null
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SAMPLE_RATE), SAMPLE_RATE)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.05
  limiter.connect(ctx.destination)
  if (effects) {
    const samples = synthesize({ events, duration: total, intro: options.intro, outro: options.outro, pad: !music })
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE); buffer.copyToChannel(samples, 0)
    const source = ctx.createBufferSource(); source.buffer = buffer
    const gain = ctx.createGain(); gain.gain.value = music ? 0.4 : 0.8
    source.connect(gain); gain.connect(limiter); source.start(0)
  }
  if (music) {
    const buffer = await decodeMusic(ctx, { musicUrl, musicFile })
    if (signal?.aborted) throw aborted()
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, 0); gain.gain.linearRampToValueAtTime(1, 1.5)
    gain.gain.setValueAtTime(1, Math.max(1.5, total - 3)); gain.gain.linearRampToValueAtTime(0, total)
    source.connect(gain); gain.connect(limiter); source.start(0); source.stop(total)
  }
  return ctx.startRendering()
}

/**
 * Renders the export in this browser. Resolves with { blob, filename, video, audio }.
 * @param {object} p  { repo, options (from browserExportOptions), musicUrl?, musicFile?, onProgress?, signal? }
 */
export async function renderBrowserVideo({ repo, options, musicUrl = '', musicFile = null, onProgress = () => {}, signal }) {
  const check = () => { if (signal?.aborted) throw aborted() }
  const total = options.duration + options.intro + options.outro, frames = Math.round(total * options.fps)
  onProgress({ stage: 'starting', pct: 0 })
  const video = await pickVideoCodec(options.width, options.height, options.fps)
  if (!video) throw new Error('This browser has no usable video encoder for that size. Try 720p or 1080p at 30 fps.')
  const canvas = document.createElement('canvas')
  canvas.width = options.width; canvas.height = options.height
  const ctx = canvas.getContext('2d')
  const W = options.logicalWidth, H = options.logicalHeight
  const renderer = createGource(canvas, repo, { manual: true, duration: options.duration, pixelRatio: options.pixelRatio, privacy: options.privacy, clock: options.clock !== false })
  let encoder, audioEncoder
  try {
    const composition = createComposition({ ctx, data: repo, config: options, renderer, W, H })
    const faces = ['400', '500', '600', '700', '800'].map(w => `${w} 32px ${FONT_SANS}`).concat(['400', '500', '600'].map(w => `${w} 16px ${FONT_MONO}`))
    await Promise.race([Promise.allSettled(faces.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 5000))])
    await renderer.avatarsReady(4000)
    check()
    onProgress({ stage: 'soundtrack', pct: 0 })
    const rendered = await renderAudio({ events: composition.soundEvents(), options, musicUrl, musicFile, signal })
    check()
    const audio = rendered ? await pickAudioCodec() : null
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: video.container, width: options.width, height: options.height, frameRate: options.fps },
      audio: audio ? { codec: audio.container, sampleRate: SAMPLE_RATE, numberOfChannels: 2 } : undefined,
      fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    })
    let failure = null
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e } })
    encoder.configure({ codec: video.codec, width: options.width, height: options.height, bitrate: BITRATE[options.resolution], framerate: options.fps, latencyMode: 'quality', ...video.extra })
    if (audio) {
      audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { failure = e } })
      audioEncoder.configure({ codec: audio.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 })
      const left = rendered.getChannelData(0), right = rendered.getChannelData(1), step = SAMPLE_RATE
      for (let offset = 0; offset < rendered.length; offset += step) {
        const n = Math.min(step, rendered.length - offset)
        const data = new Float32Array(n * 2); data.set(left.subarray(offset, offset + n), 0); data.set(right.subarray(offset, offset + n), n)
        const frame = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(offset / SAMPLE_RATE * 1e6), data })
        audioEncoder.encode(frame); frame.close()
      }
    }
    const frameMicros = 1e6 / options.fps
    for (let i = 0; i < frames; i++) {
      check()
      if (failure) throw failure
      composition.drawFrame(i / options.fps, canvas)
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameMicros), duration: Math.round(frameMicros), alpha: 'discard' })
      encoder.encode(frame, { keyFrame: i % (options.fps * 2) === 0 })
      frame.close()
      while (encoder.encodeQueueSize > 6) { await new Promise(r => setTimeout(r, 4)); check() }
      onProgress({ stage: 'rendering', pct: Math.min(99, Math.floor((i + 1) / frames * 99)), frame: i + 1, total: frames })
      if (i % 2 === 0) await yieldToUi()
    }
    onProgress({ stage: 'encoding', pct: 99 })
    await encoder.flush(); if (audioEncoder) await audioEncoder.flush()
    if (failure) throw failure
    check()
    muxer.finalize()
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' })
    const filename = `${repo.repo.replace(/[^\w.-]+/g, '-')}-history-${options.resolution}${options.orientation === 'portrait' ? '-portrait' : ''}.mp4`
    return { blob, filename, video: video.container, audio: audio?.container || 'none' }
  } finally {
    try { encoder?.close() } catch { /* already closed */ }
    try { audioEncoder?.close() } catch { /* already closed */ }
    renderer.destroy()
  }
}
