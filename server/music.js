// Bundled music: Kevin MacLeod tracks (incompetech.com), CC BY 4.0 — the
// credit line is rendered on the closing card and offered for descriptions.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'music')
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))

export const MUSIC = manifest.tracks.map(t => ({ ...t, artist: manifest.artist, license: manifest.license, path: path.join(dir, t.file) }))
export const MUSIC_CREDIT = manifest.credit
export function musicTrack(id) { return MUSIC.find(t => t.id === id) || null }
export function musicList() { return MUSIC.map(({ id, title, mood, artist, license }) => ({ id, title, mood, artist, license })) }
export function musicCredit(track) { return track ? `Music: “${track.title}” by ${track.artist} (incompetech.com) · ${track.license}` : '' }
