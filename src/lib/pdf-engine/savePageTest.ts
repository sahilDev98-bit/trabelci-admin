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

/**
 * The whole template loop: save a page out, and put it back in.
 *
 * This is what Step 3 rests on, and it is the round trip that matters rather
 * than either half alone. A template is only useful if the page that comes
 * back is the page that went out — same content, same size, and above all the
 * same COORDINATES, because the slots stored alongside it are boxes in that
 * page's space. Drift anywhere in the loop and every slot points beside its
 * box instead of at it.
 *
 * Checked with the page inserted into a DIFFERENT document from the one it
 * came from, because that is what applying a template actually does.
 */
export interface TemplateRoundTripResult {
  ok: boolean
  errors: string[]
  pagesBefore: number
  pagesAfter: number
  /** Where the template landed, and what was already there. */
  insertedAt: number
  originalText: string[]
  insertedText: string[]
  /** The page that was already at that position must still be intact. */
  neighbourIntact: boolean
  sizeMatches: boolean
  worstBoxDrift: number
  /** A slot's box, carried through the loop and checked against the page it
   * now names. */
  slotStillOnItsBox: boolean
}

export async function runTemplateRoundTripTest(
  pdfUrl = SAMPLE_PDF_URL,
): Promise<TemplateRoundTripResult> {
  const out: TemplateRoundTripResult = {
    ok: false, errors: [], pagesBefore: 0, pagesAfter: 0, insertedAt: -1,
    originalText: [], insertedText: [], neighbourIntact: false,
    sizeMatches: false, worstBoxDrift: 0, slotStillOnItsBox: false,
  }
  const engine = new PdfEngineClient()
  let sourceId: string | null = null
  let targetId: string | null = null

  try {
    const res = await fetch(pdfUrl)
    const bytes = await res.arrayBuffer()

    // Two independent documents from the same file: one plays the catalogue
    // the template came from, the other the catalogue it is applied to.
    const source = await engine.open(bytes.slice(0))
    sourceId = source.docId
    const target = await engine.open(bytes.slice(0))
    targetId = target.docId
    out.pagesBefore = target.pages.length

    let pageIndex = -1
    for (let i = 0; i < source.pages.length; i++) {
      const text = await engine.listTextLines(sourceId, i)
      if (text.lines.length >= 2) { pageIndex = i; break }
    }
    if (pageIndex < 0) throw new Error("no page with enough text to test with")

    const originalLines = (await engine.listTextLines(sourceId, pageIndex)).lines
    out.originalText = originalLines.map((l) => l.text)
    const sourcePage = source.pages[pageIndex]

    // A slot, as the editor would have stored it with the template.
    const slotBox = { ...originalLines[0].bbox }

    // ── Out, then back in ────────────────────────────────────────────
    const saved = await engine.savePage(sourceId, pageIndex)

    // Applied AFTER page 0 of the other document, so there is a real
    // neighbour on each side to be disturbed if insertion is careless.
    const inserted = await engine.insertPageFrom(targetId, saved.bytes, 1)
    out.insertedAt = inserted.pageIndex
    out.pagesAfter = inserted.pages.length

    if (out.pagesAfter !== out.pagesBefore + 1) {
      out.errors.push(
        `the document had ${out.pagesBefore} pages and now has ${out.pagesAfter};`
        + " applying a template should add exactly one")
    }
    if (out.insertedAt !== 1) {
      out.errors.push(`the template landed at page ${out.insertedAt}, expected 1`)
    }

    // ── What arrived ─────────────────────────────────────────────────
    const insertedLines = (await engine.listTextLines(targetId, out.insertedAt)).lines
    out.insertedText = insertedLines.map((l) => l.text)
    if (JSON.stringify(out.insertedText) !== JSON.stringify(out.originalText)) {
      out.errors.push(
        `the applied page reads ${JSON.stringify(out.insertedText)},`
        + ` the template was ${JSON.stringify(out.originalText)}`)
    }

    const newPage = inserted.pages[out.insertedAt]
    out.sizeMatches = !!newPage
      && Math.abs(newPage.widthPts - sourcePage.widthPts) < 0.01
      && Math.abs(newPage.heightPts - sourcePage.heightPts) < 0.01
    if (!out.sizeMatches) {
      out.errors.push(
        `the applied page is ${newPage?.widthPts}x${newPage?.heightPts}pt,`
        + ` the template was ${sourcePage.widthPts}x${sourcePage.heightPts}pt`)
    }

    // ── THE check: do the stored slots still land on their boxes? ────
    let worst = 0
    for (const line of originalLines) {
      const twin = insertedLines.find((l) => l.text === line.text)
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

    // Looked up the way the editor does it: find the box on the applied page
    // that matches the stored slot. If nothing matches, the slot is orphaned
    // and the template would insert but never fill.
    const match = insertedLines.find((l) =>
      Math.abs(l.bbox.left - slotBox.left) < 0.5
      && Math.abs(l.bbox.bottom - slotBox.bottom) < 0.5
      && Math.abs(l.bbox.right - slotBox.right) < 0.5
      && Math.abs(l.bbox.top - slotBox.top) < 0.5)
    out.slotStillOnItsBox = match !== undefined
    if (!out.slotStillOnItsBox) {
      out.errors.push(
        "a slot stored with the template does not match any box on the applied"
        + " page — the template would insert but nothing could ever fill it")
    }

    // ── The neighbours must be untouched ─────────────────────────────
    // Inserting into the middle of a document must not disturb what was
    // already there. Page 0 is the one the template was placed after.
    const neighbour = (await engine.listTextLines(targetId, 0)).lines.map((l) => l.text)
    const originalNeighbour = (await engine.listTextLines(sourceId, 0)).lines.map((l) => l.text)
    out.neighbourIntact = JSON.stringify(neighbour) === JSON.stringify(originalNeighbour)
    if (!out.neighbourIntact) {
      out.errors.push("the page before the inserted one was changed by the insertion")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    for (const id of [sourceId, targetId]) {
      if (id) { try { await engine.close(id) } catch { /* best effort */ } }
    }
    engine.terminate?.()
  }

  out.ok = out.errors.length === 0
  return out
}
