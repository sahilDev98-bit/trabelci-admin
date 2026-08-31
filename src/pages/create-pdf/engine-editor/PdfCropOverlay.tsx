import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { BoxRectPx } from "./useBoxTransform"

/**
 * Trimming a picture by dragging its edges inward.
 *
 * A separate layer over the picture rather than a mode inside the image slot,
 * and that is deliberate. During a crop the four handles mean something
 * completely different from usual — they cut instead of stretch — and a slot
 * whose handles change meaning depending on a flag is how a gesture ends up
 * doing the wrong thing. While this is open it covers the picture entirely,
 * so the ordinary drag and resize cannot fire at all.
 *
 * What it reports is a region in FRACTIONS of the picture, not pixels or
 * points: the engine works in the image's own space, and fractions survive
 * the page being zoomed between opening the crop and confirming it.
 */

/** Smallest slice that can be kept, as a fraction. Below roughly this the
 * handles overlap and the crop cannot be adjusted back. */
const MIN_FRACTION = 0.05

type Edge = "left" | "right" | "top" | "bottom"

interface PdfCropOverlayProps {
  /** The picture's box on screen, CSS px within the page. */
  rect: BoxRectPx
  onCancel: () => void
  /** Fractions of the ORIGINAL picture, measured from its bottom-left — the
   * convention the engine and the rest of PDF use. */
  onCommit: (region: { left: number; bottom: number; right: number; top: number }) => void
}

export function PdfCropOverlay({ rect, onCancel, onCommit }: PdfCropOverlayProps) {
  const { t } = useTranslation()
  /** The kept region, in fractions measured from the TOP-left — screen
   * order, because that is what the dragging arithmetic works in. Converted
   * to PDF's bottom-up convention once, on commit. */
  const [keep, setKeep] = useState({ left: 0, top: 0, right: 1, bottom: 1 })
  const dragging = useRef<Edge | null>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const edge = dragging.current
      if (!edge) return
      const host = hostRef.current
      if (!host) return
      const box = host.getBoundingClientRect()
      const fx = (e.clientX - box.left) / Math.max(1, box.width)
      const fy = (e.clientY - box.top) / Math.max(1, box.height)
      setKeep((current) => {
        const next = { ...current }
        if (edge === "left") next.left = clamp(fx, 0, current.right - MIN_FRACTION)
        if (edge === "right") next.right = clamp(fx, current.left + MIN_FRACTION, 1)
        if (edge === "top") next.top = clamp(fy, 0, current.bottom - MIN_FRACTION)
        if (edge === "bottom") next.bottom = clamp(fy, current.top + MIN_FRACTION, 1)
        return next
      })
    }
    const onUp = () => { dragging.current = null }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [])

  const hostRef = useRef<HTMLDivElement>(null)

  const commit = () => onCommit({
    left: keep.left,
    right: keep.right,
    // Screen y runs downward and PDF's runs upward, so the top and bottom
    // swap as well as flip. Doing this once here is why nothing downstream
    // has to think about it.
    bottom: 1 - keep.bottom,
    top: 1 - keep.top,
  })

  const pct = (n: number) => `${n * 100}%`

  return (
    <div
      ref={hostRef}
      data-pdf-crop-overlay
      className="absolute z-30"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      // Swallows every press: while a crop is open the picture underneath
      // must not also be selectable, movable or resizable.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* What is being cut away, dimmed. Four strips rather than one box with
          a hole, because a hole needs either an SVG mask or a shadow trick and
          both behave differently once the page is zoomed. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/55" style={{ height: pct(keep.top) }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55" style={{ height: pct(1 - keep.bottom) }} />
      <div
        className="pointer-events-none absolute left-0 bg-black/55"
        style={{ top: pct(keep.top), height: pct(keep.bottom - keep.top), width: pct(keep.left) }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-black/55"
        style={{ top: pct(keep.top), height: pct(keep.bottom - keep.top), width: pct(1 - keep.right) }}
      />

      {/* The part being kept. */}
      <div
        data-pdf-crop-keep
        className="pointer-events-none absolute ring-2 ring-white"
        style={{
          left: pct(keep.left), top: pct(keep.top),
          width: pct(keep.right - keep.left), height: pct(keep.bottom - keep.top),
        }}
      />

      {(["left", "right", "top", "bottom"] as Edge[]).map((edge) => (
        <span
          key={edge}
          role="presentation"
          data-pdf-crop-edge={edge}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); dragging.current = edge }}
          className="absolute bg-white/90 shadow"
          style={edgeStyle(edge, keep)}
        />
      ))}

      <div className="absolute -bottom-11 left-1/2 flex -translate-x-1/2 gap-1 rounded-md bg-slate-800/90 p-1 shadow-lg">
        <Button size="sm" className="h-7 gap-1 px-2" onClick={commit}>
          <CheckIcon className="size-3.5" />
          {t("pdfTemplates.cropApply", "Done")}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-white hover:text-white" onClick={onCancel}>
          <XIcon className="size-3.5" />
          {t("common.cancel", "Cancel")}
        </Button>
      </div>
    </div>
  )
}

/** A grab bar along the middle of each edge of the kept region. */
function edgeStyle(edge: Edge, keep: { left: number; top: number; right: number; bottom: number }): React.CSSProperties {
  const pct = (n: number) => `${n * 100}%`
  const midX = pct((keep.left + keep.right) / 2)
  const midY = pct((keep.top + keep.bottom) / 2)
  const BAR = 28
  const THICK = 6
  if (edge === "left" || edge === "right") {
    return {
      left: pct(edge === "left" ? keep.left : keep.right),
      top: midY,
      width: THICK, height: BAR,
      transform: "translate(-50%, -50%)",
      cursor: "ew-resize",
      borderRadius: 3,
    }
  }
  return {
    top: pct(edge === "top" ? keep.top : keep.bottom),
    left: midX,
    height: THICK, width: BAR,
    transform: "translate(-50%, -50%)",
    cursor: "ns-resize",
    borderRadius: 3,
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
