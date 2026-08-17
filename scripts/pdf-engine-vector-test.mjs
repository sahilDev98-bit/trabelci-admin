/**
 * Vector artwork — logos and icons drawn as paths — through the real engine.
 *
 * The REFIN mark is the case this exists for: it looks like a picture, but
 * in the PDF it is seventeen separate path objects (a diamond, then one per
 * letter), which is why it offered nothing to click. It has to come back as
 * ONE item covering the whole logo, be removable, and be replaceable by an
 * uploaded image that lands where it was.
 *
 *   npx vite --port 5174                            (one terminal)
 *   node scripts/pdf-engine-vector-test.mjs [baseUrl] [pdfUrl]
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
  const out = { errors: [] }
  const engine = new PdfEngineClient()
  // Kept as bytes and copied per open: the engine TRANSFERS the buffer it
  // is given, so reusing the original for a second document detaches it.
  const srcBytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
  const copy = () => srcBytes.slice().buffer
  const { docId, pages } = await engine.open(copy())

  // ---------- 1. the logo comes back as ONE item ----------
  const groups = (await engine.listVectorGroups(docId, 0)).groups
  out.groupsOnPage0 = groups.length
  out.groups = groups.map((g) => ({
    paths: g.pathCount,
    w: Math.round(g.bbox.right - g.bbox.left),
    h: Math.round(g.bbox.top - g.bbox.bottom),
    x: Math.round(g.bbox.left),
    y: Math.round(g.bbox.bottom),
  }))

  // The logo: many paths merged into one mark near the top of the page.
  const logo = groups.find((g) => g.pathCount > 5)
  out.foundLogo = !!logo
  if (!logo) {
    out.errors.push("the multi-path logo was not grouped into a single item")
    return out
  }
  out.logoPaths = logo.pathCount
  // One slot for the whole mark, not one per letter.
  if (groups.length > 3) {
    out.errors.push(`${groups.length} artwork slots on page 0 — the grouping is too fine`)
  }

  // ---------- 2. rasterise the logo's box before and after ----------
  const SCALE = 3
  const shot = async (id) => {
    const r = await engine.renderPage(id, 0, SCALE)
    return { w: r.width, h: r.height, px: new Uint8Array(r.rgba) }
  }
  const inkIn = (img, box, pageHeightPts) => {
    const x0 = Math.round(box.left * SCALE), x1 = Math.round(box.right * SCALE)
    const y0 = Math.round((pageHeightPts - box.top) * SCALE)
    const y1 = Math.round((pageHeightPts - box.bottom) * SCALE)
    let dark = 0, total = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
        const i = (y * img.w + x) * 4
        total++
        // The mark is drawn light on a dark photo, so "ink" here is any
        // pixel far from its surroundings — measured as near-white.
        if (img.px[i] > 200 && img.px[i + 1] > 200 && img.px[i + 2] > 200) dark++
      }
    }
    return total ? Number((dark / total).toFixed(4)) : 0
  }

  const pageHeight = pages[0].heightPts
  out.logoInkBefore = inkIn(await shot(docId), logo.bbox, pageHeight)

  // ---------- 3. remove it ----------
  await engine.removeVectorGroup(docId, 0, logo.vectorIndex)
  const after = (await engine.listVectorGroups(docId, 0)).groups
  out.groupsAfterRemove = after.length
  if (after.length !== groups.length - 1) {
    out.errors.push("removing the logo did not drop exactly one artwork slot")
  }
  out.logoInkAfter = inkIn(await shot(docId), logo.bbox, pageHeight)
  // The mark's own pixels must be gone; the photo behind it stays, so this
  // is a large drop rather than a drop to zero.
  if (out.logoInkAfter >= out.logoInkBefore * 0.5) {
    out.errors.push(
      `the logo still appears to be drawn: ink ${out.logoInkBefore} -> ${out.logoInkAfter}`,
    )
  }

  // ---------- 4. replace a logo with an image, on a fresh copy ----------
  const fresh = await engine.open(copy())
  const freshGroups = (await engine.listVectorGroups(fresh.docId, 0)).groups
  const target = freshGroups.find((g) => g.pathCount > 5)
  const imagesBefore = (await engine.listImages(fresh.docId, 0)).images.length
  // 1x1 red PNG.
  const png = Uint8Array.from(atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ), (c) => c.charCodeAt(0))
  await engine.replaceVectorGroupWithImage(fresh.docId, 0, target.vectorIndex, png.buffer, "png")

  const imagesAfter = (await engine.listImages(fresh.docId, 0)).images
  out.imagesBefore = imagesBefore
  out.imagesAfter = imagesAfter.length
  if (imagesAfter.length !== imagesBefore + 1) {
    out.errors.push("replacing the artwork did not add an image")
  }
  out.artworkAfterReplace = (await engine.listVectorGroups(fresh.docId, 0)).groups.length
  if (out.artworkAfterReplace !== freshGroups.length - 1) {
    out.errors.push("the artwork was not removed when it was replaced")
  }
  // It must land where the logo was, not in a corner.
  const placed = imagesAfter.find((i) => i.bbox
    && Math.abs(i.bbox.left - target.bbox.left) < 2
    && Math.abs(i.bbox.bottom - target.bbox.bottom) < 2)
  out.placedInLogoBox = !!placed
  if (!placed) out.errors.push("the replacement image did not land in the logo's box")

  // ---------- 5. it all survives a save/reopen ----------
  const { bytes } = await engine.save(fresh.docId)
  const re = await engine.open(bytes.slice(0))
  out.imagesAfterReopen = (await engine.listImages(re.docId, 0)).images.length
  out.artworkAfterReopen = (await engine.listVectorGroups(re.docId, 0)).groups.length
  if (out.imagesAfterReopen !== imagesAfter.length) {
    out.errors.push("the replacement image did not survive the save")
  }
  if (out.artworkAfterReopen !== out.artworkAfterReplace) {
    out.errors.push("the artwork removal did not survive the save")
  }

  await engine.close(re.docId)
  await engine.close(fresh.docId)
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
  "the logo is offered as one clickable item": result.foundLogo === true,
  "it is the whole mark, not one slot per letter": result.logoPaths >= 10,
  "the page is not littered with artwork slots": result.groupsOnPage0 <= 3,
  "deleting it removes exactly that item": result.groupsAfterRemove === result.groupsOnPage0 - 1,
  "the logo actually stops being drawn": result.logoInkAfter < result.logoInkBefore * 0.5,
  "replacing it adds an image": result.imagesAfter === result.imagesBefore + 1,
  "the replacement lands in the logo's box": result.placedInLogoBox === true,
  "the swap survives save and reopen": result.imagesAfterReopen === result.imagesAfter
    && result.artworkAfterReopen === result.artworkAfterReplace,
}

console.log("\n=========== VECTOR ARTWORK CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
