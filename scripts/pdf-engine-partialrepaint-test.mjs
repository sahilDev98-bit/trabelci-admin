/**
 * Partial repaint: after an edit, repaint only the rectangle that changed.
 *
 * A full page repaint at editing zoom costs 145-417ms while the edit itself
 * costs about 7ms, so nearly all the lag after moving or resizing something
 * was the page being redrawn in its entirety. Patching removes that — but
 * only if the patch is genuinely indistinguishable from the full repaint it
 * replaces. A patch that is merely CLOSE leaves a page that looks right and
 * saves wrong, or a hairline seam that a customer sees before we do.
 *
 * So the property tested is the strict one: for every kind of edit, a page
 * patched with the reported rectangle must match a fully repainted page to
 * within ONE level of 255 on any channel, and that rectangle must contain
 * every pixel that actually changed. Both controls are included — an
 * unpatched canvas, and a patch dropped a few pixels off — because a
 * comparison that still passes when the patch is wrong proves nothing.
 *
 * Why one level rather than zero: PDFium resamples images against the clip
 * of the bitmap it is drawing into, so a window of a page and the whole page
 * round a handful of interior pixels differently. Measured here it is at
 * most 1/255 on well under 0.1% of the patch — far below anything a screen
 * or an eye resolves, and it does NOT grow with the size of the change. The
 * failures it must catch are misplacement and staleness, which are hundreds
 * of times larger, and the misplaced-patch control proves the check still
 * sees them at this tolerance.
 *
 *   npx vite --port 5174                                (one terminal)
 *   node scripts/pdf-engine-partialrepaint-test.mjs [baseUrl] [pdfUrl]
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
  const { PdfEngineClient, drawRenderedPage, drawPagePatch } =
    await import("/src/lib/pdf-engine/index.ts")
  const out = { errors: [], cases: [], timings: {} }
  const engine = new PdfEngineClient()
  const srcBytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
  const { docId, pages } = await engine.open(srcBytes.slice().buffer)
  const pageHeightPts = pages[0].heightPts
  const SCALE = 2

  const canvasOf = (rendered) => {
    const c = document.createElement("canvas")
    drawRenderedPage(c, rendered)
    return c
  }
  const pixelsOf = (canvas) => canvas
    .getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height).data

  /** How two rasters differ: how many pixels, and by how much at worst. */
  const differing = (a, b) => {
    if (a.length !== b.length) return { count: Infinity, worst: 255 }
    let count = 0
    let worst = 0
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(
        Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
      if (d > 0) {
        count++
        if (d > worst) worst = d
      }
    }
    return { count, worst }
  }

  /** The most a patched pixel may differ from a fully repainted one. */
  const TOLERANCE = 1
  /** ...and at most this share of the page may differ even by that much. */
  const MAX_DIFFERING_SHARE = 0.001

  /** The box, in device pixels, holding every pixel that differs. */
  const diffBox = (a, b, width) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8
        || Math.abs(a[i + 2] - b[i + 2]) > 8) {
        const p = i / 4
        const x = p % width
        const y = (p / width) | 0
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY }
  }

  /**
   * One edit, checked end to end.
   *
   * `run` performs the edit and returns the engine's result; everything else
   * — before shot, patch, after shot, comparison — is identical for every
   * kind of edit, which is the point: the guarantee is about patching, not
   * about any particular operation.
   */
  const check = async (name, run) => {
    const record = { name, errors: [] }
    const before = await engine.renderPage(docId, 0, SCALE)
    const beforePixels = new Uint8ClampedArray(before.rgba)
    const canvas = canvasOf(before)

    const res = await run()
    record.newIndex = res?.newIndex
    if (!res?.changedRect) {
      record.errors.push("the edit reported no changed area, so nothing can be patched")
      out.cases.push(record)
      return record
    }
    record.rect = res.changedRect

    const region = await engine.renderPageRegion(docId, 0, res.changedRect, SCALE)
    record.regionSize = `${region.width}x${region.height}`
    record.pageSize = `${before.width}x${before.height}`
    record.coverage = Number(
      ((region.width * region.height) / (before.width * before.height)).toFixed(4))

    const after = await engine.renderPage(docId, 0, SCALE)
    const afterPixels = new Uint8ClampedArray(after.rgba)

    const pageArea = before.width * before.height

    // ---- control: without the patch the canvas is visibly out of date ----
    const stale = differing(pixelsOf(canvas), afterPixels)
    record.differenceWithoutPatch = stale.count
    if (stale.count === 0) {
      record.errors.push("the edit changed nothing on the page, so this case proves nothing")
    }

    // ---- the real check: patched must match a full repaint ----
    drawPagePatch(canvas, region)
    const patched = differing(pixelsOf(canvas), afterPixels)
    record.differenceAfterPatch = patched.count
    record.worstChannelError = patched.worst
    record.differingShare = Number((patched.count / pageArea).toFixed(6))
    if (patched.worst > TOLERANCE) {
      record.errors.push(
        `a patched pixel is off by ${patched.worst} of 255 — a patch must be`
        + " indistinguishable from a full repaint")
    }
    if (record.differingShare > MAX_DIFFERING_SHARE) {
      record.errors.push(
        `${(record.differingShare * 100).toFixed(3)}% of the page differs after patching`)
    }

    // ---- the reported area must contain everything that moved ----
    const box = diffBox(beforePixels, afterPixels, before.width)
    if (box) {
      const r = res.changedRect
      const reported = {
        minX: Math.round(r.left * SCALE),
        maxX: Math.round(r.right * SCALE),
        minY: Math.round((pageHeightPts - r.top) * SCALE),
        maxY: Math.round((pageHeightPts - r.bottom) * SCALE),
      }
      record.changedBox = box
      record.reportedBox = reported
      // One pixel of slack either side, for the rounding at the boundary.
      if (box.minX < reported.minX - 1 || box.maxX > reported.maxX + 1
        || box.minY < reported.minY - 1 || box.maxY > reported.maxY + 1) {
        record.errors.push(
          "pixels changed OUTSIDE the reported area — a patch would leave them stale")
      }
    }

    // ---- control: a patch a few pixels off must NOT pass as identical ----
    const shifted = canvasOf(before)
    drawPagePatch(shifted, { ...region, x: region.x + 6, y: region.y + 6 })
    const misplaced = differing(pixelsOf(shifted), afterPixels)
    record.differenceIfMisplaced = misplaced.count
    if (misplaced.worst <= TOLERANCE
      || misplaced.count / pageArea <= MAX_DIFFERING_SHARE) {
      record.errors.push(
        "a misplaced patch also passed — the check cannot detect a bad patch")
    }

    out.cases.push(record)
    return record
  }

  const lines = (await engine.listTextLines(docId, 0)).lines
  let target = lines.findIndex((l) => l.text.trim().length > 4)
  if (target < 0) {
    out.errors.push("no text line to test with")
    return out
  }
  out.line = lines[target].text

  let r = await check("style: bold", () =>
    engine.styleTextLine(docId, 0, target, {
      bold: true, italic: false, color: { r: 0, g: 0, b: 0 },
    }))
  if (r.newIndex != null) target = r.newIndex

  r = await check("scale: 1.25x", () => engine.scaleTextLine(docId, 0, target, 1.25))
  if (r.newIndex != null) target = r.newIndex

  r = await check("move: 12pt right, 9pt down", () =>
    engine.moveTextLine(docId, 0, target, 12, -9))
  if (r.newIndex != null) target = r.newIndex

  r = await check("align: centre", () => engine.alignTextLine(docId, 0, target, "center"))
  if (r.newIndex != null) target = r.newIndex

  const images = (await engine.listImages(docId, 0)).images
  const photo = images.findIndex((i) => i.bbox && (i.bbox.right - i.bbox.left) > 30)
  if (photo < 0) {
    out.errors.push("no image big enough to test moving")
  } else {
    const b = images[photo].bbox
    await check("image: moved and resized", () => engine.setImageRect(docId, 0, photo, {
      x: b.left + 10,
      y: b.bottom + 6,
      width: (b.right - b.left) * 0.9,
      height: (b.top - b.bottom) * 0.9,
    }))
  }

  // ---------------- what this actually saves, measured ----------------
  const time = async (fn) => {
    const t = performance.now()
    await fn()
    return Math.round(performance.now() - t)
  }
  const editScale = 3200 / pages[0].widthPts
  const smallRect = out.cases.find((c) => c.rect)?.rect
  out.timings.fullPageAtEditingScale = await time(() => engine.renderPage(docId, 0, editScale))
  if (smallRect) {
    out.timings.regionAtEditingScale =
      await time(() => engine.renderPageRegion(docId, 0, smallRect, editScale))
  }

  for (const c of out.cases) out.errors.push(...c.errors.map((e) => `${c.name}: ${e}`))
  engine.terminate()
  return out
}, PDF)

