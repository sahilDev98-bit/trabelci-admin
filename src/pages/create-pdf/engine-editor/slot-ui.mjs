import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]))
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
const before = errs.length
const r = await page.evaluate(async () => {
  const m = await import('/src/pages/create-pdf/engine-editor/groupToolbarSelfTest.ts')
  return await m.runGroupToolbarSelfTest()
})
console.log(JSON.stringify(r, null, 2))
console.log('errors added:', errs.length - before)
console.log(r.errors.length === 0 ? 'OK' : 'FAILED')
await browser.close()
