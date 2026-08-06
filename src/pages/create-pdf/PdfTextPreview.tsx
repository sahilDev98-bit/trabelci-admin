import { useEffect, useRef } from "react"

import type { PdfTextHotspot } from "@/features/pdfTemplates/types"
import { hotspotCanvasFont } from "./pdfFonts"
import type { FitResult } from "./pdfTextFit"

interface PdfTextPreviewProps {
  hotspot: PdfTextHotspot
  fit: FitResult
  sessionId: string | null
  availableFontIds: Set<string>
  /** Page background sampled from behind the real hotspot, so the preview
   * sits on the colour the text will actually land on. */
  background: string
}

/** How wide the preview canvas is drawn, in CSS pixels. The box is scaled to
 * this so a narrow caption and a full-width heading are both legible. */
const PREVIEW_WIDTH_PX = 520
/** Never magnify a box more than this — a tiny caption blown up 8× would
 * misrepresent how it actually looks on the page. */
const MAX_PREVIEW_SCALE = 3

/**
 * Renders the replacement text exactly as it will appear in the exported
 * PDF: the document's own typeface, its real size (after auto-fit), its real
 * line spacing, wrapped at the real box width, on the real background.
 *
 * This is the core of making text editing feel like the image flow, which
 * users already trust — you upload an image and immediately see the result.
 * Typing into a bare textarea with a character counter gave no such feedback,
 * so the only way to discover a bad result was to download the file.
 */
export function PdfTextPreview({ hotspot, fit, sessionId, availableFontIds, background }: PdfTextPreviewProps) {
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
    const contentHeightPts = Math.max(boxHeightPts, fit.heightPts)
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
    ctx.fillStyle = background
    ctx.fillRect(0, 0, cssWidth, cssHeight)

    // The original box outline, so it's obvious how much room there is and
    // whether the text is about to run past it.
    ctx.strokeStyle = "rgba(0,0,0,0.18)"
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, padPts * scale + 0.5, cssWidth - 1, boxHeightPts * scale)
    ctx.setLineDash([])

    if (fit.lines.length === 0) return

    const color = hotspot.color
    ctx.fillStyle = `rgb(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255})`
    ctx.font = hotspotCanvasFont(hotspot, sessionId, availableFontIds, fit.fontSize * scale)
    ctx.direction = hotspot.rtl ? "rtl" : "ltr"
    ctx.textAlign = hotspot.rtl ? "right" : "left"
    ctx.textBaseline = "alphabetic"

    // Anchor the first baseline the same way the export does: relative to the
    // top of the box, not its bottom, so a multi-line block grows downward
    // from where its first line really sits.
    const firstBaselinePts = hotspot.originY - hotspot.bbox[1]
    const x = hotspot.rtl ? cssWidth : 0
    fit.lines.forEach((line, i) => {
      const yPts = padPts + firstBaselinePts + i * fit.lineHeight
      ctx.fillText(line, x, yPts * scale)
    })
  }, [hotspot, fit, sessionId, availableFontIds, background])

  return (
    <div className="overflow-auto rounded-lg border bg-muted/30 p-3">
      <canvas ref={canvasRef} className="block max-w-full" />
    </div>
  )
}