const line = (k, v) => console.log(`  ${k.padEnd(28)} ${v}`)
console.log(`\ntext line under test: "${result.line ?? "-"}"\n`)
for (const c of result.cases ?? []) {
  console.log(`- ${c.name}`)
  line("region / page", `${c.regionSize} of ${c.pageSize}`
    + `  (${((c.coverage ?? 0) * 100).toFixed(1)}% of the page)`)
  line("stale without the patch", `${c.differenceWithoutPatch} px`)
  line("after patching", `${c.differenceAfterPatch} px`
    + ` (${((c.differingShare ?? 0) * 100).toFixed(3)}%), worst ${c.worstChannelError}/255`)
  line("if patched 6px off", `${c.differenceIfMisplaced} px  (the check must reject this)`)
  if (c.errors.length === 0) console.log("  OK")
  else for (const e of c.errors) console.log(`  FAIL ${e}`)
  console.log()
}
console.log("timing at the editor's largest raster (3200px wide):")
line("full page repaint", `${result.timings?.fullPageAtEditingScale}ms`)
line("changed region only", `${result.timings?.regionAtEditingScale}ms`)

// ---- and the editor itself: does the PAGE take the fast path, and only
// when the canvas it holds is the picture the patch assumes? ----
const wiring = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/partialRepaintSelfTest.ts")
  return mod.runPartialRepaintSelfTest()
})
console.log("\nwhat the editor's page does with each kind of change:")
for (const [name, action] of Object.entries(wiring.actions ?? {})) line(name, action)
line("inside the patched area", `${wiring.patchedPixel} (the patch)`)
line("outside it", `${wiring.untouchedPixel} (the page, untouched)`)

// ---- and the thing that made dragging stutter: does the document object
// hold still between renders? ----
const stability = await page.evaluate(async () => {
  const mod = await import("/src/pages/create-pdf/engine-editor/docStabilitySelfTest.ts")
  return mod.runDocStabilitySelfTest()
})
console.log("")
line("renders exercised", stability.renders)
line("document identities seen", `${stability.distinctDocs} (must be 1)`)
line("control identities seen", `${stability.distinctControls} (proves the check works)`)

const errors = [
  ...(result.errors ?? []), ...(wiring.errors ?? []),
  ...(stability.errors ?? []), ...pageErrors,
]
console.log(errors.length === 0
  ? "\nPASS - patched pages match a full repaint, and only the safe cases patch\n"
  : `\nFAIL\n${errors.map((e) => ` - ${e}`).join("\n")}\n`)
await browser.close()
process.exit(errors.length === 0 ? 0 : 1)
