/**
 * Hebrew must behave exactly like English.
 *
 * The app flips to right-to-left for Hebrew, and the flip is not cosmetic.
 * CSS logical properties swap sides, and a browser renumbers a container's
 * horizontal scroll — zero moves to the RIGHT edge and counts backwards.
 * A PDF page is physical: its coordinates do not flip when the interface
 * language does. Mix the two and things behave inside out with nothing
 * thrown and nothing logged.
 *
 * Two of those were real. Dragging a box's corner resized it BACKWARDS in
 * Hebrew, because the grips were placed with logical CSS while the maths
 * behind them was physical — so the grip named "north-west" sat on the
 * north-EAST corner. And zooming threw the page nearly a thousand pixels
 * sideways, because the anchoring arithmetic assumed scroll starts at the
 * left.
 *
 * Everything here runs in BOTH directions and the two must agree. A check
 * that only ran in Hebrew could pass on a page that was broken in both.
 *
 *   npx vite --port 5174                        (one terminal)
 *   node scripts/pdf-engine-rtl-test.mjs [baseUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const rtl = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/rtlSelfTest.ts")
  return mod.runRtlSelfTest()
})

// The whole existing drag-and-drop suite, run again under Hebrew. Cheaper
// and broader than re-deriving those cases here: if any of its two dozen
// checks depends on the interface reading left to right, this is where it
// shows up.
const dragBothWays = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/dragDropSelfTest.ts")
  const run = async (direction) => {
    const previous = document.documentElement.getAttribute("dir")
    document.documentElement.setAttribute("dir", direction)
    try {
      const r = await mod.runDragDropSelfTest()
      return { direction, errors: r.errors, resizedTo: r.resizedTo, droppedOnPage: r.droppedOnPage }
    } finally {
      if (previous === null) document.documentElement.removeAttribute("dir")
      else document.documentElement.setAttribute("dir", previous)
    }
  }
  return { ltr: await run("ltr"), rtl: await run("rtl") }
})

await browser.close()

const l = rtl.ltr ?? {}
const r = rtl.rtl ?? {}
const same = (key) => JSON.stringify(l[key]) === JSON.stringify(r[key])

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": rtl.errors.length === 0,

  // ---- resizing, the reported fault ----
  "English: the top-left grip moves the left edge":
    l.imageLeftDelta === -40 && l.imageWidthDelta === 40,
  "Hebrew: the same, exactly": r.imageLeftDelta === -40 && r.imageWidthDelta === 40,
  "English: text boxes resize the same way":
    l.textLeftDelta === -40 && l.textWidthDelta === 40,
  "Hebrew: text boxes too": r.textLeftDelta === -40 && r.textWidthDelta === 40,
  "the grips sit on the box's real corners in both":
    l.handleCornerErrorPx <= 12 && r.handleCornerErrorPx <= 12,

  // ---- zooming ----
  "English: zoom stays pinned to the pointer": l.zoomPinDriftPx <= 4,
  "Hebrew: zoom stays pinned too": r.zoomPinDriftPx <= 4,

  // ---- and the readouts are not re-ordered by bidi ----
  "English: the page counter reads 1 / 6": l.pageCounterText === "1 / 6",
  "Hebrew: it still reads 1 / 6, not 6 / 1": r.pageCounterText === "1 / 6",

  // ---- the two directions agree on every measurement ----
  "both directions resize identically":
    same("imageLeftDelta") && same("imageWidthDelta")
    && same("textLeftDelta") && same("textWidthDelta"),

  // ---- and the existing drag suite passes in Hebrew ----
  "the drag-and-drop suite passes in English": dragBothWays.ltr.errors.length === 0,
  "...and in Hebrew": dragBothWays.rtl.errors.length === 0,
  "a slot resizes to the same box in both":
    JSON.stringify(dragBothWays.ltr.resizedTo) === JSON.stringify(dragBothWays.rtl.resizedTo),
  "a file dropped on the page lands in the same place":
    JSON.stringify(dragBothWays.ltr.droppedOnPage)
    === JSON.stringify(dragBothWays.rtl.droppedOnPage),
}

console.log("\n=========== HEBREW / RIGHT-TO-LEFT CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (!ok) {
  console.log("\n" + JSON.stringify(rtl, null, 2))
  console.log("drag:", JSON.stringify(dragBothWays, null, 2))
  if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 5))
} else {
  console.log(
    `\nresize  English ${l.imageLeftDelta}/${l.imageWidthDelta}`
    + `  Hebrew ${r.imageLeftDelta}/${r.imageWidthDelta}`
    + `   |   zoom drift  English ${l.zoomPinDriftPx}px  Hebrew ${r.zoomPinDriftPx}px`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
