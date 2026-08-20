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

/**
 * Device pixels of margin rendered around a region and then thrown away.
 *
 * PDFium antialiases content against the EDGE of the bitmap it is drawing
 * into, so the outermost row and column of a region come out fractionally
 * different from the same pixels of a full-page render — measured at up to
 * 2/255, over about 130 pixels of a text patch. Invisible, but it means a
 * patched page is not quite the page a full repaint produces, and "not
 * quite" is not a property worth relying on. Rendering slightly wide and
 * keeping only the middle makes the patch exact.
 */
const BLEED_PX = 2

export interface PagePatch {
  width: number
  height: number
  rgba: Uint8ClampedArray
  /** Where this piece belongs in a full-page raster at the same scale, in
   * device pixels from the page's top-left. Reported rather than recomputed
   * by the caller so a patch lands on EXACTLY the pixels a full repaint
   * would have covered — rounding the rect twice, once here and once there,
   * can differ by a pixel and leave a hairline seam. */
  x: number
  y: number
}

/** One object to take out and put back, with the slot it came from. */
export interface HiddenObject {
  /** Its position in the page's object list, which is its z-order. */
  index: number
  handle: number
}

/**
 * A picture of one rectangle of the page, exactly as it is.
 *
 * The reason this exists apart from rendering the whole page: repainting a
 * full page at editing zoom costs 145-417ms, while an edit itself costs
 * about 7ms. Redrawing everything after moving one caption is what made the
 * editor feel slow — so a change repaints only the area it touched.
 *
 * `rect` is in PDF points with y measured from the BOTTOM, as PDF stores it.
 * The result is RGBA at `scale` device pixels per point.
 */
export function renderRegion(
  pdfium: WrappedPdfiumModule,
  page: number,
  rect: { left: number; bottom: number; right: number; top: number },
  scale: number,
  scratch: Scratch,
): PagePatch {
  const pageHeight = pdfium.FPDF_GetPageHeightF(page)
  const width = Math.max(1, Math.round((rect.right - rect.left) * scale))
  const height = Math.max(1, Math.round((rect.top - rect.bottom) * scale))

  // The viewport origin, and so also the patch's home in a full-page raster
  // — negated, because the offsets below shift the PAGE, not the window.
  const offsetX = Math.round(-rect.left * scale)
  const offsetY = Math.round(-(pageHeight - rect.top) * scale)

  const padWidth = width + BLEED_PX * 2
  const padHeight = height + BLEED_PX * 2

  const bitmap = pdfium.FPDFBitmap_Create(padWidth, padHeight, 0)
  if (!bitmap) throw new Error("FPDFBitmap_Create failed for a page region")
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, padWidth, padHeight, 0xffffffff)
    // PDFium has no "render this sub-rectangle" call, but shifting the
    // viewport origin is equivalent: the whole page is drawn into a window
    // positioned so only the wanted rect lands inside the bitmap.
    pdfium.FPDF_RenderPageBitmap(
      bitmap, page,
      // Shifted by the bleed, so the wanted rect still lands in the middle.
      offsetX + BLEED_PX,
      // Screen y counts from the top of the page, PDF y from the bottom.
      offsetY + BLEED_PX,
      // The page is sized EXACTLY as a full-page render sizes it, so the
      // pixels inside the window are the same pixels, not a rescaling.
      Math.round(pdfium.FPDF_GetPageWidthF(page) * scale),
      Math.round(pageHeight * scale),
      0, 0,
    )
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap)
    const src = scratch.readBytes(buffer, padWidth * padHeight * 4)
    const rgba = new Uint8ClampedArray(width * height * 4)
    // The bleed is dropped here rather than in a second pass: this loop is
    // already copying every pixel to swap BGRA (PDFium) for RGBA (canvas),
    // so skipping the margin costs nothing.
    for (let y = 0; y < height; y++) {
      let s = ((y + BLEED_PX) * padWidth + BLEED_PX) * 4
      let d = y * width * 4
      for (let x = 0; x < width; x++, s += 4, d += 4) {
        rgba[d + 0] = src[s + 2]
        rgba[d + 1] = src[s + 1]
        rgba[d + 2] = src[s + 0]
        rgba[d + 3] = 255
      }
    }
    return { width, height, rgba, x: -offsetX, y: -offsetY }
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap)
  }
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
  // Highest index first: removing an object shifts everything after it down,
  // so taking them out from the back leaves the earlier indices still valid.
  const ordered = [...objects].sort((a, b) => b.index - a.index)
  const removed: HiddenObject[] = []

  try {
    for (const obj of ordered) {
      if (pdfium.FPDFPage_RemoveObject(page, obj.handle)) removed.push(obj)
    }
    pdfium.FPDFPage_GenerateContent(page)
    return renderRegion(pdfium, page, rect, scale, scratch)
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
