// Page-level operations: duplicate, reorder, delete, rotate.
//
// All four are expressed through ONE mechanism — a page plan — rather than
// four separate mutating calls. A plan is just "what the output document
// should contain, in order", so:
//     delete    = leave that page out of the plan
//     reorder   = list the entries in a different order
//     duplicate = list the same source page twice
//     rotate    = set rotationDelta on an entry
//
// This mirrors the model production already proved out in
// build_document_from_plan, and it is what makes duplicates behave: each
// entry is imported as its own independent page, so editing one copy can
// never affect the other. Doing it as in-place mutation instead would make
// "duplicate then edit the duplicate" quietly change both.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { Scratch } from "./core"

export interface PagePlanEntry {
  /** Index of the page in the SOURCE document (0-based). The same index may
   * appear more than once — that is how a page gets duplicated. */
  sourceIndex: number
  /** Extra quarter turns to add to whatever rotation the source page
   * already carried, in degrees (0/90/180/270). Added rather than
   * replaced, so a page that was already landscape stays landscape plus
   * the user's turns — the same rule production settled on. */
  rotationDelta?: number
}

export interface PageInfo {
  index: number
  widthPts: number
  heightPts: number
  /** Degrees: 0, 90, 180 or 270. */
  rotation: number
}

/** PDFium stores rotation as quarter turns (0-3), not degrees. */
const QUARTER_TURNS = 90

export function listPages(pdfium: WrappedPdfiumModule, doc: number): PageInfo[] {
  const out: PageInfo[] = []
  const n = pdfium.FPDF_GetPageCount(doc)
  for (let i = 0; i < n; i++) {
    const page = pdfium.FPDF_LoadPage(doc, i)
    out.push({
      index: i,
      widthPts: pdfium.FPDF_GetPageWidthF(page),
      heightPts: pdfium.FPDF_GetPageHeightF(page),
      rotation: pdfium.FPDFPage_GetRotation(page) * QUARTER_TURNS,
    })
    pdfium.FPDF_ClosePage(page)
  }
  return out
}

export interface BuildResult {
  ok: boolean
  /** Handle of the NEW document. The caller owns it and must close it. */
  document?: number
  error?: string
}

/**
 * Build a new document containing exactly the pages the plan describes.
 *
 * Imports from `srcDoc` in plan order. Importing (rather than mutating
 * srcDoc) is what keeps duplicates independent and leaves the source
 * untouched, so a plan can be rebuilt from scratch at any time — the
 * caller's undo story becomes "keep the old plan", with nothing to reverse.
 */
export function buildDocumentFromPlan(
  pdfium: WrappedPdfiumModule,
  srcDoc: number,
  plan: PagePlanEntry[],
  scratch: Scratch,
): BuildResult {
  const srcCount = pdfium.FPDF_GetPageCount(srcDoc)
  const valid = plan.filter((e) => e.sourceIndex >= 0 && e.sourceIndex < srcCount)
  if (valid.length === 0) return { ok: false, error: "plan has no valid pages" }

  const outDoc = pdfium.FPDF_CreateNewDocument()
  if (!outDoc) return { ok: false, error: "FPDF_CreateNewDocument failed" }

  // Imported one at a time, in plan order. A single ImportPagesByIndex call
  // with the whole list would be fewer calls, but PDFium de-duplicates
  // repeated indices within one call — which would silently drop exactly
  // the duplicates this exists to support.
  for (let i = 0; i < valid.length; i++) {
    const idxPtr = scratch.malloc(4)
    pdfium.pdfium.setValue(idxPtr, valid[i].sourceIndex, "i32")
    if (!pdfium.FPDF_ImportPagesByIndex(outDoc, srcDoc, idxPtr, 1, i)) {
      pdfium.FPDF_CloseDocument(outDoc)
      return { ok: false, error: `FPDF_ImportPagesByIndex failed for source page ${valid[i].sourceIndex}` }
    }
  }

  // Rotation is applied AFTER every page exists, as a page attribute — it
  // never redraws content, so object coordinates stay in the page's
  // unrotated space exactly as they were when edited.
  for (let i = 0; i < valid.length; i++) {
    const delta = valid[i].rotationDelta ?? 0
    if (!delta) continue
    const page = pdfium.FPDF_LoadPage(outDoc, i)
    const current = pdfium.FPDFPage_GetRotation(page)
    const turns = (((current + Math.round(delta / QUARTER_TURNS)) % 4) + 4) % 4
    pdfium.FPDFPage_SetRotation(page, turns)
    pdfium.FPDF_ClosePage(page)
  }

  return { ok: true, document: outDoc }
}

/** Convenience wrappers — each is just a plan over the current page list,
 * kept so calling code reads as the operation the user asked for rather
 * than as plan arithmetic. */

export function planForCurrentPages(pageCount: number): PagePlanEntry[] {
  return Array.from({ length: pageCount }, (_, i) => ({ sourceIndex: i }))
}

export function duplicatePageInPlan(plan: PagePlanEntry[], atIndex: number): PagePlanEntry[] {
  const next = [...plan]
  next.splice(atIndex + 1, 0, { ...plan[atIndex] })
  return next
}

export function deletePageFromPlan(plan: PagePlanEntry[], atIndex: number): PagePlanEntry[] {
  return plan.filter((_, i) => i !== atIndex)
}

export function movePageInPlan(plan: PagePlanEntry[], from: number, to: number): PagePlanEntry[] {
  const next = [...plan]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function rotatePageInPlan(plan: PagePlanEntry[], atIndex: number, deltaDegrees: number): PagePlanEntry[] {
  return plan.map((e, i) =>
    i === atIndex ? { ...e, rotationDelta: ((e.rotationDelta ?? 0) + deltaDegrees) % 360 } : e,
  )
}
