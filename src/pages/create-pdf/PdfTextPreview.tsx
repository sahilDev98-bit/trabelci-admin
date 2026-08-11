import { useEffect, useRef } from "react"

import type { PdfTextHotspot, PdfTextRenderPlan } from "@/features/pdfTemplates/types"
import { hotspotCanvasFont } from "./pdfFonts"

/** A background patch already decoded and ready to draw — see
 * PdfMasterCustomizer's loadCleanPatchForEditing. `rect` is the same PDF-point
 * rect the server redacted, which is padded very slightly wider than the
 * hotspot's own bbox (matching the export's own padding). */
export interface PdfTextPreviewBackgroundPatch {
  img: HTMLImageElement
  rect: [number, number, number, number]
}

interface PdfTextPreviewProps {
  hotspot: PdfTextHotspot
  /** The single render decision this preview draws — see
   * PdfTextRenderPlan. Not recomputed here; this component's only job is to
   * paint exactly what it's given. */
  plan: PdfTextRenderPlan
  sessionId: string | null
  availableFontIds: Set<string>
  /** Sampled flat-colour fallback, used ONLY when `backgroundPatch` is
   * unavailable (the clean-patch request failed, or hasn't resolved yet). */
  background: string
  /** The document's REAL background behind this hotspot, redacted server-side
   * — see fetchPdfMasterCleanPatch. Preferred over `background` whenever
   * present, since a sampled flat colour is only ever a rough guess and shows
   * as an obvious grey rectangle over a photo or gradient. */
  backgroundPatch?: PdfTextPreviewBackgroundPatch | null
}

/** How wide the preview canvas is drawn, in CSS pixels. The box is scaled to
 * this so a narrow caption and a full-width heading are both legible. */
const PREVIEW_WIDTH_PX = 520
/** Never magnify a box more than this — a tiny caption blown up 8× would
 * misrepresent how it actually looks on the page. */
const MAX_PREVIEW_SCALE = 3

/**
 * Renders the replacement text exactly as it will appear in the exported
 * PDF: the document's own typeface (or the shared fallback, per the plan),
 * its real size (after auto-fit), its real line spacing, wrapped at the
 * real box width, on the real background, in the right direction and
 * alignment — all of it read from `plan`, none of it recomputed here.
 *
 * This is the core of making text editing feel like the image flow, which
 * users already trust — you upload an image and immediately see the result.
 * Typing into a bare textarea with a character counter gave no such feedback,
 * so the only way to discover a bad result was to download the file.
 */
export function PdfTextPreview({ hotspot, plan, sessionId, availableFontIds, background, backgroundPatch }: PdfTextPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const boxWidthPts = hotspot.bbox[2] - hotspot.bbox[0]
    const boxHeightPts = hotspot.bbox[3] - hotspot.bbox[1]
    if (boxWidthPts <= 0) return

    const scale = Math.min(PREVIEW_WIDTH_PX / boxWidthPts, MAX_PREVIEW_SCALE)
    // Tall enough for whatever the text actually needs, so overflow is
    // visible as text spilling past the box outline rather than being
    // silently clipped away — seeing the overflow is the whole point.
    const contentHeightPts = Math.max(boxHeightPts, plan.heightPts)
    const padPts = 6
    const cssWidth = boxWidthPts * scale
    const cssHeight = (contentHeightPts + padPts * 2) * scale

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(cssWidth * dpr))
    canvas.height = Math.max(1, Math.round(cssHeight * dpr))
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (backgroundPatch) {
      // The patch's rect is in the same PDF-point space as hotspot.bbox, so
      // translating it into this canvas's local coordinates is the same
      // bbox-relative-plus-padPts math the flat-fill path below uses,
      // applied to an image instead of a solid colour.
      const [rx0, ry0, rx1, ry1] = backgroundPatch.rect
      const localX = (rx0 - hotspot.bbox[0]) * scale
      const localY = (padPts + (ry0 - hotspot.bbox[1])) * scale
      ctx.drawImage(backgroundPatch.img, localX, localY, (rx1 - rx0) * scale, (ry1 - ry0) * scale)
    } else {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, cssWidth, cssHeight)
    }

    // The original box outline, so it's obvious how much room there is and
    // whether the text is about to run past it.
    ctx.strokeStyle = "rgba(0,0,0,0.18)"
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, padPts * scale + 0.5, cssWidth - 1, boxHeightPts * scale)
    ctx.setLineDash([])

    if (plan.lines.length === 0) return

    const color = hotspot.color
    ctx.fillStyle = `rgb(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255})`
    ctx.font = hotspotCanvasFont(hotspot, sessionId, availableFontIds, plan.fontSize * scale, plan.useFallbackFont)
    ctx.direction = plan.direction
    ctx.textAlign = plan.align
    ctx.textBaseline = "alphabetic"

    // Anchor the first baseline the same way the export does: relative to the
    // top of the box, not its bottom, so a multi-line block grows downward
    // from where its first line really sits.
    const firstBaselinePts = hotspot.originY - hotspot.bbox[1]
    // The x anchor follows alignment, not direction directly: "left" hugs
    // the box's own left edge, "right" its right edge, "center" its middle
    // — ctx.textAlign then does the actual per-glyph positioning from there.
    const x = plan.align === "right" ? cssWidth : plan.align === "center" ? cssWidth / 2 : 0
    plan.lines.forEach((line, i) => {
      const yPts = padPts + firstBaselinePts + i * plan.lineHeight
      ctx.fillText(line, x, yPts * scale)
    })
  }, [hotspot, plan, sessionId, availableFontIds, background, backgroundPatch])

  return (
    <div className="overflow-auto rounded-lg border bg-muted/30 p-3">
      <canvas ref={canvasRef} className="block max-w-full" />
    </div>
  )
}
