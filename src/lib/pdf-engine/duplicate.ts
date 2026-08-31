import type { WrappedPdfiumModule, Scratch } from "./core"
import { PAGEOBJ_TYPE } from "./core"

/**
 * Copying an object that is already on a page.
 *
 * PDFium has no "clone this object" call, so each kind has to be rebuilt from
 * what can be read off the original. That is the whole of this module, and the
 * reason it is worth having in one place: a copy that is subtly not a copy —
 * the right shape in the wrong colour, the right picture at the wrong size —
 * is the kind of fault nobody notices until it is in print.
 *
 * Text is NOT here. Text is rebuilt through the same overlay machinery that
 * draws every other new line, which already owns fonts, wrapping and
 * direction; duplicating it any other way would be a second implementation of
 * the hardest part of this editor.
 */

/** PDFium's path segment kinds. */
const SEGMENT_LINETO = 0
const SEGMENT_BEZIERTO = 1
const SEGMENT_MOVETO = 2

/**
 * Where a copy lands relative to its original, in PDF points.
 *
 * Offset rather than exactly on top, and this is not decoration: a copy
 * sitting precisely over the original is indistinguishable from nothing
 * having happened, and the user's next click selects one of the two at
 * random. Down and to the right is the direction every editor uses.
 */
export const DUPLICATE_OFFSET_PTS = 14

export interface CloneResult {
  ok: boolean
  error?: string
  /** The new object, already added to the page. */
  handle?: number
}

/**
 * Copies an image object, pixels and placement together.
 *
 * The pixels come across as a BITMAP rather than as the original compressed
 * stream. Re-embedding the stream would be lossless but needs the filter and
 * colour space handled case by case; the bitmap is what PDFium itself
 * decoded, so it is correct for every image the renderer can already draw —
 * including the ones with unusual encodings, which is exactly where a
 * case-by-case implementation would fail.
 */
export function cloneImageObject(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  source: number,
  scratch: Scratch,
  dx = DUPLICATE_OFFSET_PTS,
  dy = -DUPLICATE_OFFSET_PTS,
): CloneResult {
  const bitmap = pdfium.FPDFImageObj_GetBitmap(source)
  if (!bitmap) return { ok: false, error: "could not read that picture's pixels" }

  try {
    const copy = pdfium.FPDFPageObj_NewImageObj(document)
    if (!copy) return { ok: false, error: "could not create a new picture" }

    // pages/count are 0 because this image is not replacing one already drawn
    // on other pages — it is brand new and belongs to nothing yet.
    if (!pdfium.FPDFImageObj_SetBitmap(0, 0, copy, bitmap)) {
      pdfium.FPDFPageObj_Destroy(copy)
      return { ok: false, error: "could not copy the picture's pixels" }
    }

    // The matrix carries position, size and any rotation or mirroring in one
    // value. Copying it is what makes the duplicate the same shape as the
    // original rather than a default-sized rectangle of the same pixels.
    const mPtr = scratch.malloc(24)
    if (pdfium.FPDFPageObj_GetMatrix(source, mPtr)) {
      pdfium.FPDFPageObj_SetMatrix(copy, mPtr)
    }
    pdfium.FPDFPageObj_Transform(copy, 1, 0, 0, 1, dx, dy)

    pdfium.FPDFPage_InsertObject(page, copy)
    return { ok: true, handle: copy }
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap)
  }
}

/**
 * Copies a path object: its outline, its colours and its placement.
 *
 * Replayed segment by segment because a path has no other readable form. The
 * first segment is treated as the starting point whatever PDFium calls it —
 * a path that begins with a line rather than a move still has to begin
 * somewhere, and creating the path IS the move.
 */
