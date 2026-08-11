import type { PdfTextAlign, PdfTextRenderPlan } from "@/features/pdfTemplates/types"
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
 *
 * fitText is the ONE place layout, font-fallback and direction/alignment
 * are decided — see PdfTextRenderPlan for why that matters. Every caller
 * (the modal preview, the page canvas, the pending-edit record) reads the
 * same returned plan instead of re-deriving any of these questions itself.
 */

/** Smallest fraction of the original size auto-fit is allowed to shrink to.
 * Below roughly this the text stops matching the surrounding design and
 * starts looking like a mistake rather than a fit, so overflow is reported
 * honestly instead of being hidden behind unreadably small type. */
export const AUTOFIT_MIN_SCALE = 0.7
/** Granularity of the shrink search, in points. Fine enough to be visually
 * smooth, coarse enough to keep the search short. */
const AUTOFIT_STEP_PTS = 0.25

/** Same Hebrew block the backend checks (pdf_editor.py's HEBREW_CHARS /
 * _is_rtl) — kept identical so the frontend and the export never disagree
 * about which language a piece of text is in. */
const HEBREW_RANGE_START = 0x0590
const HEBREW_RANGE_END = 0x0600

/**
 * Direction of the text as CURRENTLY TYPED — not the hotspot's original PDF
 * direction, which describes text that may no longer be there at all.
 *
 * Replacing English with Hebrew (or the reverse) must flip direction
 * immediately: a textarea, preview or page canvas still keyed off the
 * original hotspot's stored `rtl` would keep shaping newly-typed Hebrew as
 * left-to-right Latin, or vice versa.
 */
export function detectTextDirection(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0
    if (codePoint >= HEBREW_RANGE_START && codePoint < HEBREW_RANGE_END) return "rtl"
  }
  return "ltr"
}

/** Resolves to the hotspot's own alignment when the backend has ever sent
 * one; otherwise the same safe default the rest of the app already used
 * (right for RTL, left for LTR) — never a guess at the PDF's TRUE original
 * alignment, which the backend doesn't expose yet. */
function resolveTextAlign(direction: "ltr" | "rtl", explicitAlign?: PdfTextAlign): PdfTextAlign {
  if (explicitAlign) return explicitAlign
  return direction === "rtl" ? "right" : "left"
}

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
  /** The hotspot's own alignment, if the backend has ever supplied one.
   * Absent for every hotspot today — see PdfTextHotspot.align. */
  align?: PdfTextAlign
}

/** @deprecated Use {@link PdfTextRenderPlan} — kept as an alias so any
 * straggling import keeps compiling. fitText now returns the full plan. */
export type FitResult = PdfTextRenderPlan

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

/** Real visible ascent/descent of one line, via TextMetrics — not a
 * generic multiple of font size. `actualBoundingBoxAscent/Descent` report
 * the ink's own extent above/below the baseline, which for most text is
 * noticeably less than the ~1.2x-of-size baseline-to-baseline leading a
 * paragraph uses for SPACING between lines. Falls back to a reasonable
 * estimate only when the browser reports zero for genuinely non-empty text
 * (an unusual glyph, or a very old engine without these extended metrics)
 * — never for empty/whitespace, which legitimately has no ink at all. */
function measureLineInk(ctx: CanvasRenderingContext2D, line: string, fontSizePts: number): { ascent: number; descent: number } {
  if (!line.trim()) return { ascent: 0, descent: 0 }
  const m = ctx.measureText(line)
  const ascent = m.actualBoundingBoxAscent
  const descent = m.actualBoundingBoxDescent
  if (!ascent && !descent) {
    // Roughly what typical Latin/Hebrew text occupies relative to its
    // font size — a safe stand-in, not a real measurement.
    return { ascent: fontSizePts * 0.72, descent: fontSizePts * 0.18 }
  }
  return { ascent: ascent || fontSizePts * 0.72, descent: descent || 0 }
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
 *
 * `useFallbackFont` is an EXPLICIT decision the caller makes (via
 * pdfFonts.ts's fontCanDraw, checked against THIS text) and passes in —
 * fitText does not re-derive it and does not accept a nulled-out sessionId
 * as a side-channel for "use the fallback" any more, so there is exactly
 * one place per edit that decides whether the fallback is needed.
 */
export function fitText(
  text: string,
  input: FitInput,
  sessionId: string | null,
  availableFontIds: Set<string>,
  autoFit: boolean,
  useFallbackFont: boolean,
): PdfTextRenderPlan {
  const ctx = measureCtx()
  const trimmed = text.trim()

  // Direction/alignment depend only on the text itself, never on font size —
  // resolved once, up front, and reused by every layout attempt below.
  const direction = detectTextDirection(text)
  const align = resolveTextAlign(direction, input.align)

  if (!ctx || !trimmed) {
    return {
      text,
      lines: trimmed ? [trimmed] : [],
      fontSize: input.size,
      lineHeight: input.lineHeightPts,
      heightPts: 0,
      overflows: false,
      shrunk: false,
      useFallbackFont,
      direction,
      align,
    }
  }

  const minSize = input.size * AUTOFIT_MIN_SCALE
  const layoutAt = (size: number) => {
    ctx.font = hotspotCanvasFont(input, sessionId, availableFontIds, size, useFallbackFont)
    const lines = wrapToWidth(ctx, trimmed, input.boxWidthPts)

    // Line spacing (the gap BETWEEN baselines) scales with the type, so
    // shrinking keeps the block's proportions instead of leaving gappy
    // lines at a smaller size — this is leading, not ink height.
    const lineHeight = input.lineHeightPts * (size / input.size)

    // The actual visible ink envelope: the first line's own ascent, then
    // (N-1) baseline-to-baseline gaps down to the last line's baseline,
    // then the last line's own descent. NOT lines.length * lineHeight —
    // that treats leading (a spacing convention) as if it were the height
    // of the text itself, which overstates a single line's real height
    // enough to trigger auto-shrink on completely ordinary text that
    // already fit its box.
    const first = measureLineInk(ctx, lines[0] ?? "", size)
    const last = lines.length > 1 ? measureLineInk(ctx, lines[lines.length - 1] ?? "", size) : first
    const heightPts = lines.length <= 1
      ? first.ascent + first.descent
      : first.ascent + (lines.length - 1) * lineHeight + last.descent

    // +0.5pt tolerance — sub-point differences are rounding, not a real overflow.
    const fits = heightPts <= input.boxHeightPts + 0.5 && widestLine(ctx, lines) <= input.boxWidthPts + 0.5
    return { lines, lineHeight, heightPts, fits }
  }

  const atFull = layoutAt(input.size)
  if (atFull.fits || !autoFit) {
    return {
      text,
      lines: atFull.lines,
      fontSize: input.size,
      lineHeight: atFull.lineHeight,
      heightPts: atFull.heightPts,
      overflows: !atFull.fits,
      shrunk: false,
      useFallbackFont,
      direction,
      align,
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
        text,
        lines: attempt.lines,
        fontSize: size,
        lineHeight: attempt.lineHeight,
        heightPts: attempt.heightPts,
        overflows: false,
        shrunk: true,
        useFallbackFont,
        direction,
        align,
      }
    }
  }

  // Doesn't fit even at the floor — report honestly at the floor size, which
  // is still the closest we can get, rather than pretending at full size.
  const atMin = layoutAt(minSize)
  return {
    text,
    lines: atMin.lines,
    fontSize: minSize,
    lineHeight: atMin.lineHeight,
    heightPts: atMin.heightPts,
    overflows: true,
    shrunk: true,
    useFallbackFont,
    direction,
    align,
  }
}
