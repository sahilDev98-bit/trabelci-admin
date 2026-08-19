/**
 * Formatting: does each control actually change the document?
 *
 * "The call returned ok" proves nothing here — every one of these operations
 * can succeed and change nothing visible. So each is checked by RENDERING
 * the page and measuring, and by reading the properties back after a
 * save/reopen:
 *
 *   bold    -> more ink in the line's box (thicker stems)
 *   italic  -> the glyphs lean; the box widens as they do
 *   colour  -> the pixels are the colour asked for
 *   size    -> the box grows, and the line stays where it started
 *   align   -> the box moves to the side asked for
 *   image   -> turning it swaps width and height; flipping keeps them
 *
 * The typeface must also SURVIVE all of it: styling deliberately mutates the
 * text in place rather than redrawing it, because redrawing would swap the
 * catalogue's font for a bundled one.
 *
 *   npx vite --port 5174                             (one terminal)
 *   node scripts/pdf-engine-textstyle-test.mjs [baseUrl] [pdfUrl]
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
  const pageHeight = pages[0].heightPts

  const SCALE = 4
  const shot = async () => {
    const r = await engine.renderPage(docId, 0, SCALE)
    return { w: r.width, h: r.height, px: new Uint8Array(r.rgba) }
  }
  /** Pixels in a box that are NOT the background — the line's own ink. */
  const inkIn = (img, box) => {
    const x0 = Math.round(box.left * SCALE), x1 = Math.round(box.right * SCALE)
    const y0 = Math.round((pageHeight - box.top) * SCALE)
    const y1 = Math.round((pageHeight - box.bottom) * SCALE)
    let ink = 0, total = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
        const i = (y * img.w + x) * 4
        total++
        // This heading is white on a grey photo.
        if (img.px[i] > 225 && img.px[i + 1] > 225 && img.px[i + 2] > 225) ink++
      }
    }
    return total ? ink / total : 0
  }

  const lineAt = async (i) => (await engine.listTextLines(docId, 0)).lines[i]
  const lines = (await engine.listTextLines(docId, 0)).lines
  let idx = lines.findIndex((l) => l.text.trim().length > 3)
  if (idx < 0) { out.errors.push("no text line to style"); return out }
  const original = lines[idx]
  out.line = original.text
  out.originalFont = original.fontName
  out.startsPlain = original.bold === false && original.italic === false

  const box = original.bbox
  out.inkPlain = Number(inkIn(await shot(), box).toFixed(4))

  // ---------- BOLD ----------
  let r = await engine.styleTextLine(docId, 0, idx, {
    bold: true, italic: false, color: { r: 255, g: 255, b: 255 },
  })
  idx = r.newIndex
  out.reportsBold = (await lineAt(idx)).bold === true
  out.inkBold = Number(inkIn(await shot(), box).toFixed(4))
  // Thicker stems mean more of the box is covered.
  if (!(out.inkBold > out.inkPlain * 1.03)) {
    out.errors.push(`bold did not thicken the text: ${out.inkPlain} -> ${out.inkBold}`)
  }
  if (!out.reportsBold) out.errors.push("bold was applied but is not reported back")

  // ---------- ITALIC ----------
  r = await engine.styleTextLine(docId, 0, idx, {
    bold: false, italic: true, color: { r: 255, g: 255, b: 255 },
  })
  idx = r.newIndex
  const italicLine = await lineAt(idx)
  out.reportsItalic = italicLine.italic === true
  // Slanting makes the line lean, so its box gets wider.
  out.widthPlain = Number((box.right - box.left).toFixed(1))
  out.widthItalic = Number((italicLine.bbox.right - italicLine.bbox.left).toFixed(1))
  if (!(out.widthItalic > out.widthPlain)) {
    out.errors.push(`italic did not slant the text: width ${out.widthPlain} -> ${out.widthItalic}`)
  }
  if (!out.reportsItalic) out.errors.push("italic was applied but is not reported back")

  // Toggling italic off must return it to where it started, not drift.
  r = await engine.styleTextLine(docId, 0, idx, {
    bold: false, italic: false, color: { r: 255, g: 255, b: 255 },
  })
  idx = r.newIndex
  const unItalic = await lineAt(idx)
  out.widthAfterUnItalic = Number((unItalic.bbox.right - unItalic.bbox.left).toFixed(1))
  out.italicIsReversible = Math.abs(out.widthAfterUnItalic - out.widthPlain) < 0.5
  if (!out.italicIsReversible) {
    out.errors.push(
      `un-italic did not restore the original: ${out.widthPlain} -> ${out.widthAfterUnItalic}`,
    )
  }

  // ---------- COLOUR ----------
  r = await engine.styleTextLine(docId, 0, idx, {
    bold: false, italic: false, color: { r: 220, g: 30, b: 30 },
  })
  idx = r.newIndex
  const coloured = await lineAt(idx)
  out.reportedColor = coloured.color
  const img = await shot()
  let redPixels = 0, counted = 0
  {
    const b = coloured.bbox
    for (let y = Math.round((pageHeight - b.top) * SCALE); y < Math.round((pageHeight - b.bottom) * SCALE); y++) {
      for (let x = Math.round(b.left * SCALE); x < Math.round(b.right * SCALE); x++) {
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue
        const i = (y * img.w + x) * 4
        counted++
        if (img.px[i] > 150 && img.px[i + 1] < 110 && img.px[i + 2] < 110) redPixels++
      }
    }
  }
  out.redShare = counted ? Number((redPixels / counted).toFixed(4)) : 0
  if (out.redShare < 0.05) {
    out.errors.push(`the text did not turn red on the page (${out.redShare} of its box)`)
  }
  if (out.reportedColor.r !== 220) out.errors.push("the colour is not reported back")

  // ---------- SIZE ----------
  const beforeScale = await lineAt(idx)
  r = await engine.scaleTextLine(docId, 0, idx, 1.5)
  idx = r.newIndex
  const scaled = await lineAt(idx)
  out.widthBeforeScale = Number((beforeScale.bbox.right - beforeScale.bbox.left).toFixed(1))
  out.widthAfterScale = Number((scaled.bbox.right - scaled.bbox.left).toFixed(1))
  out.scaleRatio = Number((out.widthAfterScale / out.widthBeforeScale).toFixed(2))
  if (Math.abs(out.scaleRatio - 1.5) > 0.05) {
    out.errors.push(`scaling by 1.5 gave ${out.scaleRatio}x`)
  }
  // It must grow from where it was, not wander off.
  if (Math.abs(scaled.bbox.left - beforeScale.bbox.left) > 2) {
    out.errors.push("scaling moved the line away from its own start")
  }

  // ---------- ALIGN ----------
  r = await engine.alignTextLine(docId, 0, idx, "right")
  idx = r.newIndex
  const right = await lineAt(idx)
  out.rightGap = Number((pages[0].widthPts - right.bbox.right).toFixed(1))
  if (Math.abs(out.rightGap - 24) > 1.5) {
    out.errors.push(`align right left a gap of ${out.rightGap}pt, expected the 24pt margin`)
  }
  r = await engine.alignTextLine(docId, 0, idx, "left")
  idx = r.newIndex
  out.leftEdge = Number((await lineAt(idx)).bbox.left.toFixed(1))
  if (Math.abs(out.leftEdge - 24) > 1.5) {
    out.errors.push(`align left put the line at ${out.leftEdge}pt, expected the 24pt margin`)
  }

  // ---------- the typeface must have survived all of it ----------
  out.fontAfterStyling = (await lineAt(idx)).fontName
  if (out.fontAfterStyling !== out.originalFont) {
    out.errors.push(
      `styling changed the typeface: ${out.originalFont} -> ${out.fontAfterStyling}`,
    )
  }

  // ---------- IMAGE: rotate and flip ----------
  const images = (await engine.listImages(docId, 0)).images
  if (images.length > 0 && images[0].bbox) {
    const b0 = images[0].bbox
    out.imageBefore = {
      w: Number((b0.right - b0.left).toFixed(1)),
      h: Number((b0.top - b0.bottom).toFixed(1)),
    }
    const rot = await engine.transformImage(docId, 0, 0, "rotate-right")
    const b1 = (await engine.listImages(docId, 0)).images[rot.newIndex].bbox
    out.imageAfterRotate = {
      w: Number((b1.right - b1.left).toFixed(1)),
      h: Number((b1.top - b1.bottom).toFixed(1)),
    }
    // A quarter turn swaps the sides.
    out.rotateSwappedSides =
      Math.abs(out.imageAfterRotate.w - out.imageBefore.h) < 1
      && Math.abs(out.imageAfterRotate.h - out.imageBefore.w) < 1
    if (!out.rotateSwappedSides) out.errors.push("rotating the image did not swap its sides")
    // And it turns about its own centre, so the centre stays put.
    out.centreHeld =
      Math.abs((b1.left + b1.right) / 2 - (b0.left + b0.right) / 2) < 1
      && Math.abs((b1.bottom + b1.top) / 2 - (b0.bottom + b0.top) / 2) < 1
    if (!out.centreHeld) out.errors.push("rotating the image moved it off its own centre")

    const flip = await engine.transformImage(docId, 0, rot.newIndex, "flip-horizontal")
    const b2 = (await engine.listImages(docId, 0)).images[flip.newIndex].bbox
    out.flipKeptSize =
      Math.abs((b2.right - b2.left) - out.imageAfterRotate.w) < 1
      && Math.abs((b2.top - b2.bottom) - out.imageAfterRotate.h) < 1
    if (!out.flipKeptSize) out.errors.push("flipping the image changed its size")
  }

  // ---------- and all of it survives a save/reopen ----------
  const { bytes } = await engine.save(docId)
  const re = await engine.open(bytes.slice(0))
  const reopened = (await engine.listTextLines(re.docId, 0)).lines
  const same = reopened.find((l) => l.text.trim() === out.line.trim())
  out.survivedSave = !!same
  out.colorAfterSave = same?.color ?? null
  if (!same) {
    out.errors.push("the styled line is missing after save and reopen")
  } else if (same.color.r !== 220) {
    out.errors.push("the colour did not survive the save")
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
  "the line starts unstyled": result.startsPlain === true,
  "bold really thickens the text": result.inkBold > result.inkPlain * 1.03,
  "bold is reported back": result.reportsBold === true,
  "italic really slants the text": result.widthItalic > result.widthPlain,
  "italic is reported back": result.reportsItalic === true,
  "toggling italic off restores it exactly": result.italicIsReversible === true,
  "colour really changes the pixels": result.redShare >= 0.05,
  "size scales by the amount asked": Math.abs(result.scaleRatio - 1.5) <= 0.05,
  "align right lands on the margin": Math.abs(result.rightGap - 24) <= 1.5,
  "align left lands on the margin": Math.abs(result.leftEdge - 24) <= 1.5,
  "the document's own typeface survives": result.fontAfterStyling === result.originalFont,
  "rotating an image swaps its sides": result.rotateSwappedSides === true,
  "and turns about its own centre": result.centreHeld === true,
  "flipping keeps its size": result.flipKeptSize === true,
  "it all survives save and reopen": result.survivedSave === true,
}

console.log("\n=========== TEXT & IMAGE FORMATTING CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
