// Dev preview server: serves the built dist/ + proxies /api to the backend on 8790
import express from 'express'
import { createServer } from 'node:http'
import http from 'node:http'
import path from 'node:path'

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use('/api', (req, res) => {
  const body = JSON.stringify(req.body || {})
  const options = {
    hostname: '127.0.0.1',
    port: 8790,
    path: req.url,
    method: req.method,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      host: '127.0.0.1:8790',
    },
  }
  const pr = http.request(options, (prRes) => {
    res.writeHead(prRes.statusCode, prRes.headers)
    prRes.pipe(res)
  })
  pr.on('error', (e) => { res.status(502).json({ error: e.message }) })
  pr.write(body)
  pr.end()
})
app.use(express.static(path.join(process.cwd(), 'dist')))

const port = 5173
createServer(app).listen(port, () => console.log(`[preview] serving dist on :${port}`))
