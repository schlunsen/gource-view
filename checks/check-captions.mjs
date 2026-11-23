// Commit captions and the language legend: the caption follows history and
// hides under privacy, and the legend counts the files alive at that moment.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({headless:true})
const page = await browser.newPage({viewport:{width:1440,height:900}})
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const from=1700000000,to=1701000000
const ext=i=>i<50?'js':'ts'
const commits=Array.from({length:100},(_,i)=>({hash:'abc'+String(i).padStart(4,'0'),ts:from+i*(to-from)/99,name:'Developer '+i%4,subject:`Change number ${i}`,files:Array.from({length:5},(_,j)=>({p:`src/module${i%12}/file${j+i}.${ext(i)}`,a:10,d:2}))}))
const result={repo:'example/project',commits,stats:{from,to,commits:100,authors:4,loc:5000,topAuthors:[['Developer 0',25]]}}
await page.route('**/api/load',r=>r.fulfill({json:{job:'test'}}))
await page.route('**/api/status/test',r=>r.fulfill({json:{status:'done',result}}))
await page.goto('http://127.0.0.1:5173/viewer.html')
await page.getByRole('button',{name:'Pause',exact:true}).click()
const at=f=>page.evaluate(f=>{const g=window.__gource;g.seek(g.from+(g.to-g.from)*f);return new Promise(r=>setTimeout(()=>r({caption:g.caption(),languages:g.languages().map(l=>[l.key,l.files])}),200))},f)
const early=await at(20/99+0.002) // just after a captioned commit
assert.match(early.caption.subject,/^Change number \d+$/)
assert.equal(early.caption.files,5); assert.equal(early.caption.added,50)
assert.deepEqual(early.languages.map(l=>l[0]),['js'])
const late=await at(1)
assert.match(late.caption.subject,/^Change number 9[89]$/)
assert.deepEqual(late.languages.map(l=>l[0]).sort(),['js','ts'])
const legend=page.locator('.file-legend')
await assert.doesNotReject(legend.getByText('TypeScript').waitFor())
assert.match(await legend.innerText(),/JavaScript\s+\d+%/)
// subjects name files and features: privacy hides them
await page.keyboard.press('h')
assert.equal(await page.evaluate(()=>window.__gource.caption()),null)
await page.keyboard.press('h'); await page.keyboard.press('h')
assert.notEqual(await page.evaluate(()=>window.__gource.caption()),null)
// phones: the legend moves into a strip above the transport and nothing overflows
await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300)
await page.locator('.language-strip').getByText('TypeScript').waitFor()
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
assert.deepEqual(errors,[])
console.log('Caption checks passed: subject follows history, privacy hides it, legend counts live files, phone strip fits.')
await browser.close()
