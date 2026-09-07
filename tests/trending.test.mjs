import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseTrending, createTrendingStore } from '../server/trending.js'

const article = (name, lang, week, total, desc) => `<article class="Box-row"><h2 class="h3 lh-condensed"><a href="/${name}" data-hydro-click="x">x</a></h2>
<p class="col-9 color-fg-muted my-1 pr-4">  ${desc} <b>bold</b> </p><span itemprop="programmingLanguage">${lang}</span>
<a href="/${name}/stargazers" class="Link"><svg></svg> ${total} </a><span class="d-inline-block float-sm-right"><svg></svg> ${week} stars this week</span></article>`
const html = '<html>' + article('acme/rocket', 'Rust', '1,234', '50,701', 'Fast rockets') + article('foo/bar', 'TypeScript', '99', '3,646', 'Bars') + '</html>'

test('parses trending articles', () => {
  const r = parseTrending(html)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { name: 'acme/rocket', description: 'Fast rockets bold', language: 'Rust', gained: 1234, stars: 50701 })
  assert.equal(parseTrending('<html>nothing</html>').length, 0)
})

test('store refreshes once, serves the cache, and persists to disk', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trend-')), 'cache.json')
  let pageHits = 0, apiHits = 0
  const fetchImpl = async (url) => {
    if (url.includes('github.com/trending')) { pageHits++; return { ok: true, text: async () => html + article('a/b', '', '1', '1', '') + article('c/d', '', '1', '1', '') + article('e/f', '', '1', '1', '') } }
    apiHits++; return { ok: true, json: async () => url.includes('/search/') ? { items: [{ full_name: 'new/one', stargazers_count: 5, size: 1024 }] } : { size: 2048 } }
  }
  const store = createTrendingStore({ file, fetchImpl, refreshMs: 1000 })
  const a = await store.get(); assert.equal(a.periods.weekly.repos.length, 5); assert.equal(a.periods.weekly.repos[0].sizeMb, 2); assert.equal(pageHits, 3, 'daily, weekly, monthly pages')
  assert.equal(a.periods.quarter.source, 'search · created in the last 3 months'); assert.equal(a.periods.quarter.repos[0].name, 'new/one')
  const b = await store.get(); assert.equal(b.fetchedAt, a.fetchedAt); assert.equal(pageHits, 3, 'cached')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).periods.weekly.repos.length, 5)
  const warm = createTrendingStore({ file, fetchImpl, refreshMs: 1000 })
  assert.equal((await warm.get()).periods.weekly.repos.length, 5, 'disk cache survives restarts')
  assert.equal(pageHits, 3); assert.equal(apiHits, 2 + 5, 'two searches, then one size lookup per distinct page repo (search results already carry sizes)')
})

test('falls back to the search api when the page cannot be parsed', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trend-')), 'cache.json')
  const fetchImpl = async (url) => url.includes('github.com/trending') ? { ok: false, status: 503 } : { ok: true, json: async () => ({ items: [{ full_name: 'x/y', description: 'd', language: 'Go', stargazers_count: 9, size: 1024 }] }) }
  const s = await createTrendingStore({ file, fetchImpl }).get()
  assert.equal(s.periods.weekly.source, 'search · created this week'); assert.equal(s.periods.weekly.repos[0].name, 'x/y'); assert.equal(s.periods.weekly.repos[0].sizeMb, 1)
})
