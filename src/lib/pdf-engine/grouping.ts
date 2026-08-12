// Groups PDFium's raw, fine-grained text objects into whole visual LINES
// before editing — the missing piece the full-document stress test proved
// necessary (a single word like "Mold" can be stored as 2+ separate
// objects, and a wrapped paragraph as dozens). Mirrors the same idea
// already proven in production's pdf_editor.py (_extract_hotspots): group
// by same baseline + same font + same size, using position PDFium reports
// directly rather than approximating it.
import type { TextObjectInfo } from "./text"

/** 'ABCDEF+Gotham-Book' -> 'gothambook' — same normalization production
 * uses (_subset_base_name + _normalize_font_key in pdf_editor.py), so two
 * different subset copies of the same face are still recognized as one. */
export function normalizeFontName(name: string): string {
  const stripped = name.length > 7 && name[6] === "+" && /^[A-Z]{6}$/.test(name.slice(0, 6)) ? name.slice(7) : name
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Same Hebrew block production checks (pdf_editor.py's HEBREW_CHARS) —
 * kept identical so the two systems never disagree about what is RTL. */
export function isRtlText(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x0590 && cp < 0x0600) return true
  }
  return false
}

/** A text object's REAL on-page size in points.
 *
 * PDF splits this across two places: the text object's own font size and
 * the scale baked into its matrix. Both customer catalogs happen to store
 * fontSize=1 with the real size in the matrix (Carnaby's heading: size 1,
 * matrix.a 92), so reading matrix.a alone looked correct — until a
 * document built the other way (fontSize=20, matrix scale 1) made every
 * gap ratio 20x too large and stopped all merging. Multiplying the two
 * handles both conventions, and any mixture of them.
 *
 * hypot(a, b) rather than plain `a` so a rotated text object still reports
 * its true scale instead of a foreshortened one. */
export function effectiveFontSize(obj: TextObjectInfo): number {
  const scale = Math.hypot(obj.matrix.a, obj.matrix.b)
  const size = (obj.fontSize || 1) * (scale || 1)
  return size || 1
}

export interface LineGroup {
  objects: TextObjectInfo[]
  /** The reconstructed line text, pieces joined with a space wherever a
   * real gap existed between them (touching/kerned pieces get none). */
  text: string
  /** Basis for the rebuilt object: the leftmost piece's own geometry — the
   * correct anchor for LTR text, matching how the page actually draws it. */
  anchor: TextObjectInfo
}

/** Largest horizontal gap (as a multiple of font size) still treated as
 * "same line". Measured across every page of both customer catalogs, the
 * two populations separate cleanly:
 *   - genuine same-line continuations: 0.01x – 0.99x
 *     (e.g. "120×120" + "/48\"×48\" R" at 0.05x; "m" + "x" at 0.64x)
 *   - genuinely separate items: 1.25x and above
 *     (REFIN p12 table columns 1.35x–1.76x; REFIN p11's six-column legal
 *     text 1.83x–1.97x; swatch captions ~20x; TOC label+page-number ~30x)
 *
 * 1.1x sits in the empty band between those two populations. An earlier
 * 2.0x let the p11 column gaps through and merged Dutch text with the
 * Spanish column beside it ("onderworpen ter garantie expuesto a severos")
 * — a reminder that "obviously far apart" for a 7pt font is only ~13pt.
 * Also splits label-and-page-number TOC rows, matching what production's
 * pdf_editor.py already does with the same "Concept ......... 2" case. */
const MAX_SAME_LINE_GAP = 1.1
/** Small negative gaps are normal (kerning, or bounds rounding); a large
 * one means the next piece starts well left of where the last ended, i.e. a
 * new line, not a continuation. */
const MIN_SAME_LINE_GAP = -0.5

/** Groups objects already on ONE page into visual lines. Sorts top-to-
 * bottom, then left-to-right (PDF space: y grows upward), and merges
 * consecutive objects into one line when they sit on the same baseline, at
 * the same size, and CLOSE ENOUGH HORIZONTALLY to be continuous text.
 *
 * Font identity is deliberately NOT required here. That check belongs to
 * VERTICAL grouping (two stacked lines in different weights are two design
 * elements — production's _extract_hotspots splits on exactly that), but
 * applying it horizontally is wrong: real catalog lines mix weights inside
 * one line, e.g. REFIN sets "120×120" in Medium immediately followed by
 * "/48\"×48\" R" in Light, 0.32pt apart. Requiring the same font there
 * refused the merge and rewrote each fragment separately, which is what
 * produced jammed output like "PremiumLine". Same baseline + same size +
 * touching is already a specific enough signal on its own. */
export function groupIntoLines(objs: TextObjectInfo[]): LineGroup[] {
  const sorted = [...objs].sort((a, b) => {
    const dy = b.matrix.f - a.matrix.f
    if (Math.abs(dy) > 2) return dy
    return a.matrix.e - b.matrix.e
  })

  const groups: TextObjectInfo[][] = []
  for (const obj of sorted) {
    const last = groups[groups.length - 1]
    if (last) {
      const prev = last[last.length - 1]
      const size = effectiveFontSize(prev)
      const objSize = effectiveFontSize(obj)
      const sameBaseline = Math.abs(obj.matrix.f - prev.matrix.f) < Math.max(2, size * 0.1)
      // Superscripts/subscripts are deliberately excluded here: REFIN sets
      // "N/mm" at 5.25pt and its "²" at 3.06pt, and flattening the two into
      // one object at one size would silently turn N/mm² into N/mm2.
      const sameSize = Math.abs(objSize - size) / size < 0.15
      // Measured edge-to-edge (previous piece's right edge to this piece's
      // left edge), not origin-to-origin — origins ignore how wide the
      // previous piece actually was.
      const gap = (obj.bounds?.left ?? obj.matrix.e) - (prev.bounds?.right ?? prev.matrix.e)
      const gapRatio = gap / size
      const closeEnough = gapRatio >= MIN_SAME_LINE_GAP && gapRatio <= MAX_SAME_LINE_GAP
      if (sameBaseline && sameSize && closeEnough) {
        last.push(obj)
        continue
      }
    }
    groups.push([obj])
  }

  return groups.map((objects) => {
    // WHICH pieces belong together is a geometry question, answered
    // left-to-right above. What ORDER they read in is a language question,
    // and for Hebrew it is the opposite: a real RTL line stores its first
    // logical word at the RIGHT edge. Joining those left-to-right returned
    // "םלוע םולש" for a line that reads "םולש םלוע" — the words in
    // reverse. Reversing the join (and anchoring at the rightmost piece,
    // where an RTL line actually begins) is what puts them back in
    // reading order.
    const rtl = objects.some((o) => isRtlText(o.text))
    const ordered = rtl ? [...objects].reverse() : objects

    let text = ""
    for (let i = 0; i < ordered.length; i++) {
      const o = ordered[i]
      if (i === 0) {
        text = o.text
        continue
      }
      const prev = ordered[i - 1]
      // Gap is still measured in page space (left edge to right edge of
      // the two pieces as they sit), regardless of reading direction.
      const [leftPiece, rightPiece] = rtl ? [o, prev] : [prev, o]
      const gap = (rightPiece.bounds?.left ?? rightPiece.matrix.e) - (leftPiece.bounds?.right ?? leftPiece.matrix.e)
      const size = effectiveFontSize(prev)
      text += (gap > size * 0.15 ? " " : "") + o.text
    }
    return { objects, text, anchor: ordered[0] }
  })
}
