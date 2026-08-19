/**
 * Full screen: does the page fit, and does the toolbar follow the selection?
 *
 * Also checks the arithmetic the feature rests on — that filling the screen
 * with the whole page makes small text SMALLER than the windowed view, and
 * that zoom is what fixes it. Get that backwards and the feature is pointed
 * the wrong way.
 *
 *   npx vite --port 5174                              (one terminal)
 *   node scripts/pdf-engine-fullscreen-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
// A laptop screen, which is what this was designed against.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/fullscreenSelfTest.ts")
  return mod.runFullscreenSelfTest()
})

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const m = result.maths ?? {}
const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,

  // ---- the premise ----
  "fit-page really is smaller than the windowed view": m.fitPageZoom < m.windowedZoom,
  "fit-width really is bigger than the windowed view": m.fitWidthZoom > m.windowedZoom,
  "zooming to a 3pt line makes it readable": m.threePtZoomed >= 16,

  // ---- the shell ----
  "the shell fills the screen": result.overlayCoversViewport === true,
  "there is a toolbar": result.hasToolbar === true,
  "the toolbar has zoom": result.hasZoomControl === true,
  "fit-width fills the width": result.pageFitsWidth === true,
  "fit-page shows the whole page": result.wholePageVisible === true,
  "selecting adds tools rather than replacing them": result.toolbarChangedWithSelection === true,
  "Add text / Add image are there with nothing selected": result.addToolsPresentWhenNothingSelected === true,
  "and they survive selecting text": result.addToolsPresentWhenTextSelected === true,
  "and survive selecting an image": result.addToolsPresentWhenImageSelected === true,
  "the selection gets its own tools alongside": result.selectionToolsAppear === true,
  "exactly one element per page": result.maxElementsPerPage === 1,
  "and that check really detects duplicates": result.maxElementsPerPageWithDuplicate > result.maxElementsPerPage,
}

console.log("\n=========== FULL SCREEN CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (ok) {
  console.log(
    `\nsize of a 6pt caption:  windowed ${m.sixPtWindowed}px`
    + `  |  fit-page ${m.sixPtFitPage}px  |  fit-width ${m.sixPtFitWidth}px`
    + `  |  3pt zoomed to ${m.threePtZoomed}px`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
