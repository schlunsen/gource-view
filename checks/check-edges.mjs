import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const S = process.env.S
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message))
const from = 1700000000, to = 1701000000
// a realistic nested monorepo (backend + desktop + gateway)
const folders = [
  ['desktop/frontend/src/components', 14, 'vue'], ['desktop/frontend/src/stores', 6, 'ts'], ['desktop/frontend/src/types', 4, 'ts'],
  ['desktop/frontend/src/api', 5, 'ts'], ['desktop', 3, 'go'],
  ['django_backend/apps/messages/tasks/agent_loop/tools', 12, 'py'], ['django_backend/apps/messages/tasks', 6, 'py'],
  ['django_backend/apps/messages', 5, 'py'], ['django_backend/apps/integrations/tool_definitions', 9, 'json'],
  ['django_backend/apps/integrations', 7, 'py'], ['django_backend/apps/connectors', 8, 'py'], ['django_backend/apps/hosted_apps', 10, 'py'],
  ['django_backend/tests', 12, 'py'], ['ws_gateway/lib', 8, 'ex'], ['k8s/moon', 6, 'yaml'], ['deploy', 5, 'sh'], ['docs', 6, 'md'], ['assets', 5, 'png'],
]
const commits = []
let i = 0
for (let c = 0; c < 60; c++) {
  const ts = from + c * (to - from) / 59
  const files = []
  const picks = c < 6 ? folders.slice(c * 3, c * 3 + 3) : [folders[c % folders.length], folders[(c * 7) % folders.length]]
  for (const [dir, n, ext] of picks) for (let j = 0; j < (c < 6 ? n : 2); j++) files.push({ p: `${dir}/file${(j + c) % n}.${ext}`, a: 8, d: 1 })
  commits.push({ hash: String(i++), ts, name: ['Rasmus', 'Ada', 'Linus'][c % 3], files })
}
const result = { repo: 'example/edges', commits, stats: { from, to, commits: commits.length, authors: 3, loc: 12000, topAuthors: [['Rasmus', 20]] } }
await page.route('**/api/config', r => r.fulfill({ json: { defaultRepo: 'example/edges', gitea: null } }))
await page.route('**/api/load', r => r.fulfill({ json: { job: 'test' } }))
await page.route('**/api/status/test', r => r.fulfill({ json: { status: 'done', result } }))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button', { name: 'Pause', exact: true }).click()
const setSlider = v => page.getByRole('slider').evaluate((el, v) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, v)
for (const [f, name] of [[0.12, 'early'], [0.5, 'mid'], [1, 'full']]) {
  await setSlider(Math.round(from + (to - from) * f))
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${S}/edges-${name}.png` })
}
// hover a folder: ask the renderer where a mid-depth folder is on screen
const box = await page.locator('canvas').boundingBox()
const dirs = await page.evaluate(() => window.__gource.probe())
const target = dirs.find(d => d.path === 'django_backend/apps/messages') || dirs[Math.floor(dirs.length / 2)]
await page.mouse.move(box.x + target.x, box.y + target.y)
const hovered = !!target
await page.waitForTimeout(300)
await page.screenshot({ path: `${S}/edges-hover.png` })
assert.deepEqual(errors, [])
console.log('edges check ok', { hovered })
await browser.close()
