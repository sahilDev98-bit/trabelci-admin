import type { WrappedPdfiumModule } from "./core"

/**
 * Turning and mirroring a GROUP of page objects as one.
 *
 * Lives on its own because it is not about any particular kind of content.
 * It began in vector.ts, serving artwork, and stayed there when text needed
 * the same thing — which was misleading: a line of text is a group of objects
 * exactly as a piece of artwork is, and both want one shared transform about
 * one shared centre.
 *
 * One transform for the whole group, not one per object, is the point. Turning
 * each object about its own centre would scatter the pieces of a logo — or the
 * words of a line — instead of turning the thing they make up.
 */
export function transformObjectGroup(
  pdfium: WrappedPdfiumModule,
  page: number,
  handles: number[],
  bbox: { left: number; bottom: number; right: number; top: number },
  op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
): { ok: boolean; error?: string } {
  if (handles.length === 0) return { ok: false, error: "there is nothing here to turn" }
  const cx = (bbox.left + bbox.right) / 2
  const cy = (bbox.bottom + bbox.top) / 2
  const m = op === "rotate-left" ? { a: 0, b: 1, c: -1, d: 0 }
    : op === "rotate-right" ? { a: 0, b: -1, c: 1, d: 0 }
      : op === "flip-horizontal" ? { a: -1, b: 0, c: 0, d: 1 }
        : { a: 1, b: 0, c: 0, d: -1 }
  // Rotating about the group's centre rather than the page's origin: the
  // translation here is what brings the centre back to where it started.
  const e = cx - (m.a * cx + m.c * cy)
  const f = cy - (m.b * cx + m.d * cy)
  for (const handle of handles) {
    // The clip travels with the object, or a shape-masked photo turns out
    // from behind its own mask.
    pdfium.FPDFPageObj_TransformClipPath(handle, m.a, m.b, m.c, m.d, e, f)
    pdfium.FPDFPageObj_Transform(handle, m.a, m.b, m.c, m.d, e, f)
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}
