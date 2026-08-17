import { useTranslation } from "react-i18next"

import type { BoxRectPx } from "./useBoxTransform"

interface PdfEngineVectorSlotProps {
  rect: BoxRectPx
  selected: boolean
  onSelect: () => void
  /** Double-click: swap this artwork for an uploaded image. */
  onReplace: () => void
}

/**
 * A piece of vector artwork — a logo, an icon, a drawn mark.
 *
 * These look like pictures but are not: the REFIN logo in the catalogue is
 * seventeen separate path objects, a diamond and one per letter. That is why
 * it could not be clicked before — the editor only offered slots for text
 * and for real image objects, so the most obviously brandable thing on the
 * page had nothing to click at all.
 *
 * Deliberately offers less than an image slot does. Vector paths have no
 * pixels to resize and no text to retype, and dragging one would separate a
 * mark from the layout it was drawn into. What is genuinely useful is
 * getting rid of it, or putting your own logo where theirs was — so this
 * does exactly those two things.
 */
export function PdfEngineVectorSlot({
  rect, selected, onSelect, onReplace,
}: PdfEngineVectorSlotProps) {
  const { t } = useTranslation()

  return (
    <div
      className={`absolute rounded-[2px] transition-shadow ${
        selected
          ? "bg-violet-500/10 ring-2 ring-violet-600"
          : "ring-1 ring-violet-500/30 hover:bg-violet-500/10 hover:ring-2 hover:ring-violet-500/70"
      } cursor-pointer`}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      // Stopped so the page below does not clear the selection this same
      // press just made.
      onPointerDown={(e) => { e.stopPropagation(); onSelect() }}
      onDoubleClick={(e) => { e.stopPropagation(); onReplace() }}
      title={t(
        "pdfTemplates.engineVectorHint",
        "Logo or icon drawn as artwork. Double-click to replace it with an image, or press Delete to remove it.",
      )}
    />
  )
}
