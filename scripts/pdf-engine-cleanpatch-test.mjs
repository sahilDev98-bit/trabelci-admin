/**
 * The "clean patch": a picture of a slot's area with the slot left out.
 *
 * It is what makes the place a dragged object came from look genuinely
 * empty instead of covered by a mark. To produce it the engine has to take
 * the object OUT of the live document, render, and put it back — so the
 * property that actually matters is not how the patch looks but that the
 * document is left exactly as it was.
 *
 * Two things are therefore checked against real pixels:
 *   - the page renders IDENTICALLY before and after (the restore is perfect,
 *     including z-order — re-inserting an object at the wrong depth would
 *     put a background image on top of everything and still "work");
 *   - the patch genuinely DIFFERS from that area of the page (the object was
 *     really removed, not just re-photographed).
 *
 *   npx vite --port 5174                              (one terminal)
 *   node scripts/pdf-engine-cleanpatch-test.mjs [baseUrl] [pdfUrl]
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
  const srcBytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
  const { docId, pages } = await engine.open(srcBytes.slice().buffer)

  const SCALE = 2
  const shot = async () => {
    const r = await engine.renderPage(docId, 0, SCALE)
    return { w: r.width, h: r.height, px: new Uint8Array(r.rgba) }
  }
  const differing = (a, b) => {
    if (a.px.length !== b.px.length) return 1
    let n = 0
    for (let i = 0; i < a.px.length; i += 4) {
      if (Math.abs(a.px[i] - b.px[i]) > 8
        || Math.abs(a.px[i + 1] - b.px[i + 1]) > 8
        || Math.abs(a.px[i + 2] - b.px[i + 2]) > 8) n++
    }
    return n / (a.px.length / 4)
  }

  const lines = (await engine.listTextLines(docId, 0)).lines
  const target = lines.findIndex((l) => l.text.trim().length > 3)
  if (target < 0) { out.errors.push("no text line to test with"); return out }
  out.line = lines[target].text

  // ---------- the page must be untouched by asking for a patch ----------
  const before = await shot()
  const patch = await engine.renderCleanPatch(docId, 0, "text", target, SCALE)
  out.patchSize = `${patch.width}x${patch.height}`
  if (!patch.width || !patch.height) {
    out.errors.push("no patch was produced")
    return out
  }
  const after = await shot()
  out.pageDifferenceAfterPatch = Number(differing(before, after).toFixed(6))
  if (out.pageDifferenceAfterPatch > 0) {
    out.errors.push(
      `the page changed after producing a patch (${out.pageDifferenceAfterPatch} of pixels differ) `
      + "— the object was not restored exactly",
    )
  }

  // ---------- and the patch must really be missing the object ----------
  // Compare the patch against the SAME area of the untouched page.
  const box = lines[target].bbox
  const pageHeight = pages[0].heightPts
  const x0 = Math.round(box.left * SCALE)
  const y0 = Math.round((pageHeight - box.top) * SCALE)
  const pw = patch.width
  const ph = patch.height
  const patchPx = new Uint8ClampedArray(patch.rgba)
  let differs = 0
  let counted = 0
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const sx = x0 + x
      const sy = y0 + y
      if (sx < 0 || sy < 0 || sx >= before.w || sy >= before.h) continue
      const a = (sy * before.w + sx) * 4
      const b = (y * pw + x) * 4
      counted++
      if (Math.abs(before.px[a] - patchPx[b]) > 24
        || Math.abs(before.px[a + 1] - patchPx[b + 1]) > 24
        || Math.abs(before.px[a + 2] - patchPx[b + 2]) > 24) differs++
    }
  }
  out.patchDiffersFromPage = counted ? Number((differs / counted).toFixed(4)) : 0
  if (out.patchDiffersFromPage < 0.02) {
    out.errors.push(
      `the patch looks the same as the page (${out.patchDiffersFromPage}) — the text was not removed from it`,
    )
  }

  // ---------- an IMAGE patch too ----------
  const images = (await engine.listImages(docId, 0)).images
  if (images.length > 0) {
    const beforeImg = await shot()
    const imgPatch = await engine.renderCleanPatch(docId, 0, "image", 0, 1)
    out.imagePatchSize = `${imgPatch.width}x${imgPatch.height}`
    const afterImg = await shot()
    out.pageDifferenceAfterImagePatch = Number(differing(beforeImg, afterImg).toFixed(6))
    if (out.pageDifferenceAfterImagePatch > 0) {
      out.errors.push("the page changed after producing an image patch")
    }
  }

  // ---------- the image preview must show ONLY the image ----------
  // The reported bug: a photo with a caption over it previewed the caption
  // moving too, because the preview was a crop of the composited page. Only
  // the photo actually moves, so only the photo may appear.
  if (images.length > 0 && images[0].bbox) {
    const box = images[0].bbox
    const preview = await engine.renderImagePreview(docId, 0, 0)
    out.imagePreviewSize = `${preview.width}x${preview.height}`
    if (!preview.width) {
      out.errors.push("no image preview was produced")
    } else {
      const pv = new Uint8ClampedArray(preview.rgba)
      // Where the text sits, expressed in the preview's own pixels.
      const line = lines[target].bbox
      const toPreview = (x, y) => ({
        px: Math.round(((x - box.left) / (box.right - box.left)) * preview.width),
        py: Math.round(((box.top - y) / (box.top - box.bottom)) * preview.height),
      })
      const a = toPreview(line.left, line.top)
      const b = toPreview(line.right, line.bottom)

      // The catalogue draws this heading in white over a grey photo, so the
      // giveaway is near-white pixels. Counted in the SAME area of both the
      // preview and the rendered page.
      const nearWhite = (r, g, bl) => r > 225 && g > 225 && bl > 225
      let inPreview = 0, inPage = 0, cells = 0
      for (let y = Math.max(0, a.py); y < Math.min(preview.height, b.py); y++) {
        for (let x = Math.max(0, a.px); x < Math.min(preview.width, b.px); x++) {
          cells++
          const i = (y * preview.width + x) * 4
          if (nearWhite(pv[i], pv[i + 1], pv[i + 2])) inPreview++
        }
      }
      const pageShot = await shot()
      const sx0 = Math.round(line.left * SCALE), sx1 = Math.round(line.right * SCALE)
      const sy0 = Math.round((pageHeight - line.top) * SCALE)
      const sy1 = Math.round((pageHeight - line.bottom) * SCALE)
      let pageCells = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          if (x < 0 || y < 0 || x >= pageShot.w || y >= pageShot.h) continue
          pageCells++
          const i = (y * pageShot.w + x) * 4
          if (nearWhite(pageShot.px[i], pageShot.px[i + 1], pageShot.px[i + 2])) inPage++
        }
      }
      out.textInkOnPage = pageCells ? Number((inPage / pageCells).toFixed(4)) : 0
      out.textInkInImagePreview = cells ? Number((inPreview / cells).toFixed(4)) : 0
      if (out.textInkOnPage < 0.05) {
        out.errors.push("the fixture's heading is not visible on the page, so this proves nothing")
      } else if (out.textInkInImagePreview > out.textInkOnPage * 0.5) {
        out.errors.push(
          `the image preview still contains the text drawn over it `
          + `(${out.textInkInImagePreview} vs ${out.textInkOnPage} on the page)`,
        )
      }
    }
  }

  // ---------- and none of it damaged the document structurally ----------
  const { bytes } = await engine.save(docId)
  const re = await engine.open(bytes.slice(0))
  out.linesAfterSave = (await engine.listTextLines(re.docId, 0)).lines.length
  out.imagesAfterSave = (await engine.listImages(re.docId, 0)).images.length
  if (out.linesAfterSave !== lines.length) {
    out.errors.push(`line count changed after save: ${lines.length} -> ${out.linesAfterSave}`)
  }
  if (out.imagesAfterSave !== images.length) {
    out.errors.push(`image count changed after save: ${images.length} -> ${out.imagesAfterSave}`)
  }

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
  "a patch was produced": !!result.patchSize,
  "the page is pixel-identical afterwards": result.pageDifferenceAfterPatch === 0,
  "the patch really is missing the text": result.patchDiffersFromPage >= 0.02,
  "an image patch also leaves the page identical": result.pageDifferenceAfterImagePatch === 0
    || result.pageDifferenceAfterImagePatch === undefined,
  "nothing was lost from the document": result.linesAfterSave > 0 && result.imagesAfterSave > 0,
  "an image preview was produced": !!result.imagePreviewSize,
  "the image preview excludes text drawn over it":
    result.textInkInImagePreview !== undefined
    && result.textInkInImagePreview <= result.textInkOnPage * 0.5,
}

console.log("\n=========== CLEAN PATCH CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
