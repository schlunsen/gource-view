// Node side of the soundtrack: the synthesis lives in src/ so the browser
// export shares it; this module adds the WAV writer FFmpeg reads.
import fs from 'node:fs'
import { SAMPLE_RATE, synthesize } from '../src/soundtrack.js'
export { SAMPLE_RATE, synthesize }

export function writeWav(samples, file) {
  const N = samples.length, buf = Buffer.alloc(44 + N * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(N * 2, 40)
  for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2)
  fs.writeFileSync(file, buf)
  return file
}
