import { createGource } from './gource/renderer.js'
import { createComposition } from './gource/composition.js'

let renderer, composition, data, config
const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')
const FONT_SANS = '"Space Grotesk", sans-serif', FONT_MONO = '"JetBrains Mono", monospace'

window.initializeExport = async (input) => {
  data = input.repo; config = input.options
  const W = config.logicalWidth || 1920, H = config.logicalHeight || 1080
  canvas.width = config.width; canvas.height = config.height
  renderer?.destroy()
  renderer = createGource(canvas, data, { manual: true, duration: config.duration, pixelRatio: config.pixelRatio || config.width / W, privacy: config.privacy, clock: config.clock !== false })
  composition = createComposition({ ctx, data, config, renderer, W, H })
  // Request every face the composition uses: fonts.ready alone resolves before
  // any face has been asked for, which would leave the first frames in fallback.
  const faces = ['400', '500', '600', '700', '800'].map(w => `${w} 32px ${FONT_SANS}`).concat(['400', '500', '600'].map(w => `${w} 16px ${FONT_MONO}`))
  await Promise.race([Promise.allSettled(faces.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 5000))])
  await renderer.avatarsReady(4000)
  return true
}

window.renderExportFrame = (frame) => {
  composition.drawFrame(frame / config.fps, canvas)
  return canvas.toDataURL('image/png').split(',')[1]
}

// Commit moments on the video's clock, for the soundtrack.
window.exportSoundEvents = () => composition.soundEvents()
