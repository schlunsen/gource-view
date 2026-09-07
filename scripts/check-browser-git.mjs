// Isolated production-build check: no fixed port, live GitHub service or app backend.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gource-pages-check-'))
let server
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--base=/gource-view/', '--outDir', temp], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_STATIC: '1', VITE_GIT_PROXY: '', VITE_REPO_URL: 'https://github.com/schlunsen/gource-view' } })
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const file = path.resolve(temp, '.' + pathname.replace(/^\/gource-view/, '').replace(/\/$/, '/index.html'))
    if (!file.startsWith(temp + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'checks/check-browser-git.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, BASE: `http://127.0.0.1:${server.address().port}/gource-view/` } })
    child.on('error', reject); child.on('close', resolve)
  })
  if (code !== 0) process.exitCode = 1
} finally { server?.close(); fs.rmSync(temp, { recursive: true, force: true }) }