export function clonePathObject(
  pdfium: WrappedPdfiumModule,
  page: number,
  source: number,
  scratch: Scratch,
  dx = DUPLICATE_OFFSET_PTS,
  dy = -DUPLICATE_OFFSET_PTS,
): CloneResult {
  const count = pdfium.FPDFPath_CountSegments(source)
  if (count <= 0) return { ok: false, error: "that artwork has no outline to copy" }

  const xPtr = scratch.malloc(4)
  const yPtr = scratch.malloc(4)
  const readPoint = (segment: number) => {
    if (!pdfium.FPDFPathSegment_GetPoint(segment, xPtr, yPtr)) return null
    return { x: scratch.readFloat(xPtr), y: scratch.readFloat(yPtr) }
  }

  const first = pdfium.FPDFPath_GetPathSegment(source, 0)
  const start = first ? readPoint(first) : null
  if (!start) return { ok: false, error: "could not read where that artwork starts" }

  const copy = pdfium.FPDFPageObj_CreateNewPath(start.x, start.y)
  if (!copy) return { ok: false, error: "could not create a new path" }

  for (let i = 1; i < count; i++) {
    const segment = pdfium.FPDFPath_GetPathSegment(source, i)
    if (!segment) continue
    const type = pdfium.FPDFPathSegment_GetType(segment)

    if (type === SEGMENT_BEZIERTO) {
      // A curve is three points in the source, stored as three consecutive
      // segments; PDFium's own reader hands them over one at a time.
      const c1 = readPoint(segment)
      const s2 = pdfium.FPDFPath_GetPathSegment(source, i + 1)
      const s3 = pdfium.FPDFPath_GetPathSegment(source, i + 2)
      const c2 = s2 ? readPoint(s2) : null
      const end = s3 ? readPoint(s3) : null
      if (c1 && c2 && end) {
        pdfium.FPDFPath_BezierTo(copy, c1.x, c1.y, c2.x, c2.y, end.x, end.y)
        i += 2
        continue
      }
      // A truncated curve is drawn as a straight line to where it started
      // heading rather than dropped: losing a segment silently changes the
      // shape, and a straight edge is at least visible as wrong.
      if (c1) pdfium.FPDFPath_LineTo(copy, c1.x, c1.y)
      continue
    }

    const point = readPoint(segment)
    if (!point) continue
    if (type === SEGMENT_MOVETO) pdfium.FPDFPath_MoveTo(copy, point.x, point.y)
    else if (type === SEGMENT_LINETO) pdfium.FPDFPath_LineTo(copy, point.x, point.y)

    if (pdfium.FPDFPathSegment_GetClose(segment)) pdfium.FPDFPath_Close(copy)
  }

  // Colours and how the outline is filled. Without these the copy is drawn
  // in PDFium's defaults — an invisible or black shape where a brand colour
  // used to be.
  const rPtr = scratch.malloc(4), gPtr = scratch.malloc(4)
  const bPtr = scratch.malloc(4), aPtr = scratch.malloc(4)
  if (pdfium.FPDFPageObj_GetFillColor(source, rPtr, gPtr, bPtr, aPtr)) {
    pdfium.FPDFPageObj_SetFillColor(
      copy, scratch.readInt(rPtr), scratch.readInt(gPtr),
      scratch.readInt(bPtr), scratch.readInt(aPtr))
  }
  if (pdfium.FPDFPageObj_GetStrokeColor(source, rPtr, gPtr, bPtr, aPtr)) {
    pdfium.FPDFPageObj_SetStrokeColor(
      copy, scratch.readInt(rPtr), scratch.readInt(gPtr),
      scratch.readInt(bPtr), scratch.readInt(aPtr))
  }
  const wPtr = scratch.malloc(4)
  if (pdfium.FPDFPageObj_GetStrokeWidth(source, wPtr)) {
    pdfium.FPDFPageObj_SetStrokeWidth(copy, scratch.readFloat(wPtr))
  }

  const fillPtr = scratch.malloc(4)
  const strokePtr = scratch.malloc(4)
  if (pdfium.FPDFPath_GetDrawMode(source, fillPtr, strokePtr)) {
    pdfium.FPDFPath_SetDrawMode(
      copy, scratch.readInt(fillPtr), scratch.readInt(strokePtr) !== 0)
  }

  const mPtr = scratch.malloc(24)
  if (pdfium.FPDFPageObj_GetMatrix(source, mPtr)) {
    pdfium.FPDFPageObj_SetMatrix(copy, mPtr)
  }
  pdfium.FPDFPageObj_Transform(copy, 1, 0, 0, 1, dx, dy)

  pdfium.FPDFPage_InsertObject(page, copy)
  return { ok: true, handle: copy }
}

/** Copies whichever kind the object happens to be. */
export function clonePageObject(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  source: number,
  scratch: Scratch,
  dx?: number,
  dy?: number,
): CloneResult {
  const type = pdfium.FPDFPageObj_GetType(source)
  if (type === PAGEOBJ_TYPE.IMAGE) {
    return cloneImageObject(pdfium, document, page, source, scratch, dx, dy)
  }
  if (type === PAGEOBJ_TYPE.PATH) {
    return clonePathObject(pdfium, page, source, scratch, dx, dy)
  }
  return { ok: false, error: "that kind of object cannot be copied yet" }
}
