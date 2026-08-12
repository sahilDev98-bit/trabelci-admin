// Image-object operations: find the real image objects on a page, read
// their true geometry, replace their pixels, or remove them.
//
// The central decision here is REPLACE IN PLACE rather than
// remove-and-create. A PDF image object carries far more than pixels: its
// matrix (position/scale/rotation), its clip path (the circle or rounded
// rectangle the page cuts it to), its blend mode, its soft mask. Creating a
// fresh object means reconstructing every one of those by hand and getting
// each right — which is exactly the work the current PyMuPDF pipeline has
// to do (see _resolve_image_xref / _smask_xref_for / _reapply_smask in
// pdf_editor.py). Swapping only the pixel data on the EXISTING object
// leaves all of it untouched by construction, so shape-clipping and
// transparency survive for free.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { PAGEOBJ_TYPE, Scratch } from "./core"

export interface ImageObjectInfo {
  index: number
  handle: number
  /** Placed size/position on the page, PDF points. */
  bounds: { left: number; bottom: number; right: number; top: number } | null
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number }
  /** The stored bitmap's own resolution, in pixels. */
  pixelWidth: number
  pixelHeight: number
  bitsPerPixel: number
  colorspace: number
  /** True when the page clips this image to a shape (circle, rounded
   * corners, silhouette) rather than drawing the full rectangle. */
  hasClipPath: boolean
  clipPathCount: number
  /** Compression filters on the stored stream, e.g. ["DCTDecode"] for JPEG. */
  filters: string[]
}

export function listImageObjects(pdfium: WrappedPdfiumModule, page: number, scratch: Scratch): ImageObjectInfo[] {
  const count = pdfium.FPDFPage_CountObjects(page)
  const out: ImageObjectInfo[] = []

  for (let i = 0; i < count; i++) {
    const obj = pdfium.FPDFPage_GetObject(page, i)
    if (pdfium.FPDFPageObj_GetType(obj) !== PAGEOBJ_TYPE.IMAGE) continue

    const lPtr = scratch.malloc(4), bPtr = scratch.malloc(4), rPtr = scratch.malloc(4), tPtr = scratch.malloc(4)
    let bounds: ImageObjectInfo["bounds"] = null
    if (pdfium.FPDFPageObj_GetBounds(obj, lPtr, bPtr, rPtr, tPtr)) {
      bounds = {
        left: scratch.readFloat(lPtr), bottom: scratch.readFloat(bPtr),
        right: scratch.readFloat(rPtr), top: scratch.readFloat(tPtr),
      }
    }

    const mPtr = scratch.malloc(24)
    pdfium.FPDFPageObj_GetMatrix(obj, mPtr)
    const matrix = scratch.readMatrix(mPtr)

    // FPDF_IMAGEOBJ_METADATA: width, height (uint), horizontal_dpi,
    // vertical_dpi (float), bits_per_pixel, colorspace, marked_content_id.
    const metaPtr = scratch.malloc(28)
    let pixelWidth = 0, pixelHeight = 0, bitsPerPixel = 0, colorspace = 0
    if (pdfium.FPDFImageObj_GetImageMetadata(obj, page, metaPtr)) {
      const p = pdfium.pdfium
      pixelWidth = p.getValue(metaPtr + 0, "i32")
      pixelHeight = p.getValue(metaPtr + 4, "i32")
      bitsPerPixel = p.getValue(metaPtr + 16, "i32")
      colorspace = p.getValue(metaPtr + 20, "i32")
    }

    const clipPath = pdfium.FPDFPageObj_GetClipPath(obj)
    const clipPathCount = clipPath ? pdfium.FPDFClipPath_CountPaths(clipPath) : 0

    const filters: string[] = []
    const filterCount = pdfium.FPDFImageObj_GetImageFilterCount(obj)
    for (let f = 0; f < filterCount; f++) {
      const need = pdfium.FPDFImageObj_GetImageFilter(obj, f, 0, 0)
      if (need > 0) {
        const buf = scratch.malloc(need)
        pdfium.FPDFImageObj_GetImageFilter(obj, f, buf, need)
        filters.push(pdfium.pdfium.UTF8ToString(buf))
      }
    }

    out.push({
      index: i, handle: obj, bounds, matrix, pixelWidth, pixelHeight,
      bitsPerPixel, colorspace,
      hasClipPath: clipPathCount > 0, clipPathCount, filters,
    })
  }
  return out
}

export interface ReplaceResult {
  ok: boolean
  method?: "png" | "jpeg" | "bitmap"
  error?: string
}

/**
 * Swap the pixels of an EXISTING image object, keeping its object identity
 * (and therefore its matrix, clip path and blend mode) intact.
 *
 * `pages`/`count` are required by PDFium so it can invalidate any cached
 * rendering of the pages the image appears on; passing the page the object
 * lives on is what makes the change show up on a subsequent render.
 */
