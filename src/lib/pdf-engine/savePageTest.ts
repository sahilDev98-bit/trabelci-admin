/**
 * Does saving one page as a template actually preserve it?
 *
 * This is the operation the whole template feature rests on, and it can fail
 * in two ways that both look fine until much later:
 *
 *   1. The extracted page loses content. A template that drops its background
 *      or its logo is discovered when someone builds a catalogue from it.
 *   2. The COORDINATES shift. Slots are stored as boxes in the page's own PDF
 *      space; if extraction moved or rescaled anything, every stored slot
 *      points slightly off, and a product's SKU lands next to the box it was
 *      meant to fill rather than in it. This is the dangerous one — it looks
 *      almost right.
 *
 * And one that would be worse than either: extraction MUTATING the open
 * document. Saving a template must never disturb the catalogue being edited.
 */
import { PdfEngineClient } from "./client"

const SAMPLE_PDF_URL = "/dev-fixtures/Carnaby.pdf"

export interface SavePageTestResult {
  ok: boolean
  errors: string[]
  sourcePageCount: number
  savedPageCount: number
  sourceText: string[]
  savedText: string[]
  sourceSize: string
  savedSize: string
  /** Every text box's position, before and after. These must match exactly,
   * or stored slots point at the wrong place. */
  boxesMatch: boolean
  worstBoxDrift: number
  sourceImages: number
  savedImages: number
  /** The open document must be untouched by the extraction. */
  sourceUnchangedAfterSave: boolean
  savedBytes: number
}

export async function runSavePageTest(pdfUrl = SAMPLE_PDF_URL): Promise<SavePageTestResult> {
  const out: SavePageTestResult = {
    ok: false, errors: [], sourcePageCount: 0, savedPageCount: 0,
    sourceText: [], savedText: [], sourceSize: "", savedSize: "",
    boxesMatch: false, worstBoxDrift: 0, sourceImages: 0, savedImages: 0,
    sourceUnchangedAfterSave: false, savedBytes: 0,
  }
  const engine = new PdfEngineClient()
  let sourceId: string | null = null
  let savedId: string | null = null

  try {
    const res = await fetch(pdfUrl)
    if (!res.ok) throw new Error(`sample PDF not found at ${pdfUrl} (${res.status})`)
    const opened = await engine.open(await res.arrayBuffer())
    sourceId = opened.docId
    out.sourcePageCount = opened.pages.length

    // A page with real content — text AND pictures — so "it preserved the
    // page" is a claim about something rather than about a blank sheet.
    let pageIndex = -1
    for (let i = 0; i < opened.pages.length; i++) {
      const [text, images] = await Promise.all([
        engine.listTextLines(sourceId, i),
        engine.listImages(sourceId, i),
      ])
      if (text.lines.length >= 2 && images.images.length >= 1) { pageIndex = i; break }
    }
    if (pageIndex < 0) throw new Error("no page in the sample has both text and images")

    const page = opened.pages[pageIndex]
    out.sourceSize = `${Math.round(page.widthPts)}x${Math.round(page.heightPts)}`
    const sourceLines = (await engine.listTextLines(sourceId, pageIndex)).lines
    const sourceImages = (await engine.listImages(sourceId, pageIndex)).images
    out.sourceText = sourceLines.map((l) => l.text)
    out.sourceImages = sourceImages.length

    // ── Extract ──────────────────────────────────────────────────────
    const { bytes } = await engine.savePage(sourceId, pageIndex)
    out.savedBytes = bytes.byteLength
    if (bytes.byteLength === 0) throw new Error("the saved page is empty")

    // ── The open document must be untouched ──────────────────────────
    // Checked BEFORE opening the copy, so nothing about the copy can mask a
    // change to the original.
    const after = await engine.listPages(sourceId)
    const afterLines = (await engine.listTextLines(sourceId, pageIndex)).lines
    out.sourceUnchangedAfterSave =
      after.pages.length === out.sourcePageCount
      && afterLines.length === sourceLines.length
      && afterLines.every((l, i) => l.text === sourceLines[i].text)
    if (!out.sourceUnchangedAfterSave) {
      out.errors.push(
        "saving a page CHANGED the open document — the catalogue being edited"
        + " was disturbed by saving a template from it")
    }

    // ── What came out ────────────────────────────────────────────────
    const savedDoc = await engine.open(bytes)
    savedId = savedDoc.docId
    out.savedPageCount = savedDoc.pages.length
    if (out.savedPageCount !== 1) {
      out.errors.push(`the saved template has ${out.savedPageCount} pages, expected exactly 1`)
    }

    const savedPage = savedDoc.pages[0]
    out.savedSize = savedPage
      ? `${Math.round(savedPage.widthPts)}x${Math.round(savedPage.heightPts)}`
      : "none"
    if (out.savedSize !== out.sourceSize) {
      out.errors.push(
        `the page was ${out.sourceSize}pt and the template is ${out.savedSize}pt —`
        + " every stored slot would be at the wrong scale")
    }

    const savedLines = (await engine.listTextLines(savedId, 0)).lines
    const savedImages = (await engine.listImages(savedId, 0)).images
    out.savedText = savedLines.map((l) => l.text)
    out.savedImages = savedImages.length

    if (JSON.stringify(out.savedText) !== JSON.stringify(out.sourceText)) {
      out.errors.push(
        `the template's text is ${JSON.stringify(out.savedText)},`
        + ` the page had ${JSON.stringify(out.sourceText)}`)
    }
    if (out.savedImages !== out.sourceImages) {
      out.errors.push(
        `the page had ${out.sourceImages} pictures and the template has ${out.savedImages}`)
    }

    // ── THE one that matters: coordinates ────────────────────────────
    // Slots are stored as boxes in the page's own space. If extraction moved
    // anything at all, every stored slot points off-target — and a caption
    // landing a few points from its box looks almost right, which is exactly
    // why this is checked to a fraction of a point rather than by eye.
    let worst = 0
    for (const line of sourceLines) {
      const twin = savedLines.find((l) => l.text === line.text)
      if (!twin) continue
      worst = Math.max(
        worst,
        Math.abs(twin.bbox.left - line.bbox.left),
        Math.abs(twin.bbox.bottom - line.bbox.bottom),
        Math.abs(twin.bbox.right - line.bbox.right),
        Math.abs(twin.bbox.top - line.bbox.top),
      )
    }
    out.worstBoxDrift = Number(worst.toFixed(3))
    out.boxesMatch = worst < 0.01
    if (!out.boxesMatch) {
      out.errors.push(
        `a text box moved by ${out.worstBoxDrift}pt during extraction — stored`
        + " slots would no longer line up with the boxes they name")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    for (const id of [sourceId, savedId]) {
      if (id) { try { await engine.close(id) } catch { /* best effort */ } }
    }
    engine.terminate?.()
  }

  out.ok = out.errors.length === 0
  return out
}
