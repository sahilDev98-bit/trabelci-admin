import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173/pdf-engine-smoketest.html', { waitUntil: 'domcontentloaded' })
const r = await page.evaluate(async () => {
  const m = await import('/src/lib/pdf-engine/groupOpsTest.ts')
  return await m.runNaiveDeleteDemo()
})
console.log(JSON.stringify(r, null, 2))
await browser.close()
