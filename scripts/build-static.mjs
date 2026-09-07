#!/usr/bin/env node
// Builds the data for the static demo (GitHub Pages): clones a handful of
// repositories, reads their last 300 commits, and writes JSON the viewer
// loads in static mode, plus the bundled music.
//   node scripts/build-static.mjs dist
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, collectCommits, summarize } from '../server/history.js'
import { createDescriptionLoader } from '../server/repo-description.js'
const repositoryDescription = createDescriptionLoader({ githubToken: process.env.GITHUB_TOKEN || '' })

const out = path.resolve(process.argv[2] || 'dist')
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// The hosting repository itself comes first (the Pages demo opens on it).
const SELF = process.env.GITHUB_REPOSITORY || process.env.DEMO_SELF || ''
const DEMOS = [
  ...(SELF ? [{ name: SELF, note: 'this project' }] : []),
  { name: 'expressjs/express', note: 'Node' },
  { name: 'pallets/flask', note: 'Python' },
  { name: 'gin-gonic/gin', note: 'Go' },
  { name: 'tokio-rs/tokio', note: 'Rust' },
  { name: 'fastify/fastify', note: 'Node' },
  { name: 'axios/axios', note: 'JS' },
]
const only = process.env.DEMO_LIMIT ? DEMOS.slice(0, Number(process.env.DEMO_LIMIT)) : DEMOS
const slug = name => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-static-'))
fs.mkdirSync(path.join(out, 'data'), { recursive: true })
const index = []
for (const demo of only) {
  const dir = path.join(work, slug(demo.name))
  process.stdout.write(`${demo.name} … `)
  await run('git', ['clone', '--quiet', '--depth=350', '--no-single-branch', `https://github.com/${demo.name}.git`, dir], { timeout: 300000 })
  const commits = await collectCommits(dir, { maxCommits: 300 })
  let defaultRef = 'main'
  try { defaultRef = (await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: dir })).stdout.trim().replace(/^origin\//, '') } catch { /* keep */ }
  const result = summarize(commits, { description: await repositoryDescription({ source: 'github', repo: demo.name }), repo: demo.name, source: 'github', sourceUrl: `https://github.com/${demo.name}`, ref: defaultRef, refs: [defaultRef], defaultRef, maxCommits: 300 })
  fs.writeFileSync(path.join(out, 'data', `${slug(demo.name)}.json`), JSON.stringify(result))
  index.push({ name: demo.name, slug: slug(demo.name), note: demo.note, commits: result.stats.commits, authors: result.stats.authors, from: result.stats.from, to: result.stats.to })
  console.log(`${result.stats.commits} commits, ${result.stats.authors} authors`)
  fs.rmSync(dir, { recursive: true, force: true })
}
fs.writeFileSync(path.join(out, 'data', 'index.json'), JSON.stringify({ builtAt: Date.now(), demos: index }))
// music: list + files
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'server', 'music', 'index.json'), 'utf8'))
fs.mkdirSync(path.join(out, 'music'), { recursive: true })
for (const t of manifest.tracks) fs.copyFileSync(path.join(root, 'server', 'music', t.file), path.join(out, 'music', `${t.id}.mp3`))
fs.writeFileSync(path.join(out, 'data', 'music.json'), JSON.stringify({ tracks: manifest.tracks.map(t => ({ id: t.id, title: t.title, mood: t.mood, artist: manifest.artist, license: manifest.license })), credit: manifest.credit }))
fs.rmSync(work, { recursive: true, force: true })
console.log(`static demo data written to ${out}/data (${index.length} repositories)`)
