// Overlays: brand-new content the user ADDS on top of a page, as opposed
// to edits, which replace something the PDF already contained.
//
// The difference that matters technically is rotation. A hotspot edit
// inherits the original object's matrix and is almost always upright; an
// overlay can be dropped at any angle, so the rotation has to be built
// into the matrix by hand. PDF's matrix is [a b c d e f], where (a,b) is
// where the x-axis lands and (c,d) is where the y-axis lands — so a
// rotation by θ combined with a scale s is
//     a =  s·cosθ   b = s·sinθ
//     c = -s·sinθ   d = s·cosθ
// and (e,f) is the position. Everything below is that one idea applied to
// text and to images.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { Scratch } from "./core"
import type { DocumentFonts } from "./text"
import {
  layoutText, measureTextWidth, lineX, defaultAlignFor,
  type FontMetrics, type TextAlign,
} from "./layout"

export interface TextOverlaySpec {
  text: string
  /** Bottom-left corner of the overlay box, PDF points. */
  x: number
  y: number
  /** Box width — used for wrapping and alignment. */
  width: number
  fontSize: number
  /** 0-255 each. */
  color: { r: number; g: number; b: number; a?: number }
  /** Degrees, anticlockwise, about the box's bottom-left corner. */
  rotation?: number
  align?: TextAlign
  lineHeightRatio?: number
}

export interface ImageOverlaySpec {
  /** Bottom-left corner, PDF points. */
  x: number
  y: number
  width: number
  height: number
  /** Degrees, anticlockwise, about the bottom-left corner. */
  rotation?: number
}

export interface OverlayResult {
  ok: boolean
  handles?: number[]
  error?: string
}

function rotationParts(degrees: number): { cos: number; sin: number } {
  const rad = (degrees * Math.PI) / 180
  return { cos: Math.cos(rad), sin: Math.sin(rad) }
}

/** Writes a full 6-float FS_MATRIX and returns the pointer. */
function writeMatrix(
  pdfium: WrappedPdfiumModule, scratch: Scratch,
  a: number, b: number, c: number, d: number, e: number, f: number,
): number {
  const ptr = scratch.malloc(24)
  const p = pdfium.pdfium
  p.setValue(ptr + 0, a, "float")
  p.setValue(ptr + 4, b, "float")
  p.setValue(ptr + 8, c, "float")
  p.setValue(ptr + 12, d, "float")
  p.setValue(ptr + 16, e, "float")
  p.setValue(ptr + 20, f, "float")
  return ptr
}

/**
 * Add new text on top of a page. Wraps to `width` and supports rotation at
 * any angle, so it covers both a straight caption and a diagonal "SAMPLE"
 * stamp with the same code path.
 */
export function addTextOverlay(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  spec: TextOverlaySpec,
  fontBytes: Uint8Array,
  metrics: FontMetrics,
  scratch: Scratch,
  fonts?: DocumentFonts,
): OverlayResult {
  const font = fonts
    ? fonts.handleFor(fontBytes, scratch)
    : pdfium.FPDFText_LoadFont(document, scratch.writeBuffer(fontBytes), fontBytes.length, 2, true)
  if (!font) return { ok: false, error: "FPDFText_LoadFont returned 0" }

  const layout = layoutText(metrics, spec.text, spec.fontSize, {
    maxWidth: spec.width,
    lineHeightRatio: spec.lineHeightRatio,
  })
  const align = spec.align ?? defaultAlignFor(layout.direction)
  const { cos, sin } = rotationParts(spec.rotation ?? 0)
  const handles: number[] = []

  for (let i = 0; i < layout.lines.length; i++) {
    const lineText = layout.lines[i]
    const obj = pdfium.FPDFPageObj_CreateTextObj(document, font, layout.fontSize)
    if (!obj) return { ok: false, error: `CreateTextObj failed on line ${i}` }
    if (!pdfium.FPDFText_SetText(obj, scratch.writeUtf16(lineText))) {
      return { ok: false, error: `SetText failed on line ${i}` }
    }

    // Position within the UNROTATED box first...
    const lineWidth = measureTextWidth(metrics, lineText, layout.fontSize)
    const localX = lineX(0, spec.width, lineWidth, align)
    const localY = -i * layout.lineHeight

    // ...then rotate that offset about the box's origin and translate.
    // Rotating the offset (rather than only the glyphs) is what keeps a
    // multi-line rotated block reading as one straight block at an angle,
    // instead of each line pivoting around its own start point.
    const e = spec.x + localX * cos - localY * sin
    const f = spec.y + localX * sin + localY * cos
    const m = writeMatrix(pdfium, scratch, cos, sin, -sin, cos, e, f)
    if (!pdfium.FPDFPageObj_SetMatrix(obj, m)) return { ok: false, error: `SetMatrix failed on line ${i}` }

    pdfium.FPDFPageObj_SetFillColor(obj, spec.color.r, spec.color.g, spec.color.b, spec.color.a ?? 255)
    pdfium.FPDFPage_InsertObject(page, obj)
    handles.push(obj)
  }

  return { ok: true, handles }
}

/**
 * Add a new image on top of a page.
 *
 * A PDF image object always draws the UNIT SQUARE and relies entirely on
 * its matrix for size and placement — so the matrix here carries the
 * width/height as its scale, not just the position.
 */
export function addImageOverlay(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  spec: ImageOverlaySpec,
  imageBytes: Uint8Array,
  kind: "png" | "jpeg",
  scratch: Scratch,
): OverlayResult {
  const obj = pdfium.FPDFPageObj_NewImageObj(document)
  if (!obj) return { ok: false, error: "FPDFPageObj_NewImageObj returned 0" }

  // Insert BEFORE setting pixels: the Set*/SetBitmap calls take the pages
  // the object belongs to so PDFium can invalidate their cached render,
  // which only works once the object is actually on a page.
  pdfium.FPDFPage_InsertObject(page, obj)

  const pagesArray = scratch.malloc(4)
  pdfium.pdfium.setValue(pagesArray, page, "i32")
  const dataPtr = scratch.writeBuffer(imageBytes)
  const setFn = kind === "png" ? pdfium.EPDFImageObj_SetPng : pdfium.EPDFImageObj_SetJpeg
  if (!setFn(pagesArray, 1, obj, dataPtr, imageBytes.length)) {
    return { ok: false, error: `EPDFImageObj_Set${kind === "png" ? "Png" : "Jpeg"} returned false` }
  }

  const { cos, sin } = rotationParts(spec.rotation ?? 0)
  if (!pdfium.FPDFImageObj_SetMatrix(
    obj,
    spec.width * cos, spec.width * sin,
    -spec.height * sin, spec.height * cos,
    spec.x, spec.y,
  )) {
    return { ok: false, error: "FPDFImageObj_SetMatrix failed" }
  }

  return { ok: true, handles: [obj] }
}
