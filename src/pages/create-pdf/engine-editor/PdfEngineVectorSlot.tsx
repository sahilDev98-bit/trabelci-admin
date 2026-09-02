import { useTranslation } from "react-i18next"
import { productFieldLabel } from "./productSlots"

import { useBoxTransform, type BoxRectPx, type ResizeHandle } from "./useBoxTransform"

interface PdfEngineVectorSlotProps {
  rect: BoxRectPx
  pageWidthPx: number
  pageHeightPx: number
  /** CSS px per PDF point, for converting a finished gesture back. */
  scale: number
  pageHeightPts: number
  selected: boolean
  /** Locked slots can be selected — you have to be able to reach one to
   * unlock it — but not moved or resized, and they show no handles. */
  /** Its index within its own kind, published on the element so a group
   * drag can find the other members' boxes — their on-screen positions
   * exist nowhere but the DOM. */
  slotIndex: number
  locked?: boolean
  /** The product detail this box holds, or null for fixed text. */
  productField?: string | null
  /** Alignment: nudges the live rect and draws the guides. Supplied by the
   * page, which is the only thing that knows what else is on it. */
  snap?: (rect: BoxRectPx, kind: string, altKey: boolean) => BoxRectPx
  onGestureEnd?: () => void
  /** `additive` is true when Shift was held: the caller adds this slot to
   * the current selection rather than replacing it. */
  onSelect: (additive: boolean) => void
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
  selected, locked, productField, slotIndex, onSelect, onReplace, onTransform, snap, onGestureEnd,
}: PdfEngineVectorSlotProps) {
  const { t } = useTranslation()

  const transform = useBoxTransform({
    snap,
    onGestureEnd,
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
      data-pdf-vector-slot={slotIndex}
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
        if (e.shiftKey) { onSelect(true); return }
        if (!selected) onSelect(false)
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!locked) onReplace() }}
      title={t(
        "pdfTemplates.engineVectorHint",
        "Logo or icon drawn as artwork. Double-click to replace it with an image, drag to move it, corners to resize.",
      )}
    >
      {productField && (
        <span
          data-pdf-slot-badge={productField}
          className="pointer-events-none absolute -top-4 start-0 z-10 whitespace-nowrap rounded-sm bg-emerald-600 px-1 text-[9px] font-medium leading-4 text-white"
        >
          {productFieldLabel(t, productField)}
        </span>
      )}
      {locked && (
        // Shown whether or not it is selected: the point of a lock is that
        // you can see at a glance why something will not move.
        <span
          data-pdf-slot-locked
          aria-hidden
          className="pointer-events-none absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-slate-700 text-white shadow"
        >
          <svg viewBox="0 0 24 24" className="size-2.5" fill="currentColor">
            <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 5a3 3 0 1 1 6 0v3H9V6z"/>
          </svg>
        </span>
      )}

      {selected && !locked && HANDLES.map((handle) => (
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
