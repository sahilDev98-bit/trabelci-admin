/**
 * Runs the editor's pointer self tests in a real headless Chromium.
 *
 * Drag behaviour is one of the few things that cannot be verified any other
 * way: it depends on the browser's own pipelines — the drag pipeline
 * (dropEffect, preventDefault, propagation between a slot and the page
 * beneath it) and, for cross-page dragging, real layout, real scrolling and
 * real animation frames. None of that is exercised by a type-check or a
 * direct handler call.
 *
 * Three suites run here:
 *   1. file drag-and-drop, selection and resize on a single page
 *   2. cross-page dragging with auto-scroll, on a two-page scroller
 *   3. the drop -> PDF-coordinate maths, as pure functions with exact
 *      expected numbers (a box can land on the right page and still be a
 *      few points out, which suite 2 cannot see)
 *
 * Requires Playwright, deliberately NOT a dependency of this app:
 *
 *   npx vite --port 5174                                  (one terminal)
 *   npx --yes playwright@1.62.1 install chromium          (once)
 *   node scripts/pdf-engine-dragdrop-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

// The dev-only harness page, not the app: the app's auth guard redirects
// and would tear down the context mid-test.
await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/dragDropSelfTest.ts")
  return mod.runDragDropSelfTest()
})

const cross = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/dragDropSelfTest.ts")
  return mod.runCrossPageDragSelfTest()
})

/**
 * The coordinate maths, checked against numbers worked out by hand.
 *
 * Fixture: a 600x800pt page shown 1:1, and a line whose ink box is
 * (50,300)-(250,350) with its anchor origin at (50,300) — so the baseline
 * sits 50pt below the box's top edge and the anchor has no side bearing.
 */
const geometry = await page.evaluate(async () => {
  const g = await import("/src/pages/create-pdf/engine-editor/dropGeometry.ts")
  const out = { errors: [] }
  const targetPage = { heightPts: 800 }
  const line = {
    bbox: { left: 50, bottom: 300, right: 250, top: 350 },
    matrix: { a: 40, b: 0, c: 0, d: 40, e: 50, f: 300 },
  }

  // A 1:1 page means px and pts are the same number.
  const pts = g.dropToPagePoints({ leftPx: 120, topPx: 200, widthPx: 200, heightPx: 50 }, 1)
  out.pts = pts
  if (pts.xPts !== 120 || pts.yFromTopPts !== 200) out.errors.push("dropToPagePoints did not pass coordinates through at 1:1")

  // Same page: the box was at left 50, top 800-350=450. Dropping it at
  // (120, 200) means +70 across and 250 UP the page.
  const delta = g.textMoveDelta(line, { heightPts: 800 }, 120, 200)
  out.delta = delta
  if (Math.abs(delta.dx - 70) > 0.01) out.errors.push(`dx was ${delta.dx}, expected 70`)
  if (Math.abs(delta.dy - 250) > 0.01) out.errors.push(`dy was ${delta.dy}, expected 250`)

  // Cross page: the baseline is 50pt below the box top, so a box top at
  // 200 from the page top puts the baseline at 800 - 200 - 50 = 550.
  const placed = g.textPlacementOnPage(line, targetPage, 120, 200)
  out.placed = placed
  if (Math.abs(placed.x - 120) > 0.01) out.errors.push(`placement x was ${placed.x}, expected 120`)
  if (Math.abs(placed.yBaseline - 550) > 0.01) out.errors.push(`baseline was ${placed.yBaseline}, expected 550`)

  // A dropped line must come back to the SAME place it was picked up from
  // if it is dropped at its own coordinates. This is the round trip that
  // catches an off-by-one convention error in either direction.
  const rt = g.textPlacementOnPage(line, { heightPts: 800 }, line.bbox.left, 800 - line.bbox.top)
  out.roundTrip = rt
  if (Math.abs(rt.x - line.matrix.e) > 0.01) out.errors.push(`round-trip x was ${rt.x}, expected ${line.matrix.e}`)
  if (Math.abs(rt.yBaseline - line.matrix.f) > 0.01) out.errors.push(`round-trip baseline was ${rt.yBaseline}, expected ${line.matrix.f}`)

  // RTL: grouping anchors a Hebrew line on its RIGHTMOST piece, so the
  // anchor origin sits at the box's right edge. Assuming the origin is the
  // box corner would drop it a whole line-width away.
  const rtl = {
    bbox: { left: 50, bottom: 300, right: 250, top: 350 },
    matrix: { a: 40, b: 0, c: 0, d: 40, e: 250, f: 300 },
  }
  const rtlPlaced = g.textPlacementOnPage(rtl, targetPage, 120, 200)
  out.rtlPlaced = rtlPlaced
  if (Math.abs(rtlPlaced.x - 320) > 0.01) out.errors.push(`RTL x was ${rtlPlaced.x}, expected 320 (120 + 200 anchor inset)`)

  // Image: y is the BOTTOM edge measured up from the page bottom, so a
  // 50pt-tall box 200pt down from the top has its bottom at 800-200-50.
  const img = g.imagePlacement(targetPage, 120, 200, 200, 50)
  out.img = img
  if (Math.abs(img.y - 550) > 0.01) out.errors.push(`image y was ${img.y}, expected 550`)
  if (img.x !== 120 || img.width !== 200 || img.height !== 50) out.errors.push("image rect did not pass size/x through")

  return out
})

