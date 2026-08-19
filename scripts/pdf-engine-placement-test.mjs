/**
 * Adding an image: does it land somewhere you can actually grab it?
 *
 * The reported fault was that the "Add image" button produced an image you
 * could not resize, while dropping a file worked fine. The engine was never
 * the problem — add-then-resize works when called directly. The problem was
 * WHERE the button put it: always 48pt in from the top-left corner, which on
 * a designed page is exactly where the logo lives. Logos and text draw above
 * images, so the new image's top corners — its resize handles — ended up
 * underneath the logo's own box and could not be grabbed.
 *
 * So this checks placement against the REAL page: the chosen spot must not
 * collide with the logo, and the image must still be resizable afterwards.
 *
 *   npx vite --port 5174                              (one terminal)
 *   node scripts/pdf-engine-placement-test.mjs [baseUrl] [pdfUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"
const PDF = process.argv[3] ?? "/dev-fixtures/REFIN.pdf"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async (pdfUrl) => {
  const { PdfEngineClient } = await import("/src/lib/pdf-engine/index.ts")
  const { findFreeSpot, newImageSize } = await import(
    "/src/pages/create-pdf/engine-editor/placement.ts"
  )
  const out = { errors: [] }
  const engine = new PdfEngineClient()
  const srcBytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
  const { docId, pages } = await engine.open(srcBytes.slice().buffer)
  const page0 = pages[0]

  // Everything already on the page, exactly as the editor gathers it.
  const lines = (await engine.listTextLines(docId, 0)).lines
  const images = (await engine.listImages(docId, 0)).images
  const groups = (await engine.listVectorGroups(docId, 0)).groups
  const occupied = [
    ...lines.map((l) => l.bbox),
    ...images.map((i) => i.bbox).filter(Boolean),
    ...groups.map((g) => g.bbox),
  ]
  out.occupiedCount = occupied.length
  const logo = groups.find((g) => g.pathCount > 5)
  out.logoBox = logo ? logo.bbox : null

  const size = newImageSize(page0, 800, 600, 180)
  out.size = size

  // ---------- the OLD placement, for comparison ----------
  const oldSpot = { x: 48, y: page0.heightPts - 48 - size.height }
  const overlaps = (a, b) =>
    a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top
  const boxAt = (s) => ({
    left: s.x, bottom: s.y, right: s.x + size.width, top: s.y + size.height,
  })
  out.oldSpot = oldSpot
  out.oldCollidedWithLogo = logo ? overlaps(boxAt(oldSpot), logo.bbox) : false

  // ---------- the NEW placement ----------
  const spot = findFreeSpot(page0, occupied, size)
  out.newSpot = { x: Math.round(spot.x), y: Math.round(spot.y) }
  out.newCollidedWithLogo = logo ? overlaps(boxAt(spot), logo.bbox) : false
  // And with anything else that would sit above it.
  out.newCollisions = occupied.filter((b) => {
    const area = (b.right - b.left) * (b.top - b.bottom)
    const isBackground = area / (page0.widthPts * page0.heightPts) > 0.6
    return !isBackground && overlaps(boxAt(spot), b)
  }).length

  if (!out.oldCollidedWithLogo) {
    out.errors.push("the OLD placement did not collide with the logo — this fixture cannot show the fault")
  }
  if (out.newCollidedWithLogo) {
    out.errors.push("the new placement still lands under the logo")
  }

  // ---------- and it is genuinely usable once added ----------
  const png = Uint8Array.from(atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ), (c) => c.charCodeAt(0))
  const add = await engine.addImageOverlay(
    docId, 0, { x: spot.x, y: spot.y, width: size.width, height: size.height },
    png.buffer, "png",
  )
  out.reportedNewIndex = add.newIndex
  const after = (await engine.listImages(docId, 0)).images
  out.imageCountAfter = after.length
  out.addedBbox = after[add.newIndex]?.bbox ?? null
  if (!out.addedBbox) {
    out.errors.push("the reported index does not point at the added image")
  } else if (Math.abs(out.addedBbox.left - spot.x) > 1) {
    out.errors.push("the added image is not where it was placed")
  }

  // Resize it, as a corner drag would.
  const resize = await engine.setImageRect(docId, 0, add.newIndex, {
    x: spot.x, y: spot.y, width: size.width * 1.4, height: size.height * 1.4,
  })
  const resized = (await engine.listImages(docId, 0)).images[resize.newIndex]
  out.widthAfterResize = resized?.bbox ? Math.round(resized.bbox.right - resized.bbox.left) : null
  out.resizeWorked = out.widthAfterResize !== null
    && Math.abs(out.widthAfterResize - size.width * 1.4) <= 2
  if (!out.resizeWorked) out.errors.push("the added image could not be resized")

  await engine.close(docId)
  engine.terminate()
  return out
}, PDF)

console.log(JSON.stringify(result, null, 2))
if (pageErrors.length) console.log("\nPAGE ERRORS:", pageErrors)
await browser.close()

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,
  "the fixture reproduces the old fault": result.oldCollidedWithLogo === true,
  "the new placement clears the logo": result.newCollidedWithLogo === false,
  "and clears everything else on the page": result.newCollisions === 0,
  "the add reports where it landed": result.reportedNewIndex >= 0 && !!result.addedBbox,
  "the added image can be resized": result.resizeWorked === true,
}

console.log("\n=========== IMAGE PLACEMENT CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