export function replaceImageBytes(
  pdfium: WrappedPdfiumModule,
  page: number,
  imageObj: number,
  bytes: Uint8Array,
  kind: "png" | "jpeg",
  scratch: Scratch,
): ReplaceResult {
  // FPDFImageObj_SetBitmap's documented shape is
  // (FPDF_PAGE* pages, int count, FPDF_PAGEOBJECT, FPDF_BITMAP); the
  // EmbedPDF PNG/JPEG helpers follow the same leading convention with the
  // encoded buffer in place of the bitmap.
  const pagesArray = scratch.malloc(4)
  pdfium.pdfium.setValue(pagesArray, page, "i32")
  const dataPtr = scratch.writeBuffer(bytes)

  const fn = kind === "png" ? pdfium.EPDFImageObj_SetPng : pdfium.EPDFImageObj_SetJpeg
  const ok = fn(pagesArray, 1, imageObj, dataPtr, bytes.length)
  if (!ok) return { ok: false, error: `EPDFImageObj_Set${kind === "png" ? "Png" : "Jpeg"} returned false` }
  return { ok: true, method: kind }
}

/**
 * Fallback path: hand PDFium raw RGBA pixels instead of an encoded file.
 * Used when the encoded-bytes path is unavailable or rejects an image, and
 * as the route a browser would take after decoding through canvas.
 */
export function replaceImageFromRGBA(
  pdfium: WrappedPdfiumModule,
  page: number,
  imageObj: number,
  rgba: Uint8Array,
  width: number,
  height: number,
  scratch: Scratch,
): ReplaceResult {
  // FPDFBitmap_CreateEx(width, height, format, first_scan, stride).
  // format 4 = FPDFBitmap_BGRA. PDFium reads BGRA, so the channel order is
  // swapped on the way in — the same swap renderPageToRGBA does on the way
  // out, just in reverse.
  const bgra = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    bgra[i * 4 + 0] = rgba[i * 4 + 2]
    bgra[i * 4 + 1] = rgba[i * 4 + 1]
    bgra[i * 4 + 2] = rgba[i * 4 + 0]
    bgra[i * 4 + 3] = rgba[i * 4 + 3]
  }
  const bufPtr = scratch.writeBuffer(bgra)
  const bitmap = pdfium.FPDFBitmap_CreateEx(width, height, 4, bufPtr, width * 4)
  if (!bitmap) return { ok: false, error: "FPDFBitmap_CreateEx failed" }

  const pagesArray = scratch.malloc(4)
  pdfium.pdfium.setValue(pagesArray, page, "i32")
  const ok = pdfium.FPDFImageObj_SetBitmap(pagesArray, 1, imageObj, bitmap)
  pdfium.FPDFBitmap_Destroy(bitmap)
  if (!ok) return { ok: false, error: "FPDFImageObj_SetBitmap returned false" }
  return { ok: true, method: "bitmap" }
}

/** Delete an image from the page entirely, leaving whatever was drawn
 * beneath it visible — the equivalent of production's
 * _remove_image_content, but without needing to paint over anything. */
export function removeImageObject(pdfium: WrappedPdfiumModule, page: number, imageObj: number): { ok: boolean; error?: string } {
  if (!pdfium.FPDFPage_RemoveObject(page, imageObj)) return { ok: false, error: "FPDFPage_RemoveObject failed" }
  pdfium.FPDFPageObj_Destroy(imageObj)
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/** The image as currently rendered by PDFium, WITH its clip/mask applied —
 * useful for confirming a replacement kept the page's own shape. */
export function renderImageObject(
  pdfium: WrappedPdfiumModule, doc: number, page: number, imageObj: number, scratch: Scratch,
): { width: number; height: number; rgba: Uint8Array } | null {
  const bitmap = pdfium.FPDFImageObj_GetRenderedBitmap(doc, page, imageObj)
  if (!bitmap) return null
  const width = pdfium.FPDFBitmap_GetWidth(bitmap)
  const height = pdfium.FPDFBitmap_GetHeight(bitmap)
  const stride = pdfium.FPDFBitmap_GetStride(bitmap)
  const bufPtr = pdfium.FPDFBitmap_GetBuffer(bitmap)
  const raw = scratch.readBytes(bufPtr, stride * height)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * 4
      const d = (y * width + x) * 4
      rgba[d + 0] = raw[s + 2]
      rgba[d + 1] = raw[s + 1]
      rgba[d + 2] = raw[s + 0]
      rgba[d + 3] = raw[s + 3]
    }
  }
  pdfium.FPDFBitmap_Destroy(bitmap)
  return { width, height, rgba }
}
