// Runs every browser check against a fresh Vite dev server.
//   npm run check            → all checks
//   npm run check -- edges   → only checks whose name contains "edges"
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const filter = process.argv.slice(2)
const scratch = process.env.S || path.join(root, 'checks', 'out')
const skip = new Set(['check-prod-export.mjs', 'check-real.mjs', 'check-static.mjs', 'check-browser-git.mjs', 'check-shots.mjs']) // these need a deployed instance (BASE/REPO env)
const checks = readdirSync(here).filter(f => f.startsWith('check-') && f.endsWith('.mjs') && !skip.has(f) && (!filter.length || filter.some(x => f.includes(x)))).sort()

const dev = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore' })
const up = async () => { for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:5173/'); return } catch { await new Promise(r => setTimeout(r, 500)) } } throw new Error('dev server did not start') }
let failed = 0
try {
  await up()
  await import('node:fs').then(fs => fs.mkdirSync(scratch, { recursive: true }))
  for (const check of checks) {
    const started = Date.now()
    const code = await new Promise(resolve => spawn(process.execPath, [path.join(here, check)], { cwd: root, stdio: 'inherit', env: { ...process.env, S: scratch } }).on('close', resolve))
    console.log(`${code === 0 ? '✔' : '✖'} ${check} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    if (code !== 0) failed++
  }
} finally { dev.kill('SIGTERM') }
console.log(failed ? `${failed} check(s) failed` : `all ${checks.length} checks passed`)
process.exit(failed ? 1 : 0)
