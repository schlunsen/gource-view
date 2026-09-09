// Exercise a built Pages site and the real Git worker against a local Git protocol fixture.
// BASE=http://127.0.0.1:8831/gource-view/ node checks/check-browser-git.mjs
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { collectCommits, summarize } from '../server/history.js'
const BASE = process.env.BASE
assert.ok(BASE, 'Set BASE to the built static site')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-browser-protocol-'))
const source = path.join(root, 'source'); fs.mkdirSync(source)
const git = (...args) => execFileSync('git', args, { cwd: source, stdio: 'pipe', encoding: 'utf8' }).trim()
git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture Author'); git('config', 'user.email', 'fixture@example.test')
for (let i = 0; i < 4; i++) {
 fs.writeFileSync(path.join(source, `file-${i}.txt`), `line ${i}\n`); git('add', '.')
 const date = new Date(1700000000000 + i * 86400000).toISOString()
 execFileSync('git', ['commit', '-qm', `commit ${i}`], { cwd: source, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
}
git('branch', 'feature'); git('clone', '--bare', '-q', source, path.join(root, 'repo.git'))
const payload = summarize(await collectCommits(source), { repo: 'fixture/example', ref: 'main', defaultRef: 'main', refs: ['main'], maxCommits: 300 })
const browser = await chromium.launch({ headless: true })
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
 const page = await context.newPage(), errors = []
 page.on('pageerror', e => errors.push(e.message))
 let gitRequests = 0, networkMode = 'ok', release, sawHeld
 const calls = []
 await context.route('**/data/index.json', r => r.fulfill({ json: { demos: [{ name: 'fixture/example', slug: 'fixture-example' }] } }))
 await context.route('**/data/fixture-example.json', r => r.fulfill({ json: payload }))
 await context.route('**/data/music.json', r => r.fulfill({ json: { tracks: [] } }))
 await context.route('https://api.github.com/repos/**', r => r.fulfill({ json: { description: 'A real Git protocol fixture for browser history.' } }))
 await context.route('https://cors.isomorphic-git.org/**', async route => {
   gitRequests++
   const request = route.request(), url = new URL(request.url())
   calls.push({ url: url.pathname, method: request.method() })
   if (networkMode === 'hold') { sawHeld?.(); await new Promise(resolve => { release = resolve }); try { await route.abort() } catch { /* terminated worker */ } return }
   if (networkMode === 'error') return route.fulfill({ status: 503, body: 'Unavailable' })
   const endpoint = url.pathname.endsWith('/info/refs') ? '/info/refs' : '/git-upload-pack'
   const body = request.postDataBuffer()
   const response = await new Promise((resolve, reject) => {
     const child = spawn('git', ['http-backend'], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: '/repo.git' + endpoint, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: request.method(), CONTENT_TYPE: request.headers()['content-type'] || '', CONTENT_LENGTH: String(body?.length || 0), SERVER_PROTOCOL: 'HTTP/1.1' } })
     const chunks = []; child.stdout.on('data', c => chunks.push(c)); child.stderr.resume()
     child.on('error', reject); child.on('close', code => code ? reject(new Error(`git http-backend ${code}`)) : resolve(Buffer.concat(chunks)))
     child.stdin.end(body)
   })
   const split = response.indexOf('\r\n\r\n'), headers = Object.fromEntries(response.subarray(0, split).toString().split('\r\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).toLowerCase(), l.slice(i + 1).trim()] }))
   await route.fulfill({ status: Number.parseInt(headers.status || '200'), headers: { 'content-type': headers['content-type'], 'access-control-allow-origin': '*' }, body: response.subarray(split + 4) })
 })
 const waitViewer = async () => { await page.waitForFunction(() => document.querySelector('[role=alert]') || window.__gource && !document.querySelector('[role=status]'), {}, { timeout: 30000 }); assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allTextContents()); const pause = page.getByRole('button', { name: 'Pause', exact: true }); if (await pause.count()) await pause.click() }
 await page.goto(new URL('viewer.html', BASE).href)
 await waitViewer()
 assert.equal(gitRequests, 0, 'prebuilt example opens without Git or relay')
 await page.getByRole('button', { name: 'Load more history' }).click()
 await waitViewer()
 assert.equal(await page.getByLabel('Max commits to load').inputValue(), '1000')
 assert.ok(calls.some(c => c.method === 'POST'), 'actual Git pack protocol used')
 assert.equal(await page.getByLabel('Branch').locator('option').count(), 2)
 assert.match(await page.locator('.repo-details').innerText(), /4\nauthors\n1\nlines\n4/)
 assert.match(await page.locator('.repo-description').innerText(), /real Git protocol fixture/)
 // Cache is used across reloads and refresh explicitly bypasses it.
 const count = gitRequests
 await page.reload(); await waitViewer()
 assert.equal(gitRequests, count, 'saved history needs no Git network request')
 assert.match(await page.locator('.browser-history-bar').innerText(), /Saved history/)
 await page.getByRole('button', { name: 'Refresh history' }).click(); await waitViewer()
 assert.ok(gitRequests > count, 'refresh downloads a fresh history')
 // A selected branch has its own cache and goes through the worker.
 await page.getByLabel('Branch').selectOption('feature'); await waitViewer()
 assert.match(page.url(), /ref=feature/)
 assert.equal(await page.getByLabel('Branch').inputValue(), 'feature')
 // Cancellation terminates the worker and restores the previous visualization.
 networkMode = 'hold'
 const held = new Promise(resolve => { sawHeld = resolve })
 await page.getByRole('button', { name: 'Refresh history' }).click(); await held
 await page.getByRole('button', { name: 'Cancel download' }).click()
 assert.equal(await page.getByRole('status').count(), 0)
 release(); networkMode = 'error'
 await page.getByRole('button', { name: 'Refresh history' }).click()
 await page.getByRole('alert').waitFor()
 assert.match(await page.getByRole('alert').innerText(), /503/)
 networkMode = 'ok'
 await page.getByRole('button', { name: 'Try again', exact: true }).click(); await waitViewer()
 await page.getByRole('button', { name: 'Clear saved histories' }).click()
 const rows = await page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('gource-browser-histories-v1'); r.onsuccess = () => resolve(r.result) }); try { return await new Promise(resolve => { const r = db.transaction('histories').objectStore('histories').count(); r.onsuccess = () => resolve(r.result) }) } finally { db.close() } })
 assert.equal(rows, 0)
 await page.setViewportSize({ width: 390, height: 844 })
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile controls fit')
 fs.mkdirSync(process.env.S || 'checks/out', { recursive: true })
 await page.screenshot({ path: path.join(process.env.S || 'checks/out', 'browser-git-mobile.png') })
 // Clone data is temporary; only the bounded processed-history cache remains.
 const databases = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name))
 assert.ok(databases.every(n => !n.startsWith('gource-clone-')), 'temporary clone storage is removed')
 assert.deepEqual(errors, [])
 console.log('browser Git check passed: real clone, native counts, branches, cache, refresh, cancellation, retry, cleanup and mobile layout')
} finally { await browser.close(); fs.rmSync(root, { recursive: true, force: true }) }
