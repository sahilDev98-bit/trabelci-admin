/**
 * Ctrl + wheel zoom, and the chrome around the page.
 *
 * The zoom is the point of this screen. A quarter of the catalogue it was
 * built for is under 7pt and the smallest is 3pt, so being able to make the
 * page bigger comfortably is not a nicety — it is how those captions get
 * edited at all.
 *
 * Two properties carry the whole feature and both are measured here against
 * real wheel events rather than described:
 *
 *   - the point under the pointer does not move. Zoom that grows from a
 *     corner sends what you were reading off the screen.
 *   - the gesture never lays the column out. One width change costs about
 *     144ms on a real catalogue and a wheel fires twenty times a second, so
 *     a gesture that lays out is a gesture that jams.
 *
 *   npx vite --port 5174                          (one terminal)
 *   node scripts/pdf-engine-zoom-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const zoom = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/zoomGestureSelfTest.ts")
  return mod.runZoomGestureSelfTest()
})
const chrome = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/viewerChromeSelfTest.ts")
  return mod.runViewerChromeSelfTest()
})
await browser.close()

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": zoom.errors.length === 0 && chrome.errors.length === 0,

  // ---- the pin ----
  "the point under the pointer holds still": zoom.pinDriftPx <= 4,
  "...and that check would catch it if it did not":
    zoom.pinDriftWithoutAnchoringPx > 10,
  "it holds while zooming out too": zoom.pinDriftZoomingOutPx <= 4,
  "the zoom-out stopped where anchoring is still possible":
    zoom.stillWiderThanWindow === true,
  "zoomed below the window, the page is centred": zoom.narrowPageOffCentrePx <= 4,

  // ---- the gesture is free ----
  "the wheel makes the page bigger": zoom.widthPreviewed > zoom.widthBefore,
  "a burst of 10 events costs almost nothing": zoom.burstMs <= 120,
  "...with a document heavy enough to expose a stray render":
    zoom.slotsMounted >= 500,

  // ---- and letting go is invisible ----
  "committing the real width does not move the page": zoom.commitSeamPx <= 4,
  "the committed width matches the preview":
    Math.abs(zoom.widthCommitted - zoom.widthPreviewed) <= 4,
  "the same on the way out": zoom.commitSeamZoomingOutPx <= 4,

  // ---- and it behaves ----
  "a plain wheel still scrolls": zoom.plainWheelZoomed === false && zoom.plainWheelScrolled,
  "zoomed in, the left edge is reachable": zoom.leftEdgeReachable === true,
  "zoom stops at the renderer's limit": zoom.stoppedAtLimit === true,

  // ---- the strip and the floating bar ----
  "the strip shows every page": chrome.thumbnailCount === chrome.pageCount,
  "every thumbnail draws": chrome.thumbnailsWithPicture === chrome.pageCount,
  "exactly one page is marked current": chrome.markedCurrent === 1,
  "scrolling the document moves the strip": chrome.currentAfterScroll === 4,
  "clicking the strip moves the document": chrome.currentAfterThumbnailClick === 2,
  "the floating bar agrees with the strip": chrome.barLabel.includes("1 / 6"),
  "its Next button works": chrome.barLabelAfterNext.includes("2 / 6"),
  "Previous is spent on page 1": chrome.prevDisabledOnFirstPage === true,
  "Next is spent on the last page": chrome.nextDisabledOnLastPage === true,

  // ---- the scrollbars belong to the app, not the OS ----
  "both scrollers use the themed scrollbar": chrome.themedClassApplied === true,
  "and the rule for it is actually loaded": chrome.scrollbarRuleLoaded === true,
  "where the browser draws a real bar, ours is narrower":
    chrome.defaultScrollbarPx === 0
    || chrome.pageScrollbarPx !== chrome.defaultScrollbarPx,

  // ---- and neither costs more than it should ----
  "an edit to one page redraws one thumbnail": chrome.rendersAfterOnePageEdit <= 1,
  "an edit of unknown extent redraws them all":
    chrome.rendersAfterUnknownEdit >= chrome.pageCount,
  "an edit to one page redraws one page": chrome.pageRendersAfterOnePageEdit <= 1,
  "...with enough pages mounted for that to mean something": chrome.pagesEverSeen >= 3,
}

console.log("\n=========== ZOOM AND VIEWER CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (!ok) {
  console.log("\nzoom:", JSON.stringify(zoom, null, 2))
  console.log("chrome:", JSON.stringify(chrome, null, 2))
  if (pageErrors.length) console.log("page errors:", pageErrors)
} else {
  console.log(
    `\npin drift ${zoom.pinDriftPx}px against ${zoom.pinDriftWithoutAnchoringPx}px unanchored`
    + `  |  10 wheel events in ${zoom.burstMs}ms with ${zoom.slotsMounted} slots`
    + `  |  commit seam ${zoom.commitSeamPx}px`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
