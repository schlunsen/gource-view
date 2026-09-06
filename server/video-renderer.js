import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { synthesize, writeWav } from './soundtrack.js'
import { musicTrack, musicCredit } from './music.js'

export const INTRO_SECONDS = 3, OUTRO_SECONDS = 4

const SIZES = { '720p': 1280, '1080p': 1920, '4k': 3840 }

export function exportOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid export settings.')
  const { resolution = '1080p', orientation = 'landscape', sound = 'ambient', music = 'none', privacy = 'off', clock = true, fps = 30, duration = 30, title = '' } = input
  if (!['off', 'paths', 'all'].includes(privacy)) throw new Error('Choose a privacy level.')
  if (!SIZES[resolution]) throw new Error('Choose 720p, 1080p or 4K.')
  if (!['landscape', 'portrait'].includes(orientation)) throw new Error('Choose landscape or portrait.')
  if (!['ambient', 'none'].includes(sound)) throw new Error('Choose subtle sound effects or none.')
  const track = music === 'none' || music === 'custom' ? null : musicTrack(music)
  if (music !== 'none' && music !== 'custom' && !track) throw new Error('Choose a bundled track, your own upload, or no music.')
  if (music === 'custom' && !(typeof input.track === 'string' && input.track.length > 100)) throw new Error('Attach an audio file for custom music.')
  if (![30, 60].includes(fps)) throw new Error('Choose 30 or 60 fps.')
  if (resolution === '4k' && fps !== 30) throw new Error('4K exports render at 30 fps.')
  if (![15, 30, 60].includes(duration)) throw new Error('Choose a 15, 30, or 60 second video.')
  if (typeof title !== 'string' || title.length > 100) throw new Error('Titles must be at most 100 characters.')
  // The composition is laid out at a logical 1920×1080 (or 1080×1920) and
  // rendered at pixelRatio× so every resolution shares one design.
  const long = SIZES[resolution], short = Math.round(long * 9 / 16)
  const portrait = orientation === 'portrait'
  const width = portrait ? short : long, height = portrait ? long : short
  const logicalWidth = portrait ? 1080 : 1920, logicalHeight = portrait ? 1920 : 1080
  // A title card and a closing contributor leaderboard bracket the history.
  return { resolution, orientation, sound, music, privacy, clock: clock !== false, credit: track ? musicCredit(track) : music === 'custom' ? '' : '', musicTitle: track?.title || (music === 'custom' ? 'Your track' : ''), width, height, logicalWidth, logicalHeight, pixelRatio: width / logicalWidth, fps, duration, intro: INTRO_SECONDS, outro: OUTRO_SECONDS, title: title.trim() }
}

export async function renderVideo({ repo, options, output, origin, signal, onProgress, musicFile = null }) {
  let browser, encoder, encoderResult, audio
  const abort = () => { encoder?.kill('SIGKILL'); void browser?.close().catch(() => {}) }
  signal.addEventListener('abort', abort)
  try {
    signal.throwIfAborted()
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
    signal.throwIfAborted()
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1 })
    // Export only loads our local renderer; repository strings cannot initiate network requests.
    const allowed = url => url.origin === origin || (url.origin === 'https://gravatar.com' && url.pathname.startsWith('/avatar/')) || url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com'
    await page.route('**/*', route => allowed(new URL(route.request().url())) ? route.continue() : route.abort())
    await page.goto(`${origin}/export.html`)
    await page.waitForFunction(() => typeof window.initializeExport === 'function')
    await page.evaluate(input => window.initializeExport(input), { repo, options })
    signal.throwIfAborted()
    const totalSeconds = options.duration + options.intro + options.outro
    const music = options.music !== 'none' ? musicFile : null
    if (options.sound !== 'none') {
      onProgress({ frame: 0, total: 1, pct: 0, stage: 'soundtrack' })
      const events = await page.evaluate(() => window.exportSoundEvents())
      audio = output + '.wav'
      // with a music bed the synthesized pad is dropped; the effects sit under the music
      writeWav(synthesize({ events, duration: totalSeconds, intro: options.intro, outro: options.outro, pad: !music }), audio)
      signal.throwIfAborted()
    }
    // Audio graph: effects (quiet, ducked further under music) + looped,
    // trimmed, faded music → limiter → AAC.
    const T = totalSeconds.toFixed(3), fmt = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
    const inputs = [], chains = []
    let index = 0 // input 0 is the frame pipe
    if (audio) { inputs.push('-i', audio); index++; chains.push(`[${index}:a]${fmt},volume=${music ? 0.4 : 0.8}[fx]`) }
    if (music) { inputs.push('-stream_loop', '-1', '-i', music); index++; chains.push(`[${index}:a]${fmt},atrim=0:${T},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.5,afade=t=out:st=${(totalSeconds - 3).toFixed(3)}:d=3,volume=1.0[bed]`) }
    let audioArgs = ['-an']
    if (audio || music) {
      const mix = audio && music ? '[fx][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,' : audio ? '[fx]' : '[bed]'
      const graph = chains.join(';') + ';' + mix + 'alimiter=limit=0.95[aout]'
      audioArgs = [...inputs, '-filter_complex', graph, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-shortest']
    }
    encoder = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(options.fps), '-vcodec', 'png', '-i', 'pipe:0',
      ...audioArgs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    let diagnostics = '', streamError
    encoder.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-2000) })
    encoder.stdin.on('error', error => { streamError = error })
    // Resolve errors as values until awaited, avoiding unhandled rejections on early exits.
    encoderResult = new Promise(resolve => {
      encoder.once('error', error => resolve(error))
      encoder.once('close', code => resolve(code === 0 ? null : new Error(`Video encoder failed: ${diagnostics || code}`)))
    })
    const total = (options.duration + options.intro + options.outro) * options.fps
    for (let frame = 0; frame < total; frame++) {
      signal.throwIfAborted()
      if (streamError) throw streamError
      const png = await page.evaluate(i => window.renderExportFrame(i), frame)
      signal.throwIfAborted()
      await new Promise((resolve, reject) => encoder.stdin.write(Buffer.from(png, 'base64'), error => error ? reject(error) : resolve()))
      onProgress({ frame: frame + 1, total, pct: Math.min(99, Math.floor((frame + 1) / total * 99)), stage: 'rendering' })
    }
    encoder.stdin.end()
    onProgress({ frame: total, total, pct: 99, stage: 'encoding' })
    const error = await encoderResult
    if (error) throw error
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', abort)
    encoder?.kill('SIGKILL')
    await browser?.close()
    if (encoderResult) await encoderResult
    if (audio) fs.rmSync(audio, { force: true })
  }
}
