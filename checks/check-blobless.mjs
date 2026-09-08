// A repository too large to clone in full falls back to a *blobless* partial clone:
// exact per-commit file lists, no file contents, no GitHub API rate limit.
// Served by a real `git http-backend` so the Git protocol v2 + filter path is genuine.
// BASE=http://127.0.0.1:8834/gource-view/ node checks/check-blobless.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
const BASE = process.env.BASE, S = process.env.S
assert.ok(BASE, 'Set BASE to the built static site')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-blobless-'))
const source = path.join(root, 'source'); fs.mkdirSync(source)
const git = (...args) => execFileSync('git', args, { cwd: source, stdio: 'pipe', encoding: 'utf8' }).trim()
git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture Author'); git('config', 'user.email', 'fixture@example.test')
for (let i = 0; i < 6; i++) {
  fs.writeFileSync(path.join(source, `file-${i}.txt`), `line ${i}\nmore\n`)
  fs.mkdirSync(path.join(source, 'src'), { recursive: true })
  fs.writeFileSync(path.join(source, 'src', `mod-${i}.js`), `export const v = ${i}\n`)
  git('add', '.')
  const date = new Date(1700000000000 + i * 86400000).toISOString()
  execFileSync('git', ['commit', '-qm', `commit ${i}`], { cwd: source, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
}
git('clone', '--bare', '-q', source, path.join(root, 'repo.git'))
// Partial clone must be allowed, exactly as github.com allows it.
execFileSync('git', ['config', 'uploadpack.allowFilter', 'true'], { cwd: path.join(root, 'repo.git') })
execFileSync('git', ['config', 'uploadpack.allowAnySHA1InWant', 'true'], { cwd: path.join(root, 'repo.git') })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  let sawFilter = false, packRequests = 0
  await context.route('**/data/index.json', r => r.fulfill({ json: { demos: [] } }))
  await context.route('**/data/music.json', r => r.fulfill({ json: { tracks: [] } }))
  // The repository reports as far too large to clone in full, which is what selects this path.
  await context.route('https://api.github.com/repos/**', r => r.fulfill({ json: { size: 4_000_000, default_branch: 'main', description: 'A very large fixture repository.' } }))
  await context.route('https://cors.isomorphic-git.org/**', async route => {
    const request = route.request(), url = new URL(request.url())
    const endpoint = url.pathname.endsWith('/info/refs') ? '/info/refs' : '/git-upload-pack'
    const body = request.postDataBuffer()
    if (body && body.toString('utf8').includes('filter blob:none')) sawFilter = true
    if (endpoint === '/git-upload-pack') packRequests++
    const response = await new Promise((resolve, reject) => {
      const child = spawn('git', ['http-backend'], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: '/repo.git' + endpoint, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method(), CONTENT_TYPE: request.headers()['content-type'] || '', CONTENT_LENGTH: String(body?.length || 0), SERVER_PROTOCOL: 'HTTP/1.1', GIT_PROTOCOL: request.headers()['git-protocol'] || '' } })
      const chunks = []; child.stdout.on('data', c => chunks.push(c)); child.stderr.resume()
      child.on('error', reject); child.on('close', code => code ? reject(new Error(`git http-backend ${code}`)) : resolve(Buffer.concat(chunks)))
      child.stdin.end(body)
    })
    const split = response.indexOf('\r\n\r\n'), headers = Object.fromEntries(response.subarray(0, split).toString().split('\r\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()] }))
    await route.fulfill({ status: Number.parseInt(headers.status || '200'), headers: { 'content-type': headers['content-type'], 'access-control-allow-origin': '*' }, body: response.subarray(split + 4) })
  })
  await page.goto(BASE)
  await page.locator('#repo').fill('huge/fixture')
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 120000 })

  assert.ok(sawFilter, 'the client asked for a blobless pack (filter blob:none)')
  const bar = await page.locator('.browser-history-bar').innerText()
  assert.match(bar, /History from a partial clone/, bar)
  const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  assert.match(main, /commits 6 /, main.slice(0, 200))          // every commit, from trees alone
  assert.match(main, /lines — /, 'line counts are reported as unavailable, not zero')
  assert.match(main, /Line counts unavailable/, 'the reason is explained')
  assert.ok(packRequests >= 2, 'ls-refs and fetch both ran over the Git protocol')
  await page.screenshot({ path: `${S}/blobless.png` })
  assert.deepEqual(errors, [])
  console.log(`blobless check ok · filter honoured, ${packRequests} upload-pack requests, 6 commits without file contents`)
} finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
