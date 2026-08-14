/**
 * Moving and resizing CLIPPED photos, through the real engine client.
 *
 * Almost every photo in a designed catalogue is framed by a clip shape, and
 * those were exactly the images that could not be moved at all — so this is
 * the case that matters, not an easy unclipped one.
 *
 * Two things have to survive, and neither is visible from the geometry
 * alone:
 *   - the FRAME, which is a separate path and used to stay behind;
 *   - the ORIENTATION, since many of these photos are placed rotated or
 *     flipped (their matrices read a=0/d=0, or negative), and overwriting
 *     the matrix with a fresh axis-aligned one silently straightens them.
 *
 * Both are checked by rendering the page and comparing the picture at its
 * old place with the picture at its new one. A photo that lost its frame,
 * or got straightened, does not survive that comparison — where a bounding
 * box check would happily pass.
 *
 *   npx vite --port 5174                                  (one terminal)
 *   node scripts/pdf-engine-imagemove-test.mjs [baseUrl] [pdfUrl]
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
  const { docId, pages } = await engine.open(src)

  const SCALE = 2

  const renderPage = async (pageIndex) => {
    const r = await engine.renderPage(docId, pageIndex, SCALE)
    return { w: r.width, h: r.height, px: new Uint8Array(r.rgba) }
  }

  /** Crop a PDF-points box (y from the bottom) out of a rendered page. */
  const crop = (img, pageHeightPts, box) => {
    const x0 = Math.round(box.left * SCALE)
    const y0 = Math.round((pageHeightPts - box.top) * SCALE)
    const cw = Math.round((box.right - box.left) * SCALE)
    const ch = Math.round((box.top - box.bottom) * SCALE)
    const px = new Uint8Array(cw * ch * 4)
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = x0 + x, sy = y0 + y
        const di = (y * cw + x) * 4
        if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) {
          px[di] = px[di + 1] = px[di + 2] = 255
          continue
        }
        const si = (sy * img.w + sx) * 4
        px[di] = img.px[si]; px[di + 1] = img.px[si + 1]; px[di + 2] = img.px[si + 2]
      }
    }
    return { w: cw, h: ch, px }
  }

  const difference = (a, b) => {
    if (a.px.length !== b.px.length) return 1
    let diff = 0
    for (let i = 0; i < a.px.length; i += 4) {
      const d = Math.abs(a.px[i] - b.px[i])
        + Math.abs(a.px[i + 1] - b.px[i + 1])
        + Math.abs(a.px[i + 2] - b.px[i + 2])
      if (d > 24) diff++
    }
    return diff / (a.px.length / 4)
  }

  // Find a clipped photo that is comfortably inside its page, so a move
  // does not push it off the edge and confuse the comparison.
  let found = null
  for (let p = 0; p < pages.length && !found; p++) {
    const imgs = (await engine.listImages(docId, p)).images
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i]
      if (!im.hasClipPath || !im.bbox) continue
      const w = im.bbox.right - im.bbox.left
      const h = im.bbox.top - im.bbox.bottom
      if (w < 40 || h < 40) continue
      if (im.bbox.left < 20 || im.bbox.bottom < 20) continue
      if (im.bbox.right > pages[p].widthPts - 60 || im.bbox.top > pages[p].heightPts - 60) continue
      found = { pageIndex: p, imageIndex: i, bbox: im.bbox, page: pages[p] }
      break
    }
  }
  if (!found) { out.errors.push("no suitable clipped photo in the fixture"); return out }
  out.target = { page: found.pageIndex, index: found.imageIndex, bbox: found.bbox }

  const width = found.bbox.right - found.bbox.left
  const height = found.bbox.top - found.bbox.bottom

  // ---------- 1. MOVE, same size ----------
  const before = await renderPage(found.pageIndex)
  const beforeCrop = crop(before, found.page.heightPts, found.bbox)

  const DX = 18
  const DY = -14
  await engine.setImageRect(docId, found.pageIndex, found.imageIndex, {
    x: found.bbox.left + DX, y: found.bbox.bottom + DY, width, height,
  })

  const afterMove = await renderPage(found.pageIndex)
  const movedBox = {
    left: found.bbox.left + DX, right: found.bbox.right + DX,
    bottom: found.bbox.bottom + DY, top: found.bbox.top + DY,
  }
  out.moveDifference = Number(difference(beforeCrop, crop(afterMove, found.page.heightPts, movedBox)).toFixed(4))

  // The picture must be the SAME picture at the new place. A frame left
  // behind, or a straightened photo, changes it drastically.
  if (out.moveDifference > 0.12) {
    out.errors.push(`the photo did not survive the move intact (difference ${out.moveDifference})`)
  }

  // And the engine must agree about where it now is.
  const afterList = (await engine.listImages(docId, found.pageIndex)).images
  const moved = afterList[found.imageIndex]
  out.movedBbox = moved?.bbox ?? null
  if (!moved?.bbox) {
    out.errors.push("the moved image reports no bounds")
  } else {
    if (Math.abs(moved.bbox.left - movedBox.left) > 1) {
      out.errors.push(`moved to x=${moved.bbox.left}, asked for ${movedBox.left}`)
    }
    if (Math.abs(moved.bbox.bottom - movedBox.bottom) > 1) {
      out.errors.push(`moved to y=${moved.bbox.bottom}, asked for ${movedBox.bottom}`)
    }
  }
  // It must still be clipped: a frame that silently vanished would let the
  // picture render as a bare rectangle and still pass a geometry check.
  out.stillClipped = moved?.hasClipPath === true
  if (!out.stillClipped) out.errors.push("the photo lost its clip shape during the move")

  // ---------- 2. RESIZE ----------
  const grownBox = {
    left: movedBox.left, bottom: movedBox.bottom,
    right: movedBox.left + width * 1.3, top: movedBox.bottom + height * 1.3,
  }
  await engine.setImageRect(docId, found.pageIndex, found.imageIndex, {
    x: grownBox.left, y: grownBox.bottom, width: width * 1.3, height: height * 1.3,
  })
  const resized = (await engine.listImages(docId, found.pageIndex)).images[found.imageIndex]
  out.resizedBbox = resized?.bbox ?? null
  if (!resized?.bbox) {
    out.errors.push("the resized image reports no bounds")
  } else {
    const gotW = resized.bbox.right - resized.bbox.left
    if (Math.abs(gotW - width * 1.3) > 1) {
      out.errors.push(`resized width ${gotW}, expected ${width * 1.3}`)
    }
  }
  out.stillClippedAfterResize = resized?.hasClipPath === true
  if (!out.stillClippedAfterResize) out.errors.push("the photo lost its clip shape during the resize")

  // ---------- 3. it survives a save/reopen ----------
  const { bytes } = await engine.save(docId)
  const re = await engine.open(bytes.slice(0))
  const reopened = (await engine.listImages(re.docId, found.pageIndex)).images[found.imageIndex]
  out.reopenedBbox = reopened?.bbox ?? null
  out.reopenedClipped = reopened?.hasClipPath === true
  if (!reopened?.bbox) {
    out.errors.push("the image is gone after reopening the saved file")
  } else if (Math.abs((reopened.bbox.right - reopened.bbox.left) - width * 1.3) > 1.5) {
    out.errors.push("the resize did not survive the save")
  }
  if (!out.reopenedClipped) out.errors.push("the clip shape did not survive the save")

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
  "a clipped photo was found to test with": !!result.target,
  "the photo is the same picture after moving": result.moveDifference !== undefined && result.moveDifference <= 0.12,
  "it moved to exactly where it was put": !!result.movedBbox,
  "it kept its clip shape through the move": result.stillClipped === true,
  "it kept its clip shape through the resize": result.stillClippedAfterResize === true,
  "the resize took effect": !!result.resizedBbox,
  "everything survived save and reopen": !!result.reopenedBbox && result.reopenedClipped === true,
}

console.log("\n=========== CLIPPED IMAGE MOVE/RESIZE ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
