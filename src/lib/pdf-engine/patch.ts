// Rendering a piece of a page with something LEFT OUT.
//
// Used for one thing: while a slot is being dragged, the place it came from
// has to look genuinely empty. A CSS cover cannot do that — it can only
// paint an opaque patch over the original, which reads as a grey mark
// sitting on the artwork. Only the engine knows what is BEHIND an object,
// so only the engine can produce the picture of the page without it.
//
// The whole hide/render/restore cycle happens inside ONE call, wrapped in a
// finally. The document the caller holds is never observably changed: it is
// mutated and put back before the call returns, so no other operation can
// ever run against a page that is missing objects, and a throw part-way
// through still restores.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { Scratch } from "./core"

export interface PagePatch {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** One object to take out and put back, with the slot it came from. */
export interface HiddenObject {
  /** Its position in the page's object list, which is its z-order. */
  index: number
  handle: number
}

/**
 * A picture of `rect` on the page, rendered as if `objects` were not there.
 *
 * `rect` is in PDF points with y measured from the BOTTOM, as PDF stores it.
 * The result is RGBA at `scale` device pixels per point.
 */
export function renderRegionWithout(
  pdfium: WrappedPdfiumModule,
  page: number,
  objects: HiddenObject[],
  rect: { left: number; bottom: number; right: number; top: number },
  scale: number,
  scratch: Scratch,
): PagePatch {
  const pageHeight = pdfium.FPDF_GetPageHeightF(page)
  const width = Math.max(1, Math.round((rect.right - rect.left) * scale))
  const height = Math.max(1, Math.round((rect.top - rect.bottom) * scale))

  // Highest index first: removing an object shifts everything after it down,
  // so taking them out from the back leaves the earlier indices still valid.
  const ordered = [...objects].sort((a, b) => b.index - a.index)
  const removed: HiddenObject[] = []

  try {
    for (const obj of ordered) {
      if (pdfium.FPDFPage_RemoveObject(page, obj.handle)) removed.push(obj)
    }
    pdfium.FPDFPage_GenerateContent(page)

    const bitmap = pdfium.FPDFBitmap_Create(width, height, 0)
    if (!bitmap) throw new Error("FPDFBitmap_Create failed for the clean patch")
    try {
      pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
      // The whole page is rendered into a viewport shifted so that only the
      // wanted rect lands inside the bitmap — PDFium has no "render this
      // sub-rectangle" call, but an offset origin is equivalent.
      pdfium.FPDF_RenderPageBitmap(
        bitmap, page,
        Math.round(-rect.left * scale),
        // Screen y counts from the top of the page, PDF y from the bottom.
        Math.round(-(pageHeight - rect.top) * scale),
        Math.round(pdfium.FPDF_GetPageWidthF(page) * scale),
        Math.round(pageHeight * scale),
        0, 0,
      )
      const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap)
      // BGRA out of PDFium, RGBA into a canvas — the same swap the full-page
      // renderer does, just over a smaller area.
      const src = scratch.readBytes(buffer, width * height * 4)
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4 + 0] = src[i * 4 + 2]
        rgba[i * 4 + 1] = src[i * 4 + 1]
        rgba[i * 4 + 2] = src[i * 4 + 0]
        rgba[i * 4 + 3] = 255
      }
      return { width, height, rgba }
    } finally {
      pdfium.FPDFBitmap_Destroy(bitmap)
    }
  } finally {
    // Lowest index first, so each object lands back in the slot it came
    // from: re-inserting at an index shifts the later ones right again, and
    // ascending order rebuilds the original z-order exactly.
    for (const obj of [...removed].sort((a, b) => a.index - b.index)) {
      pdfium.FPDFPage_InsertObjectAtIndex(page, obj.handle, obj.index)
    }
    pdfium.FPDFPage_GenerateContent(page)
  }
}