console.log("SINGLE PAGE:", JSON.stringify(result, null, 2))
console.log("\nCROSS PAGE:", JSON.stringify(cross, null, 2))
console.log("\nGEOMETRY:", JSON.stringify(geometry, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,
  "image slot visible while text layer is on": result.slotRendered === true,
  "slot highlights while a file hovers it": result.slotHighlighted === true,
  "drop on a photo targets that photo": result.droppedOnImage?.imageIndex === 0,
  "drop on a photo does not also add a floating copy": !!result.droppedOnImage,
  "drop on bare page fires": !!result.droppedOnPage,
  "dropped image lands at the drop point": !!result.droppedOnPage
    && Math.abs(result.droppedOnPage.xPts - 450) <= 2
    && Math.abs(result.droppedOnPage.yFromTopPts - 100) <= 2,
  "non-file drags are ignored": result.ignoredNonFileDrag === true,
  "handles hidden until a slot is selected": result.handlesHiddenUntilSelected === true,
  "four resize handles appear when selected": result.handlesShownWhenSelected === true,
  "dragging a corner resizes it": !!result.resizedTo && result.resizedTo.width > 200,
  "no floating toolbar covers the page": result.noToolbarOnSelect === true,
  "a selected image slot has no buttons": result.noButtonsOnImageSlot === true,

  // ---- cross-page ----
  "no cross-page errors": cross.errors.length === 0,
  "a ghost appears when a drag starts": cross.sameGhostAppears === true,
  "holding at the edge auto-scrolls": cross.autoScrolledBy > 0,
  "target re-targets while auto-scrolling a still pointer": cross.retargetedDuringAutoScroll === true,
  "the page under the cursor is marked as target": cross.targetPageHighlighted === true,
  "releasing over another page reports that page": cross.crossDrop?.targetPageIndex === 1,
  "the drop remembers which page it came from": cross.crossDrop?.item.pageIndex === 0,
  "the ghost keeps the grab offset": !!cross.crossDrop,
  "a drag ending on its own page still commits": !!cross.samePageDrop,
  "Escape abandons a drag": cross.escapeCancelled === true,
  "a text drag shows the words, not a page crop": cross.textGhostShowsWords === true
    && cross.textGhostHasNoCrop === true,
  "an image drag shows the image's own pixels": cross.imageGhostHasCrop === true,
  "the original is covered while in flight": cross.originCoveredWhileDragging === true,
  "a click reads as ~0 travel, not a move": cross.clickTravelledPx !== null && cross.clickTravelledPx <= 2,
  "a real drag reads as clear travel": cross.dragTravelledPx !== null && cross.dragTravelledPx > 5,
  "the drop measures the page as it is actually drawn":
    cross.reportedPageWidth !== null && cross.reportedPageWidth === cross.actualPageWidth,

  // ---- geometry ----
  "no geometry errors": geometry.errors.length === 0,
  "same-page move computes the right delta": Math.abs(geometry.delta.dx - 70) <= 0.01
    && Math.abs(geometry.delta.dy - 250) <= 0.01,
  "cross-page placement puts the baseline right": Math.abs(geometry.placed.yBaseline - 550) <= 0.01,
  "dropping a line where it already is moves it nowhere": Math.abs(geometry.roundTrip.yBaseline - 300) <= 0.01
    && Math.abs(geometry.roundTrip.x - 50) <= 0.01,
  "RTL lines account for their right-edge anchor": Math.abs(geometry.rtlPlaced.x - 320) <= 0.01,
  "image placement flips y to the bottom edge": Math.abs(geometry.img.y - 550) <= 0.01,
}

console.log("\n=========== DRAG & DROP CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
