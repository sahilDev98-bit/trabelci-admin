// Text measurement + line wrapping — the layer that decides WHERE lines
// break before anything is drawn.
//
// Measurement comes from the font file's own advance widths (via
// opentype.js), not from an estimate. That matters because every wrap
// decision is downstream of it: a measurement that is 5% off silently
// produces lines that overflow or break early, and the error is invisible
// until someone looks at the finished page. measure-vs-PDFium agreement is
// asserted in test-wrapping.ts rather than assumed here.
import { opentype, type OpentypeFont } from "./opentype"
import { isRtlText } from "./grouping"

export type TextAlign = "left" | "center" | "right"

export interface FontMetrics {
  font: OpentypeFont
  /** Advance width of a single space at a given size — handy for callers
   * reasoning about inter-word gaps. */
  spaceWidth: (fontSize: number) => number
}

export function loadFontMetrics(fontBytes: Uint8Array): FontMetrics {
  const ab = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer
  const font = opentype.parse(ab)
  return {
    font,
    spaceWidth: (fontSize: number) => font.getAdvanceWidth(" ", fontSize),
  }
}

/** Rendered advance width of `text` at `fontSize`, in PDF points. */
export function measureTextWidth(metrics: FontMetrics, text: string, fontSize: number): number {
  if (!text) return 0
  return metrics.font.getAdvanceWidth(text, fontSize)
}

/**
 * Greedy word wrap. Mirrors the behaviour production already settled on
 * (see pdf_editor.py's _wrap_text_to_width): breaks on spaces, honours
 * explicit newlines as hard breaks, and does NOT hyphenate or split a
 * single word that is wider than the line — that word is allowed to
 * overflow instead, because silently breaking a product code or SKU
 * mid-token is worse than a visibly long line.
 */
export function wrapText(metrics: FontMetrics, text: string, fontSize: number, maxWidth: number): string[] {
  const out: string[] = []
  if (maxWidth <= 0) return [text]

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ").filter((w, i, a) => w !== "" || i === 0 || i === a.length - 1)
    let current = ""
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (!current || measureTextWidth(metrics, candidate, fontSize) <= maxWidth) {
        current = candidate
      } else {
        out.push(current)
        current = word
      }
    }
    out.push(current)
  }
  return out
}

export interface LayoutOptions {
  /** Width the text must fit inside, PDF points. */
  maxWidth: number
  /** Baseline-to-baseline spacing as a MULTIPLE of font size. 1.2 is the
   * usual typographic default and matches production's fallback. */
  lineHeightRatio?: number
  /** When set, the block must also fit within this many points of height. */
  maxHeight?: number
  /**
   * Shrink the font (down to minFontScale) when the text does not fit.
   *
   * Applies to WIDTH as well as height, which matters more than it sounds:
   * wrapText deliberately never splits a word, so a single word wider than
   * the box has no wrap that can save it — without width-shrink it just
   * hangs over the edge. On REFIN's ~90pt columns and Carnaby's 92pt
   * heading that is the common case, not an edge case.
   */
  autoShrink?: boolean
  /** Floor for auto-shrink, as a fraction of the requested size. Matches
   * production's AUTOFIT_MIN_SCALE — below roughly this the text stops
   * matching the surrounding design and reads as a mistake. */
  minFontScale?: number
  /** Granularity of the shrink search, in points. */
  shrinkStepPts?: number
}

export interface LayoutResult {
  lines: string[]
  /** Final size after any auto-shrink. */
  fontSize: number
  /** Final baseline-to-baseline spacing, points. */
  lineHeight: number
  /** Height from the first baseline to the last, plus one line of descent
   * allowance — i.e. the vertical space the block occupies. */
  totalHeight: number
  /** Widest single line, points. */
  widestLine: number
  /** True when it still does not fit (too tall, or a single unbreakable
   * word is wider than maxWidth). Reported honestly rather than hidden. */
  overflows: boolean
  /** True when auto-shrink had to reduce the size. */
  shrunk: boolean
  direction: "ltr" | "rtl"
}

/**
 * Lay text out inside a width, optionally shrinking to fit a height.
 *
 * Steps down through sizes rather than binary-searching: wrapping is not
 * monotonic (a smaller size can pull a word up and change the line count
 * non-uniformly), so a bisection can settle on a size that is not actually
 * the largest fitting one.
 */
export function layoutText(
  metrics: FontMetrics,
  text: string,
  requestedSize: number,
  opts: LayoutOptions,
): LayoutResult {
  const ratio = opts.lineHeightRatio ?? 1.2
  const minScale = opts.minFontScale ?? 0.7
  const step = opts.shrinkStepPts ?? 0.25
  const direction = isRtlText(text) ? "rtl" : "ltr"

  const attempt = (size: number): LayoutResult => {
    const lines = wrapText(metrics, text, size, opts.maxWidth)
    const lineHeight = size * ratio
    // First baseline to last baseline, plus one line's worth of leading to
    // account for the last line's descent — the block's real footprint.
    const totalHeight = lines.length > 0 ? (lines.length - 1) * lineHeight + size : 0
    let widest = 0
    for (const l of lines) widest = Math.max(widest, measureTextWidth(metrics, l, size))
    // +0.5pt tolerance: sub-point differences are rounding, not overflow.
    const tooWide = widest > opts.maxWidth + 0.5
    const tooTall = opts.maxHeight !== undefined && totalHeight > opts.maxHeight + 0.5
    return {
      lines, fontSize: size, lineHeight, totalHeight, widestLine: widest,
      overflows: tooWide || tooTall, shrunk: size < requestedSize, direction,
    }
  }

  const atFull = attempt(requestedSize)
  if (!atFull.overflows || opts.autoShrink === false) return atFull

  const minSize = requestedSize * minScale
  for (let size = requestedSize - step; size >= minSize; size -= step) {
    const r = attempt(size)
    if (!r.overflows) return r
  }
  // Doesn't fit even at the floor — report honestly at the floor size,
  // which is still the closest achievable, rather than pretending.
  return attempt(minSize)
}

/** X position for one line's left edge, given the box and alignment.
 * Direction and alignment are separate concerns: direction decides reading
 * order, alignment decides which edge lines hug. RTL defaults to right
 * only because that is the safe default when nothing else is known. */
export function lineX(
  boxLeft: number, boxWidth: number, lineWidth: number, align: TextAlign,
): number {
  if (align === "right") return boxLeft + boxWidth - lineWidth
  if (align === "center") return boxLeft + (boxWidth - lineWidth) / 2
  return boxLeft
}

export function defaultAlignFor(direction: "ltr" | "rtl"): TextAlign {
  return direction === "rtl" ? "right" : "left"
}
