import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 200 } })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
for (const lang of ['en', 'he']) {
  await page.evaluate(async (l) => {
    const m = await import('/src/pages/create-pdf/engine-editor/groupToolbarSelfTest.ts')
    await m.showSlotToolbar(l)
  }, lang)
  await page.screenshot({ path: `d:/tmp/pwrepro/slot-toolbar-${lang}.png`, clip: { x: 0, y: 0, width: 1700, height: 62 } })
}
console.log('done')
await browser.close()
