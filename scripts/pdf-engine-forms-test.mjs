/**
 * Text hidden inside Form XObjects.
 *
 * Reported as "some text is not editable": on a customer catalogue, headings
 * that looked identical to their neighbours had no edit box at all. They
 * were inside Form XObjects — reusable bundles of drawing instructions that
 * designers get from grouped or placed artwork. Such text is drawn on the
 * page exactly like any other, but it is not a child of the page, and this
 * editor walks the page's own object list. So it was invisible to it.
 *
 * Reaching into the form is not enough, and that was established by
 * measurement, not assumed:
 *   - FPDFFormObj_RemoveObject returns false in this build, so a child
 *     cannot be taken out of its form;
 *   - a matrix set on a child DOES change what the object reports and is
 *     then LOST on save, because PDFium rebuilds a page's instructions from
 *     its object list but never a form's.
 * An editor that edited in place would have appeared to work and saved a
 * file with none of the changes in it.
 *
 * What works is promotion at open: the form's children replace it in the
 * page's list. But it is not always free — a form can carry a clipping path
 * or a transparency group, and on one real customer file a page came out 44%
 * different. So it is only kept when it provably changes nothing, and the
 * document is otherwise reopened untouched.
 *
 * Both halves are checked here, and the second matters more than the first:
 * a document is worth more than the convenience of editing one heading in it.
 *
 *   npx vite --port 5174                          (one terminal)
 *   node scripts/pdf-engine-forms-test.mjs [baseUrl] [pdfUrl]
 */
import { chromium } from "playwright"

const BASE = process.argv[2] ?? "http://localhost:5174"
const PDF = process.argv[3] ?? "/dev-fixtures/Carnaby.pdf"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const pageErrors = []
page.on("pageerror", (e) => pageErrors.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`) })

await page.goto(`${BASE}/pdf-engine-smoketest.html`, { waitUntil: "domcontentloaded" })

const result = await page.evaluate(async (pdfUrl) => {
  const { PdfEngineClient } = await import("/src/lib/pdf-engine/index.ts")
  const out = { errors: [] }
  const engine = new PdfEngineClient()
  const bytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
  const { docId, pages } = await engine.open(bytes.slice().buffer)

  // ── the text that used to be unreachable is now offered ──
  const NEEDLE = "Tech info"
  let found = null
  for (let i = 0; i < pages.length; i++) {
    const { lines } = await engine.listTextLines(docId, i)
    const at = lines.findIndex((l) => l.text.includes(NEEDLE))
    if (at >= 0) { found = { page: i, index: at, line: lines[at], count: lines.length }; break }
  }
  out.foundInAForm = found !== null
  if (!found) {
    out.errors.push(`"${NEEDLE}" is still not offered as an editable line`)
    engine.terminate()
    return out
  }
  out.text = found.line.text.slice(0, 40)
  out.bboxBefore = found.line.bbox

  // ── and editing it actually survives being saved ──
  const moved = await engine.moveTextLine(docId, found.page, found.index, 0, 40)
  out.moveReported = moved.ok
  const { bytes: savedBuf } = await engine.save(docId)
  const saved = new Uint8Array(savedBuf)
  const again = await engine.open(saved.slice().buffer)
  const { lines: after } = await engine.listTextLines(again.docId, found.page)
  const same = after.filter((l) => l.text.includes(NEEDLE))
  out.copiesAfterSave = same.length
  out.bboxAfterSave = same[0]?.bbox ?? null
  out.linesAfterSave = after.length
  out.linesBefore = found.count

  if (!out.moveReported) out.errors.push("the move was refused")
  if (out.copiesAfterSave !== 1) {
    out.errors.push(
      `after saving there are ${out.copiesAfterSave} copies of the line —`
      + " promoting it out of its form duplicated the text")
  }
  if (out.bboxAfterSave && Math.abs(out.bboxAfterSave.bottom - (out.bboxBefore.bottom + 40)) > 1) {
    out.errors.push(
      "the edit did not survive being saved — this is the failure where the"
      + " editor appears to work and the downloaded file has none of it")
  }
  if (out.linesAfterSave !== out.linesBefore) {
    out.errors.push(
      `the page had ${out.linesBefore} editable lines and now has ${out.linesAfterSave}`)
  }
  engine.terminate()
  return out
}, PDF)

// ── opening any document must leave it looking exactly as it did ──
const safety = await page.evaluate(async () => {
  const { PdfEngineClient } = await import("/src/lib/pdf-engine/index.ts")
  const files = [
    "/dev-fixtures/Carnaby.pdf",
    "/dev-fixtures/REFIN.pdf",
  ]
  const rows = []
  for (const url of files) {
    const engine = new PdfEngineClient()
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const a = await engine.open(bytes.slice().buffer)
    const b = await engine.open(bytes.slice().buffer)
    let worst = 0
    for (let i = 0; i < a.pages.length; i++) {
      const ra = await engine.renderPage(a.docId, i, 1.2)
      const rb = await engine.renderPage(b.docId, i, 1.2)
      const x = new Uint8ClampedArray(ra.rgba)
      const y = new Uint8ClampedArray(rb.rgba)
      let d = 0
      for (let k = 0; k < x.length; k += 4) {
        if (Math.abs(x[k] - y[k]) > 8 || Math.abs(x[k + 1] - y[k + 1]) > 8
          || Math.abs(x[k + 2] - y[k + 2]) > 8) d++
      }
      worst = Math.max(worst, d / (x.length / 4))
    }
    rows.push({ url, worst })
    engine.terminate()
  }
  return rows
})

await browser.close()

const checks = {
  "no page errors": pageErrors.length === 0,
  "no internal errors": result.errors.length === 0,
  "text inside a form is now offered as editable": result.foundInAForm === true,
  "moving it is accepted": result.moveReported === true,
  "it exists exactly once after saving": result.copiesAfterSave === 1,
  "the edit survives being saved and reopened":
    result.bboxAfterSave != null
    && Math.abs(result.bboxAfterSave.bottom - (result.bboxBefore.bottom + 40)) <= 1,
  "no line is gained or lost by saving": result.linesAfterSave === result.linesBefore,
  "opening a document changes nothing on screen":
    safety.every((r) => r.worst === 0),
}

console.log("\n=========== FORM-XOBJECT TEXT CHECKS ===========")
let ok = true
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`)
  if (!pass) ok = false
}
if (!ok) {
  console.log("\n" + JSON.stringify({ result, safety }, null, 2))
  if (pageErrors.length) console.log("page errors:", pageErrors.slice(0, 5))
} else {
  console.log(
    `\n"${result.text}" — was unreachable, now edits and survives saving`
    + `  |  ${result.linesBefore} editable lines on that page`,
  )
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED")
process.exit(ok ? 0 : 1)
