import { useTranslation } from "react-i18next"

import { useBoxTransform, type BoxRectPx, type ResizeHandle } from "./useBoxTransform"

interface PdfEngineVectorSlotProps {
  rect: BoxRectPx
  pageWidthPx: number
  pageHeightPx: number
  /** CSS px per PDF point, for converting a finished gesture back. */
  scale: number
  pageHeightPts: number
  selected: boolean
  onSelect: () => void
  /** Double-click: swap this artwork for an uploaded image. */
  onReplace: () => void
  /** Fired once on gesture release, in PDF points (y from the bottom). */
  onTransform: (rect: { x: number; y: number; width: number; height: number }) => void
}

/** The same physical corners an image slot uses — see PdfEngineImageSlot for
 * why these are left/right rather than start/end. */
const HANDLES: { key: ResizeHandle; className: string; cursor: string }[] = [
  { key: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { key: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { key: "sw", className: "-left-1.5 -bottom-1.5", cursor: "nesw-resize" },
  { key: "se", className: "-right-1.5 -bottom-1.5", cursor: "nwse-resize" },
]

/**
 * A piece of vector artwork — a logo, an icon, a QR code, a drawn mark.
 *
 * These look like pictures but are not: the REFIN logo in the catalogue is
 * seventeen separate path objects, a diamond and one per letter. That is why
 * they need finding and grouping at all.
 *
 * They behave EXACTLY like an image slot, and deliberately so. They used to
 * be a second, weaker kind of thing — their own violet colour, replace-only,
 * no dragging and no resizing — on the reasoning that paths have no pixels
 * to scale. That reasoning was wrong: paths scale better than pixels do, and
 * the distinction was invisible to anyone using the editor. All it produced
 * was two kinds of picture on one page that looked different and answered
 * differently to the same gesture, with no way to tell which was which until
 * you tried.
 *
 * So there is one kind of picture now. Same amber outline, same grips, same
 * drag, same double-click to replace, same Delete key.
 */
export function PdfEngineVectorSlot({
  rect, pageWidthPx, pageHeightPx, scale, pageHeightPts,
  selected, onSelect, onReplace, onTransform,
}: PdfEngineVectorSlotProps) {
  const { t } = useTranslation()

  const transform = useBoxTransform({
    rect,
    pageWidth: pageWidthPx,
    pageHeight: pageHeightPx,
    disabled: !selected,
    onCommit: (finalRect) => {
      // Screen -> PDF. The y axis flips: a box's TOP edge measured downward
      // becomes its BOTTOM edge measured upward from the far side.
      const width = finalRect.width / scale
      const height = finalRect.height / scale
      onTransform({
        x: finalRect.left / scale,
        y: pageHeightPts - finalRect.top / scale - height,
        width,
        height,
      })
    },
  })

  const live = transform.rect

  return (
    <div
      className={`group absolute rounded-[2px] transition-shadow ${
        selected
          ? "ring-2 ring-sky-500"
          : "ring-1 ring-amber-500/70 hover:ring-2 hover:ring-amber-600"
      } ${selected ? "cursor-move" : "cursor-pointer"}`}
      data-pdf-vector-slot
      // The area around it is pinned to physical left-to-right for its
      // scroll maths; "auto" lets this slot's tooltip read in the user's
      // own language.
      dir="auto"
      style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
      onPointerDown={(e) => {
        // Stopped unconditionally: the page below clears the selection on
        // pointerdown, and without this the same press would select this
        // slot and then immediately deselect it as the event bubbled.
        e.stopPropagation()
        if (!selected) onSelect()
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onReplace() }}
      title={t(
        "pdfTemplates.engineVectorHint",
        "Logo or icon drawn as artwork. Double-click to replace it with an image, drag to move it, corners to resize.",
      )}
    >
      {selected && HANDLES.map((handle) => (
        <span
          key={handle.key}
          data-resize-handle={handle.key}
          onPointerDown={(e) => transform.startResize(e, handle.key)}
          className={`absolute size-3 rounded-full border-2 border-white bg-blue-600 shadow ${handle.className}`}
          style={{ cursor: handle.cursor }}
        />
      ))}
      {selected && (
        <span
          // The body of the box moves it. A separate grab area rather than
          // the container itself, so a press that lands on a corner grip is
          // a resize and never both at once.
          onPointerDown={(e) => { e.stopPropagation(); transform.startMove(e) }}
          className="absolute inset-2 cursor-move"
        />
      )}
    </div>
  )
}
