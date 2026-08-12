/**
 * PDF engine — in-place PDF editing for the Create PDF module.
 *
 * Public surface is the worker client: UI code should import from here and
 * nothing deeper, so the PDFium details stay replaceable.
 *
 * Usage:
 *   const engine = new PdfEngineClient()
 *   const { docId, pages } = await engine.open(pdfArrayBuffer)
 *   const { lines } = await engine.listTextLines(docId, 0)
 *   await engine.editTextLine(docId, 0, 2, "New heading")
 *   const { bytes } = await engine.save(docId)
 *   engine.terminate()
 */
export { PdfEngineClient, drawRenderedPage } from "./client"
export type {
  EnginePage, EngineTextLine, EngineImage, RenderedPage,
  EditTextOptions, TextOverlayRequest, ImageOverlayRequest, PagePlanRequest,
} from "./protocol"
export type { TextAlign } from "./layout"
export type { PdfMatrix, PdfRect } from "./core"

// Page-plan helpers are pure array maths with no PDFium dependency, so the
// UI can build and preview a plan (including undo) without touching the
// worker at all, and only send the final arrangement.
export {
  planForCurrentPages, duplicatePageInPlan, deletePageFromPlan,
  movePageInPlan, rotatePageInPlan,
} from "./pages"
