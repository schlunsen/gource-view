// Reading a repository's history with git, and summarising it for the
// viewer. Shared by the server and the static demo builder.
import { spawn } from 'node:child_process'

export function run(cmd, args, { cwd, maxBuffer = 200 * 1024 * 1024, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += d; if (stdout.length > maxBuffer) child.kill('SIGKILL') })
    child.stderr.on('data', d => { stderr += d })
    const t = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(t)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`))
    })
  })
}

export async function collectCommits(repoDir, { maxCommits = 3000, ref = 'HEAD' } = {}) {
  // Use \u0001 as a commit-start marker so numstat lines (which follow the
  // \u0000 terminator) are cleanly associated with their commit.
  const F = '%x01%H%x09%at%x09%an%x09%ae%x09%s'
  const { stdout, stderr } = await run('git', [
    'log', ...(maxCommits > 0 ? [`--max-count=${maxCommits}`] : []), '--no-merges', ref,
    `--pretty=format:${F}`,
    '--raw', '--numstat', '--diff-filter=ACMRD',
    '--', ':(exclude)node_modules', ':(exclude).git', ':(exclude)**/node_modules',
  ], { cwd: repoDir, maxBuffer: 500 * 1024 * 1024, timeout: 300000 })
  if (stderr && stderr.toLowerCase().includes('fatal:')) {
    throw new Error('git log: ' + stderr.trim().slice(0, 300))
  }

  // Split on \u0001 — each chunk is: "HASH\tTS\tNAME\tEMAIL\tSUBJ\nnumstat...\n\n"
  const chunks = stdout.split('\u0001').slice(1)
  const commits = []
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const headLine = lines.shift()
    if (!headLine) continue
    const parts = headLine.split('\t')
    if (parts.length < 5) continue
    const [hash, ts, name, email, subject] = parts
    if (!hash || isNaN(+ts)) continue
    // --raw lines (":mode mode sha sha STATUS\tpath") precede the numstat lines
    // and tell us which changes are deletions; renames are not detected, so a
    // move shows up as a deletion plus an addition.
    const status = new Map()
    const files = []
    for (const line of lines) {
      const r = line.match(/^:\d+ \d+ [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*\t(.+)$/)
      if (r) { status.set(r[2].trim(), r[1]); continue }
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (!m) continue
      let p = m[3].trim()
      if (p.startsWith('b/') || p.startsWith('a/')) p = p.slice(2)
      if (!p) continue
      const f = { p, a: m[1] === '-' ? 0 : +m[1], d: m[2] === '-' ? 0 : +m[2] }
      if (status.get(m[3].trim()) === 'D') f.s = 'D'
      files.push(f)
    }
    if (files.length) commits.push({ hash, ts: +ts, name, email, subject, files })
  }
  commits.sort((a, b) => a.ts - b.ts)
  return commits
}

export { summarize } from '../src/history-summary.js'
