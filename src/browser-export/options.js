// Export settings for the browser renderer. Mirrors server/video-renderer.js
// exportOptions, with the bundled track list supplied by the static build.
export const INTRO_SECONDS = 3, OUTRO_SECONDS = 4
const SIZES = { '720p': 1280, '1080p': 1920, '4k': 3840 }
export const musicCredit = track => track ? `Music: “${track.title}” by ${track.artist} (incompetech.com) · ${track.license}` : ''

export function browserExportOptions(input = {}, tracks = []) {
  const { resolution = '1080p', orientation = 'landscape', sound = 'ambient', music = 'none', privacy = 'off', clock = true, fps = 30, duration = 30, title = '' } = input
  if (!['off', 'paths', 'all'].includes(privacy)) throw new Error('Choose a privacy level.')
  if (!SIZES[resolution]) throw new Error('Choose 720p, 1080p or 4K.')
  if (!['landscape', 'portrait'].includes(orientation)) throw new Error('Choose landscape or portrait.')
  if (!['ambient', 'none'].includes(sound)) throw new Error('Choose subtle sound effects or none.')
  const track = music === 'none' || music === 'custom' ? null : tracks.find(t => t.id === music) || null
  if (music !== 'none' && music !== 'custom' && !track) throw new Error('Choose a bundled track, your own file, or no music.')
  if (music === 'custom' && !(input.file instanceof Blob)) throw new Error('Attach an audio file for custom music.')
  if (![30, 60].includes(fps)) throw new Error('Choose 30 or 60 fps.')
  if (resolution === '4k' && fps !== 30) throw new Error('4K exports render at 30 fps.')
  if (![15, 30, 60].includes(duration)) throw new Error('Choose a 15, 30, or 60 second video.')
  if (typeof title !== 'string' || title.length > 100) throw new Error('Titles must be at most 100 characters.')
  const long = SIZES[resolution], short = Math.round(long * 9 / 16)
  const portrait = orientation === 'portrait'
  const width = portrait ? short : long, height = portrait ? long : short
  const logicalWidth = portrait ? 1080 : 1920, logicalHeight = portrait ? 1920 : 1080
  return { resolution, orientation, sound, music, privacy, clock: clock !== false, credit: musicCredit(track), musicTitle: track?.title || (music === 'custom' ? 'Your track' : ''), width, height, logicalWidth, logicalHeight, pixelRatio: width / logicalWidth, fps, duration, intro: INTRO_SECONDS, outro: OUTRO_SECONDS, title: title.trim() }
}
