// Bringing text out of Form XObjects, so it can be edited like any other.
//
// A Form XObject is a reusable bundle of drawing instructions. Designers
// produce them constantly — placed artwork, grouped layers — and text inside
// one is drawn on the page exactly like any other text. It is simply not a
// child of the PAGE, and that is the whole problem: this editor walks the
// page's object list, so text in a form was invisible to it. It appeared on
// screen, had no edit box, and could not be selected, while identical-looking
// text beside it worked perfectly. That is what "some text is not editable"
// turned out to be, and it is entirely a property of the file rather than of
// the words in it.
//
// Reaching INTO the form is not enough, and this was established by
// measurement rather than assumed:
//
//   - FPDFFormObj_RemoveObject returns false in this build, so a child
//     cannot be taken out of its form;
//   - setting a matrix on a child DOES change what the object reports, and
//     the change is then LOST on save, because PDFium rebuilds a page's
//     instructions from its object list but never a form's.
//
// So an editor that edited in place would appear to work and quietly save a
// file with none of the changes in it, which is worse than refusing.
//
// What does work is promotion: the form's children are inserted into the
// page in its place and the form itself removed. Verified end to end — after
// saving and reopening, the text is present exactly once, at the same
// coordinates, as an ordinary page object. From that moment nothing
// downstream needs to know forms exist.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { PAGEOBJ_TYPE, Scratch, type PdfMatrix } from "./core"
import { renderPageToRGBA } from "./text"

const IDENTITY: PdfMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** The child's transform followed by its container's. */
function concatMatrix(child: PdfMatrix, parent: PdfMatrix): PdfMatrix {
  return {
    a: child.a * parent.a + child.b * parent.c,
    b: child.a * parent.b + child.b * parent.d,
    c: child.c * parent.a + child.d * parent.c,
    d: child.c * parent.b + child.d * parent.d,
    e: child.e * parent.a + child.f * parent.c + parent.e,
    f: child.e * parent.b + child.f * parent.d + parent.f,
  }
}

/** Every descendant of a form, innermost containers resolved first, each
 * with the transform it is actually drawn with. */
function collectChildren(
  pdfium: WrappedPdfiumModule,
  form: number,
  parentMatrix: PdfMatrix,
  scratch: Scratch,
  out: { handle: number; matrix: PdfMatrix }[],
): void {
  const count = pdfium.FPDFFormObj_CountObjects(form)
  for (let i = 0; i < count; i++) {
    const child = pdfium.FPDFFormObj_GetObject(form, i)
    const ptr = scratch.malloc(24)
    const own = pdfium.FPDFPageObj_GetMatrix(child, ptr) ? scratch.readMatrix(ptr) : IDENTITY
    const combined = concatMatrix(own, parentMatrix)
    if (pdfium.FPDFPageObj_GetType(child) === PAGEOBJ_TYPE.FORM) {
      // Forms nest. A form inside a form is flattened the same way, so the
      // page ends up holding only things it can actually edit.
      collectChildren(pdfium, child, combined, scratch, out)
      continue
    }
    out.push({ handle: child, matrix: combined })
  }
}

/**
 * Replaces every Form XObject on a page with its contents.
 *
 * ALL contents, not only the text: a form usually holds the rules and marks
 * that go with its words, and promoting the words alone would quietly delete
 * the rest of the design.
 *
 * Children go in AT the form's own position rather than on the end, so what
 * was drawn over what is unchanged — appending them would lift a heading out
 * from behind the photo it was tucked under.
 *
 * Returns how many forms were flattened, so the caller can skip the work of
 * re-reading a page that had none.
 */
