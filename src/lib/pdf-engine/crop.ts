import type { WrappedPdfiumModule, Scratch } from "./core"

/**
 * Trimming a picture.
 *
 * "Crop" in a PDF could in principle be done two ways: shrink the clip path
 * the image is drawn through, or actually cut the pixels. The build of PDFium
 * here exposes no way to SET a clip path — only to read one and to transform
 * an existing one — so cutting the pixels is the route available.
 *
 * That has a real cost worth stating plainly: the picture is re-encoded from
 * what PDFium decoded, so a JPEG photograph goes through one more generation.
 * It is the same route a duplicated image already takes, and it is correct
 * for every encoding the renderer can read, which a filter-by-filter
 * implementation would not be.
 *
 * The other half of a crop is arithmetic, and it is the half that is easy to
 * get wrong: after cutting pixels away, the part that is KEPT has to stay
 * exactly where it was on the page. If the matrix is not adjusted to match,
 * the picture appears to jump and grow at the moment you press Done.
 */

/**
 * The region to keep, as fractions of the original picture.
 *
 * In the image's own space, where (0,0) is the bottom-left and (1,1) the
 * top-right — the same convention as the rest of PDF, and NOT the top-down
 * one bitmaps use. The conversion happens once, below, rather than in every
 * caller.
 */
export interface CropRegion {
  left: number
  bottom: number
  right: number
  top: number
}

export interface CropResult {
  ok: boolean
  error?: string
  /** Pixel size of the trimmed picture, for reporting. */
  width?: number
  height?: number
}

/** Nothing smaller than this survives being useful, in pixels. */
const MIN_CROP_PX = 4

export function cropImageObject(
  pdfium: WrappedPdfiumModule,
  imageObject: number,
  region: CropRegion,
  scratch: Scratch,
): CropResult {
  const left = clamp01(Math.min(region.left, region.right))
  const right = clamp01(Math.max(region.left, region.right))
  const bottom = clamp01(Math.min(region.bottom, region.top))
  const top = clamp01(Math.max(region.bottom, region.top))
  const du = right - left
  const dv = top - bottom
  if (du <= 0 || dv <= 0) return { ok: false, error: "the crop area is empty" }
  // Cropping to the whole picture is not an error, it is simply nothing to
  // do — and doing it anyway would re-encode the image for no reason.
  if (du > 0.999 && dv > 0.999) return { ok: true }

  const source = pdfium.FPDFImageObj_GetBitmap(imageObject)
  if (!source) return { ok: false, error: "could not read that picture's pixels" }

  try {
    const srcWidth = pdfium.FPDFBitmap_GetWidth(source)
    const srcHeight = pdfium.FPDFBitmap_GetHeight(source)
    const srcStride = pdfium.FPDFBitmap_GetStride(source)
    const format = pdfium.FPDFBitmap_GetFormat(source)
    const srcBuffer = pdfium.FPDFBitmap_GetBuffer(source)
    if (!srcWidth || !srcHeight || !srcBuffer) {
      return { ok: false, error: "that picture has no pixels to trim" }
    }
    const bytesPerPixel = Math.max(1, Math.floor(srcStride / srcWidth))

    // A bitmap's rows run TOP-down while the crop region is measured
    // bottom-up, so the vertical range is flipped here. Getting this wrong
    // crops the opposite end of the picture, which looks like the handles
    // being inverted rather than like a coordinate bug.
    const x0 = Math.round(left * srcWidth)
    const x1 = Math.round(right * srcWidth)
    const y0 = Math.round((1 - top) * srcHeight)
    const y1 = Math.round((1 - bottom) * srcHeight)
    const outWidth = Math.max(MIN_CROP_PX, x1 - x0)
    const outHeight = Math.max(MIN_CROP_PX, y1 - y0)

    const outStride = outWidth * bytesPerPixel
    const outBuffer = scratch.malloc(outStride * outHeight)
    // HEAPU8 exists at runtime — Emscripten always exposes it — but is not in
    // the ambient types this package ships, the same reason Scratch reaches
    // for it this way.
    const heap = (pdfium.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8
    if (!heap) return { ok: false, error: "could not reach the image memory" }

    for (let row = 0; row < outHeight; row++) {
      const from = srcBuffer + (y0 + row) * srcStride + x0 * bytesPerPixel
      const to = outBuffer + row * outStride
      heap.copyWithin(to, from, from + outStride)
    }

    const cropped = pdfium.FPDFBitmap_CreateEx(
      outWidth, outHeight, format, outBuffer, outStride)
    if (!cropped) return { ok: false, error: "could not build the trimmed picture" }

    try {
      // The matrix is read BEFORE the pixels are replaced: SetBitmap can
      // reset it, and the original placement is what the new one is derived
      // from.
      const mPtr = scratch.malloc(24)
      const hasMatrix = pdfium.FPDFPageObj_GetMatrix(imageObject, mPtr)
      const m = hasMatrix ? scratch.readMatrix(mPtr) : null

      if (!pdfium.FPDFImageObj_SetBitmap(0, 0, imageObject, cropped)) {
        return { ok: false, error: "could not replace the picture's pixels" }
      }

      if (m) {
        // An image's matrix maps the unit square onto the page. The kept
        // region was the sub-square (left, bottom)-(right, top) of that, so
        // the new unit square must map onto exactly where that sub-square
        // was: scale by the region's size, then shift to its corner, then
        // through the original matrix.
        const next = {
          a: du * m.a,
          b: du * m.b,
          c: dv * m.c,
          d: dv * m.d,
          e: left * m.a + bottom * m.c + m.e,
          f: left * m.b + bottom * m.d + m.f,
        }
        pdfium.FPDFPageObj_SetMatrix(
          imageObject, scratch.writeMatrix(next.a, next.b, next.c, next.d, next.e, next.f))
      }

      return { ok: true, width: outWidth, height: outHeight }
    } finally {
      pdfium.FPDFBitmap_Destroy(cropped)
    }
  } finally {
    pdfium.FPDFBitmap_Destroy(source)
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
