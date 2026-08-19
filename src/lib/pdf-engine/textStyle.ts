// Styling text that is ALREADY in the document — bold, italic, colour,
// size, alignment.
//
// Deliberately mutates the existing text objects rather than rebuilding
// them. Rebuilding is what an edit does, and it has to: when the WORDS
// change, the document's own font usually cannot draw the new characters
// (it carries only a subset of glyphs), so the line is redrawn in a bundled
// face. Styling changes no characters, so nothing forces that trade — and
// mutating in place keeps the catalogue's real typeface, which is the whole
// look of the page.
//
// Bold and italic are therefore SYNTHESISED:
//   - bold  — the glyphs are stroked as well as filled, thickening them.
//   - italic — the text matrix is sheared, slanting them.
// The alternative is swapping in a different family that has real bold and
// italic cuts, which changes the typeface of the thing you were only trying
// to embolden. These are lookalikes, and on a headline they read correctly;
// a typographer comparing them side by side would see the difference.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { Scratch } from "./core"
import type { TextObjectInfo } from "./text"

/** PDFium text render modes. */
const RENDER_FILL = 0
const RENDER_FILL_STROKE = 2

/** Shear applied for synthetic italic — tan(12°). Enough to read as italic
 * without the letters looking like they are falling over. */
const ITALIC_SHEAR = 0.2126

/** Stroke width for synthetic bold, as a fraction of the type size. Chosen
 * so it thickens the stem noticeably without filling in counters (the holes
 * in 'a', 'e', 'o') at small sizes. */
const BOLD_STROKE_RATIO = 0.028

/** Above this shear a line is already slanted, so it reads as italic. */
const ITALIC_DETECT = ITALIC_SHEAR / 2

export interface TextStyle {
  bold: boolean
  italic: boolean
  color: { r: number; g: number; b: number }
}

export type TextAlignment = "left" | "center" | "right"

/** How slanted a matrix is, independent of its size or rotation. */
function shearOf(m: TextObjectInfo["matrix"]): number {
  const lenSq = m.a * m.a + m.b * m.b
  if (lenSq <= 1e-9) return 0
  return (m.c * m.a + m.d * m.b) / lenSq
}

/**
 * The style a line is currently drawn in, so the toolbar can show the right
 * buttons as pressed rather than guessing.
 */
export function readTextStyle(
  pdfium: WrappedPdfiumModule, anchor: TextObjectInfo,
): TextStyle {
  const mode = pdfium.FPDFTextObj_GetTextRenderMode(anchor.handle)
  return {
    bold: mode === RENDER_FILL_STROKE,
    italic: shearOf(anchor.matrix) > ITALIC_DETECT,
    color: { r: anchor.fill.r, g: anchor.fill.g, b: anchor.fill.b },
  }
}

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
 * Apply a style to every piece of a grouped line.
 *
 * Every piece, not just the anchor: a line is often several text objects
 * (see grouping.ts), and styling only the first would embolden half a
 * heading.
 */
