import { hotspotCanvasFont } from "./pdfFonts"

/**
 * Text layout for a PDF text hotspot: wrapping, fitting, and auto-shrink.
 *
 * Everything here works in PDF POINTS treated as pixels. Canvas word-wrap
 * only depends on the RATIO between glyph widths and the available width,
 * and that ratio is identical whether you measure at the page's on-screen
 * scale or directly in point units — so one measurement serves both the
 * live preview and the point-based numbers sent to the server, with no need
 * to know the current zoom.
 */

/** Smallest fraction of the original size auto-fit is allowed to shrink to.
 * Below roughly this the text stops matching the surrounding design and
 * starts looking like a mistake rather than a fit, so overflow is reported
 * honestly instead of being hidden behind unreadably small type. */
export const AUTOFIT_MIN_SCALE = 0.7
/** Granularity of the shrink search, in points. Fine enough to be visually
 * smooth, coarse enough to keep the search short. */
const AUTOFIT_STEP_PTS = 0.25

export interface FitInput {
  fontId: string
  bold: boolean
  italic: boolean
  size: number
  /** Width of the box, PDF points. */
  boxWidthPts: number
  /** Height of the original box, PDF points — what the result must fit in. */
  boxHeightPts: number
  /** Baseline-to-baseline spacing at the ORIGINAL size, PDF points. Scales
   * proportionally when auto-fit shrinks the type, so shrinking stays
   * visually consistent instead of leaving the lines oddly far apart. */
  lineHeightPts: number
}

export interface FitResult {
  /** The wrapped lines, in logical (typed) order — RTL reordering happens at
   * draw time, per line, never before wrapping. */
  lines: string[]
  /** Final font size in points — below `size` when auto-fit shrank it. */
  fontSize: number
  /** Final baseline-to-baseline spacing, scaled with fontSize. */
  lineHeight: number
  /** Total height the lines occupy, PDF points. */
  heightPts: number
  /** True when the text still doesn't fit even at the smallest allowed size. */
  overflows: boolean
  /** True when auto-fit had to reduce the size to make it fit. */
  shrunk: boolean
}

let _ctx: CanvasRenderingContext2D | null | undefined

/** Shared offscreen measuring context — measurements are synchronous and
 * never concurrent, so one instance is enough. */
function measureCtx(): CanvasRenderingContext2D | null {
  if (_ctx === undefined) {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null
    _ctx = canvas?.getContext("2d") ?? null
  }
  return _ctx
}

/**
 * Greedy word-wrap. Mirrors _wrap_text_to_width in pdf_editor.py: wrapping
 * decisions are made on logical (typed) order, and the caller's own newlines
 * are kept as forced breaks.
 *
 * A single word wider than the box is NOT broken mid-word — it's left to
 * overflow its line, which is exactly what the server does. Silently
 * hyphenating would make preview and export disagree again.
 */
export function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ")
    let current = words[0] ?? ""
    for (let i = 1; i < words.length; i++) {
      const word = words[i]
      const candidate = current ? `${current} ${word}` : word
      if (!current || ctx.measureText(candidate).width <= maxWidth) {
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}

/** Widest line in `lines`, points. Used to catch the single-long-word case
 * that wrapping alone can't resolve. */
function widestLine(ctx: CanvasRenderingContext2D, lines: string[]): number {
  let widest = 0
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width)
  return widest
}

/**
 * Lay `text` out inside the hotspot's box, shrinking the type if needed (and
 * if `autoFit`) until it fits — the same behaviour a real design tool offers,
 * rather than letting text silently spill over neighbouring content.
 *
 * Fit means BOTH dimensions: total wrapped height within the box, and every
 * individual line within its width. Height alone isn't enough — one
 * unbreakable word wider than the box would otherwise report a clean fit
 * while visibly hanging out the side.
 */
export function fitText(
  text: string,
  input: FitInput,
  sessionId: string | null,
  availableFontIds: Set<string>,
  autoFit: boolean,
): FitResult {
  const ctx = measureCtx()
  const trimmed = text.trim()

  if (!ctx || !trimmed) {
    return {
      lines: trimmed ? [trimmed] : [],
      fontSize: input.size,
      lineHeight: input.lineHeightPts,
      heightPts: 0,
      overflows: false,
      shrunk: false,
    }
  }

  const minSize = input.size * AUTOFIT_MIN_SCALE
  const layoutAt = (size: number) => {
    ctx.font = hotspotCanvasFont(input, sessionId, availableFontIds, size)
    const lines = wrapToWidth(ctx, trimmed, input.boxWidthPts)
    // Line spacing scales with the type, so shrinking keeps the block's
    // proportions instead of leaving gappy lines at a smaller size.
    const lineHeight = input.lineHeightPts * (size / input.size)
    const heightPts = Math.max(lines.length, 1) * lineHeight
    // +0.5pt tolerance on height, matching the overflow check this replaces —
    // sub-point differences are rounding, not a real overflow.
    const fits = heightPts <= input.boxHeightPts + 0.5 && widestLine(ctx, lines) <= input.boxWidthPts + 0.5
    return { lines, lineHeight, heightPts, fits }
  }

  const atFull = layoutAt(input.size)
  if (atFull.fits || !autoFit) {
    return {
      lines: atFull.lines,
      fontSize: input.size,
      lineHeight: atFull.lineHeight,
      heightPts: atFull.heightPts,
      overflows: !atFull.fits,
      shrunk: false,
    }
  }

  // Step down rather than binary-search: wrapping is not monotonic in a way
  // a bisection can rely on (a smaller size can pull a word up and change the
  // line count non-uniformly), and the range here is small enough that a
  // linear scan is both exact and cheap.
  for (let size = input.size - AUTOFIT_STEP_PTS; size >= minSize; size -= AUTOFIT_STEP_PTS) {
    const attempt = layoutAt(size)
    if (attempt.fits) {
      return {
        lines: attempt.lines,
        fontSize: size,
        lineHeight: attempt.lineHeight,
        heightPts: attempt.heightPts,
        overflows: false,
        shrunk: true,
      }
    }
  }

  // Doesn't fit even at the floor — report honestly at the floor size, which
  // is still the closest we can get, rather than pretending at full size.
  const atMin = layoutAt(minSize)
  return {
    lines: atMin.lines,
    fontSize: minSize,
    lineHeight: atMin.lineHeight,
    heightPts: atMin.heightPts,
    overflows: true,
    shrunk: true,
  }
}
