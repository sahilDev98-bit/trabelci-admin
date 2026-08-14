/**
 * Cross-page moves through the REAL engine client and worker, on a real
 * catalogue PDF.
 *
 * The UI suite proves a drag reports the right page and coordinates; this
 * proves the engine then does the right thing with them. Both halves are
 * needed — a perfect gesture that writes a broken PDF is still broken.
 *
 * Every assertion is made against the SAVED-AND-REOPENED bytes, never
 * against live handles. A moved object can look correct in memory and still
 * write a page whose resource dictionary lacks the font it refers to, which
 * renders as nothing at all; only a round trip catches that.
 *
 *   npx vite --port 5174                                  (one terminal)
 *   node scripts/pdf-engine-crosspage-test.mjs [baseUrl] [pdfUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"
const PDF = process.argv[3] ?? "/dev-fixtures/Carnaby.pdf"

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
  const src = await (await fetch(pdfUrl)).arrayBuffer()
  const { docId } = await engine.open(src)

  const pages = (await engine.listPages(docId)).pages
  out.pageCount = pages.length
  if (pages.length < 2) { out.errors.push("fixture needs 2+ pages"); return out }

  // ---------- TEXT: page 0 -> page 1 ----------
  const before0 = (await engine.listTextLines(docId, 0)).lines
  const before1 = (await engine.listTextLines(docId, 1)).lines
  out.text0Before = before0.length
  out.text1Before = before1.length

  // A line with real words — the interesting case is one in an embedded
  // subset font, which a rebuild-based move would silently restyle.
  const victimIndex = before0.findIndex((l) => l.text.trim().length > 3)
  if (victimIndex < 0) { out.errors.push("no text line to move"); return out }
  const victim = before0[victimIndex]
  out.movedText = victim.text
  out.movedFont = victim.fontName
  out.movedColor = victim.color

  const targetX = 90
  const targetBaseline = pages[1].heightPts - 200
  await engine.moveTextLineToPage(docId, 0, victimIndex, 1, targetX, targetBaseline)

  // ---------- IMAGE: move a real, CLIPPED catalogue photo ----------
  // Deliberately a clipped one. Every photo in this catalogue is framed by
  // a shape, and those were the images that could not be moved at all until
  // the frame started travelling with them — so a clipped photo is the case
  // that actually needs proving, not an easy unclipped overlay.
  let imageSource = -1
  let movableIndex = -1
  let imagesOnSource = 0
  for (let p = 0; p < pages.length && imageSource < 0; p++) {
    const imgs = (await engine.listImages(docId, p)).images
    const clipped = imgs.findIndex((i) => i.hasClipPath && i.bbox)
    if (clipped >= 0) {
      imageSource = p
      movableIndex = clipped
      imagesOnSource = imgs.length
    }
  }
  out.movableImageFound = movableIndex >= 0
  out.imageSourcePage = imageSource
  out.imagesOnSource = imagesOnSource

  const imageTarget = imageSource === 0 ? 1 : 0
  out.imageTargetPage = imageTarget
  if (movableIndex >= 0) {
    out.imagesOnTargetBefore = (await engine.listImages(docId, imageTarget)).images.length
    await engine.moveImageToPage(docId, imageSource, movableIndex, imageTarget, {
      x: 60, y: 60, width: 120, height: 120,
    })
  }

  // Moving to the SAME page must be rejected by the cross-page path — it is
  // a different operation (a translation) and conflating them would detach
  // and re-insert an object into the page it already belongs to.
  try {
    await engine.moveTextLineToPage(docId, 1, 0, 1, 50, 50)
    out.errors.push("a same-page 'move to page' was accepted")
  } catch {
    out.samePageRefused = true
  }

  // ---------- the check that counts: save, reopen, inspect ----------
  const { bytes } = await engine.save(docId)
  out.savedBytes = bytes.byteLength
  const re = await engine.open(bytes.slice(0))

  const after0 = (await engine.listTextLines(re.docId, 0)).lines
  const after1 = (await engine.listTextLines(re.docId, 1)).lines
  out.text0After = after0.length
  out.text1After = after1.length

  const landed = after1.find((l) => l.text === victim.text)
  out.landedOnPage1 = Boolean(landed)
  out.goneFromPage0 = !after0.some((l) => l.text === victim.text)
  if (!landed) {
    out.errors.push("the moved line is not on the target page after reopen")
  } else {
    out.landedFont = landed.fontName
    out.landedColor = landed.color
    out.landedBbox = landed.bbox
    // The point of detach-and-re-attach: the original face survives.
    if (landed.fontName !== victim.fontName) {
      out.errors.push(`font changed on the move: ${victim.fontName} -> ${landed.fontName}`)
    }
    if (JSON.stringify(landed.color) !== JSON.stringify(victim.color)) {
      out.errors.push("the moved line changed colour")
    }
    // It must land where it was put, not merely somewhere on the page.
    if (Math.abs(landed.bbox.left - targetX) > 6) {
      out.errors.push(`landed at x=${landed.bbox.left}, asked for ${targetX}`)
    }
  }
  if (!out.goneFromPage0) out.errors.push("the moved line is still on the source page (duplicated)")

  if (movableIndex >= 0) {
    const srcAfter = (await engine.listImages(re.docId, imageSource)).images
    const tgtAfter = (await engine.listImages(re.docId, imageTarget)).images
    out.imagesOnSourceAfter = srcAfter.length
    out.imagesOnTargetAfter = tgtAfter.length
    if (srcAfter.length !== imagesOnSource - 1) out.errors.push("the image did not leave its page")
    if (tgtAfter.length !== out.imagesOnTargetBefore + 1) out.errors.push("the image did not arrive on the target page")
    // Present is not enough — it must still carry pixels.
    if (tgtAfter.some((i) => i.pixelWidth === 0 || i.pixelHeight === 0)) {
      out.errors.push("an image on the target page arrived with no pixel data")
    }
  }

  // A page that renders blank would satisfy every structural check above.
  const ink = async (pageIndex) => {
    const r = await engine.renderPage(re.docId, pageIndex, 0.4)
    const px = new Uint8Array(r.rgba)
    let n = 0
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) n++
    }
    return Number((n / (px.length / 4)).toFixed(4))
  }
  out.inkPage0 = await ink(0)
  out.inkPage1 = await ink(1)
  out.inkImageTarget = await ink(imageTarget)
  if (out.inkPage1 === 0) out.errors.push("the target page renders completely blank")

  await engine.close(re.docId)
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
  "text left the source page": result.goneFromPage0 === true,
  "text arrived on the target page": result.landedOnPage1 === true,
  "the embedded font survived the move": result.landedFont === result.movedFont,
  "the colour survived the move": JSON.stringify(result.landedColor) === JSON.stringify(result.movedColor),
  "it landed where it was dropped": !!result.landedBbox && Math.abs(result.landedBbox.left - 90) <= 6,
  "line counts moved by exactly one": result.text0After === result.text0Before - 1
    && result.text1After === result.text1Before + 1,
  "a clipped photo was found to test with": result.movableImageFound === true,
  "the image left its page": result.imagesOnSourceAfter === result.imagesOnSource - 1,
  "the image arrived with its pixels": result.imagesOnTargetAfter === result.imagesOnTargetBefore + 1,
  "same-page 'move to page' is refused": result.samePageRefused === true,
  "both pages still render content": result.inkPage0 > 0 && result.inkPage1 > 0,
}

console.log("\n=========== CROSS-PAGE ENGINE CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