export function applyTextStyle(
  pdfium: WrappedPdfiumModule,
  page: number,
  group: TextObjectInfo[],
  style: TextStyle,
  scratch: Scratch,
): { ok: boolean; error?: string } {
  for (const piece of group) {
    const { r, g, b } = style.color
    const alpha = piece.fill.a
    if (!pdfium.FPDFPageObj_SetFillColor(piece.handle, r, g, b, alpha)) {
      return { ok: false, error: `could not set the colour of "${piece.text}"` }
    }

    // Bold: fill AND stroke the glyphs, in the same colour, so the stems
    // thicken. Stroke colour must follow the fill or a bold red heading
    // would come back outlined in black.
    if (style.bold) {
      const size = Math.max(1, piece.fontSize * Math.hypot(piece.matrix.a, piece.matrix.b))
      pdfium.FPDFPageObj_SetStrokeColor(piece.handle, r, g, b, alpha)
      pdfium.FPDFPageObj_SetStrokeWidth(piece.handle, size * BOLD_STROKE_RATIO)
      pdfium.FPDFTextObj_SetTextRenderMode(piece.handle, RENDER_FILL_STROKE)
    } else {
      pdfium.FPDFTextObj_SetTextRenderMode(piece.handle, RENDER_FILL)
    }

    // Italic: shear the matrix. Set ABSOLUTELY rather than nudged, so
    // toggling it twice returns to exactly where it started instead of
    // drifting further over with every press.
    const m = piece.matrix
    const current = shearOf(m)
    const target = style.italic ? ITALIC_SHEAR : 0
    const delta = target - current
    if (Math.abs(delta) > 1e-6) {
      const ptr = writeMatrix(
        pdfium, scratch,
        m.a, m.b,
        m.c + m.a * delta,
        m.d + m.b * delta,
        m.e, m.f,
      )
      if (!pdfium.FPDFPageObj_SetMatrix(piece.handle, ptr)) {
        return { ok: false, error: `could not slant "${piece.text}"` }
      }
    }
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/**
 * Scale a line's type size in place, about its own anchor.
 *
 * Multiplied rather than set to an absolute size: the pieces of a line can
 * legitimately differ in size (a superscript, a small-caps run), and forcing
 * them all to one number would flatten that. Scaling preserves the
 * relationship between them.
 */
export function scaleTextSize(
  pdfium: WrappedPdfiumModule,
  page: number,
  group: TextObjectInfo[],
  anchor: TextObjectInfo,
  factor: number,
  scratch: Scratch,
): { ok: boolean; error?: string } {
  if (!(factor > 0)) return { ok: false, error: "scale must be positive" }

  // Grown about the line's VISIBLE left edge and its baseline, not about the
  // text's origin. The origin sits a little to the left of the first glyph
  // (the side bearing), and that gap scales too — so growing about it slid
  // the line's visible edge sideways, which reads as the text wandering
  // rather than getting bigger. Anchoring on the ink keeps it still.
  const bounds = group.map((o) => o.bounds).filter((b): b is NonNullable<typeof b> => b !== null)
  const originX = bounds.length > 0
    ? Math.min(...bounds.map((b) => b.left))
    : anchor.matrix.e
  const originY = anchor.matrix.f

  for (const piece of group) {
    const m = piece.matrix
    const ptr = writeMatrix(
      pdfium, scratch,
      m.a * factor, m.b * factor,
      m.c * factor, m.d * factor,
      // Grown about the anchor, so a line stays where it was instead of
      // sliding away from its own start as it gets bigger.
      originX + (m.e - originX) * factor,
      originY + (m.f - originY) * factor,
    )
    if (!pdfium.FPDFPageObj_SetMatrix(piece.handle, ptr)) {
      return { ok: false, error: `could not resize "${piece.text}"` }
    }
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/**
 * Move a whole line to the left, centre or right of the page.
 *
 * Alignment of EXISTING text can only mean where the line sits, since a line
 * already in a document has no box to be aligned inside — that only exists
 * while text is being wrapped.
 */
export function alignTextGroup(
  pdfium: WrappedPdfiumModule,
  page: number,
  group: TextObjectInfo[],
  alignment: TextAlignment,
  marginPts: number,
  scratch: Scratch,
): { ok: boolean; error?: string } {
  const bounds = group.map((o) => o.bounds).filter((b): b is NonNullable<typeof b> => b !== null)
  if (bounds.length === 0) return { ok: false, error: "the line has no bounds to align" }

  const left = Math.min(...bounds.map((b) => b.left))
  const right = Math.max(...bounds.map((b) => b.right))
  const pageWidth = pdfium.FPDF_GetPageWidthF(page)

  const targetLeft = alignment === "left"
    ? marginPts
    : alignment === "right"
      ? pageWidth - marginPts - (right - left)
      : (pageWidth - (right - left)) / 2
  const dx = targetLeft - left
  if (Math.abs(dx) < 0.01) return { ok: true }

  for (const piece of group) {
    const m = piece.matrix
    const ptr = writeMatrix(pdfium, scratch, m.a, m.b, m.c, m.d, m.e + dx, m.f)
    if (!pdfium.FPDFPageObj_SetMatrix(piece.handle, ptr)) {
      return { ok: false, error: `could not move "${piece.text}"` }
    }
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}