export function flattenForms(
  pdfium: WrappedPdfiumModule,
  page: number,
  scratch: Scratch,
): number {
  let flattened = 0

  // Repeated rather than done in one pass: removing a form renumbers the
  // page's objects, and a promoted child may itself have been a form.
  for (let guard = 0; guard < 8; guard++) {
    const count = pdfium.FPDFPage_CountObjects(page)
    let formIndex = -1
    let form = 0
    for (let i = 0; i < count; i++) {
      const obj = pdfium.FPDFPage_GetObject(page, i)
      if (pdfium.FPDFPageObj_GetType(obj) === PAGEOBJ_TYPE.FORM) {
        formIndex = i
        form = obj
        break
      }
    }
    if (formIndex < 0) break

    const ptr = scratch.malloc(24)
    const formMatrix = pdfium.FPDFPageObj_GetMatrix(form, ptr)
      ? scratch.readMatrix(ptr)
      : IDENTITY

    const children: { handle: number; matrix: PdfMatrix }[] = []
    collectChildren(pdfium, form, formMatrix, scratch, children)

    children.forEach((child, offset) => {
      // Rewritten to the matrix it was already being drawn with, so leaving
      // the container moves nothing.
      const m = child.matrix
      pdfium.FPDFPageObj_SetMatrix(
        child.handle, scratch.writeMatrix(m.a, m.b, m.c, m.d, m.e, m.f))
      pdfium.FPDFPage_InsertObjectAtIndex(page, child.handle, formIndex + offset)
    })

    // Last: while the form is still on the page its children are drawn
    // twice, so it goes only once they are all safely in place.
    if (!pdfium.FPDFPage_RemoveObject(page, form)) break
    flattened++
  }

  if (flattened > 0) pdfium.FPDFPage_GenerateContent(page)
  return flattened
}


/**
 * Scale the before/after comparison is rendered at.
 *
 * Not the editing resolution — this only has to answer "did anything move",
 * and a page about seven hundred pixels wide answers it while costing a
 * fraction of a full render.
 */
const CHECK_SCALE = 1.2

/**
 * Share of a page's pixels allowed to differ and still count as unchanged.
 *
 * Effectively zero. Every page that flattens cleanly measured EXACTLY zero,
 * so this is tolerance for a stray antialiased pixel rather than a budget to
 * spend.
 */
const MAX_PIXEL_CHANGE = 0.0001

/** Does this page hold a form with any text inside it? Pages without one
 * are left alone entirely — no flattening, and no cost for checking. */
function hasTextInAForm(pdfium: WrappedPdfiumModule, page: number, scratch: Scratch): boolean {
  const count = pdfium.FPDFPage_CountObjects(page)
  for (let i = 0; i < count; i++) {
    const obj = pdfium.FPDFPage_GetObject(page, i)
    if (pdfium.FPDFPageObj_GetType(obj) !== PAGEOBJ_TYPE.FORM) continue
    const children: { handle: number; matrix: PdfMatrix }[] = []
    collectChildren(pdfium, obj, IDENTITY, scratch, children)
    for (const child of children) {
      if (pdfium.FPDFPageObj_GetType(child.handle) === PAGEOBJ_TYPE.TEXT) return true
    }
  }
  return false
}

/** How much of one raster differs from another, 0-1. */
function pixelDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 1
  let differing = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8
      || Math.abs(a[i + 1] - b[i + 1]) > 8
      || Math.abs(a[i + 2] - b[i + 2]) > 8) differing++
  }
  return differing / (a.length / 4)
}

/**
 * Flattens the forms in a document, but ONLY while doing so changes nothing
 * on screen.
 *
 * It is not always free. A form can carry a clipping path, a transparency
 * group or a blend mode, and none of that survives its children being moved
 * out — measured on a real customer file where one page came out 44%
 * different. A document is worth far more than the convenience of editing
 * one heading in it, so every page that is touched is rendered before and
 * after and compared, and the FIRST page that changes abandons the whole
 * attempt.
 *
 * Returns false when the caller must throw this document away and reopen the
 * original. The alternative — flattening some pages and not others — would
 * leave a file whose editability depended on which page you were looking at,
 * which is the confusion this set out to remove.
 */
export function flattenFormsIfLossless(
  pdfium: WrappedPdfiumModule,
  document: number,
  scratch: Scratch,
): boolean {
  const pageCount = pdfium.FPDF_GetPageCount(document)
  for (let i = 0; i < pageCount; i++) {
    const page = pdfium.FPDF_LoadPage(document, i)
    if (!page) continue
    try {
      if (!hasTextInAForm(pdfium, page, scratch)) continue
      const before = renderPageToRGBA(pdfium, page, CHECK_SCALE, scratch)
      if (flattenForms(pdfium, page, scratch) === 0) continue
      const after = renderPageToRGBA(pdfium, page, CHECK_SCALE, scratch)
      if (pixelDifference(before.rgba, after.rgba) > MAX_PIXEL_CHANGE) return false
    } finally {
      pdfium.FPDF_ClosePage(page)
    }
  }
  return true
}
