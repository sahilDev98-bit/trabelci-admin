import { useTranslation } from "react-i18next"
import { productSlotBadge, type ProductSlotMark } from "./productSlots"

import { useBoxTransform, type BoxRectPx, type ResizeHandle } from "./useBoxTransform"

interface PdfEngineImageSlotProps {
  /** The slot's current position on screen, CSS px. */
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
  /** The product slot this box IS, or null for fixed content. */
  productSlot?: ProductSlotMark | null
  /** How many products the page shows, so the badge can say which one this
   * belongs to when there is more than one. */
  productsOnPage?: number
  /** Alignment: nudges the live rect and draws the guides. Supplied by the
   * page, which is the only thing that knows what else is on it. */
  snap?: (rect: BoxRectPx, kind: string, altKey: boolean) => BoxRectPx
  onGestureEnd?: () => void
  dropTarget: boolean
  /** True while THIS image is the one being carried across the document. */
  dragging: boolean
  /** The page rendered without this slot, laid over it while in flight. */
  originPatchUrl: string | null
  /** `additive` is true when Shift was held: the caller adds this slot to
   * the current selection rather than replacing it. */
  onSelect: (additive: boolean) => void
  onReplace: () => void
  /** Fired once on gesture release, in PDF points (y measured from the
   * bottom, as PDF stores it). */
  onTransform: (rect: { x: number; y: number; width: number; height: number }) => void
  /** Begins a document-wide move, carrying the element's viewport rect. */
  onMoveStart: (e: React.PointerEvent, rect: DOMRect) => void
}

/**
 * Corner grips, placed with PHYSICAL left/right rather than start/end.
 *
 * They used to use the logical properties, which is normally the right
 * instinct in this app — but these four are named for compass directions and
 * the arithmetic behind them is physical: "ne" means the east edge follows
 * the pointer, and east is east whatever language the interface is in. Under
 * Hebrew the logical version put the grip named "nw" on the box's top-RIGHT
 * corner while the maths still moved the west edge, so dragging a corner
 * resized the box backwards. Nothing threw; it just behaved inside out.
 *
 * A page is a physical sheet of paper. Its coordinates do not flip.
 */
const HANDLES: { key: ResizeHandle; className: string; cursor: string }[] = [
  { key: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { key: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { key: "sw", className: "-left-1.5 -bottom-1.5", cursor: "nesw-resize" },
  { key: "se", className: "-right-1.5 -bottom-1.5", cursor: "nwse-resize" },
]

/**
 * One image slot on the page: click to select, then drag to move or pull a
 * corner to resize. Double-click replaces the picture.
 *
 * Every image can be moved, including the clipped ones that make up most of
 * a designed catalogue. The shape framing a photo is carried along by the
 * same transform that moves the photo (see setImageRect), so it keeps its
 * circle or rounded frame wherever it is put — these slots used to be
 * replace-only for that reason, which in a document where every photo is
 * clipped meant none of them could be moved at all.
 */
export function PdfEngineImageSlot({
  rect, pageWidthPx, pageHeightPx, scale, pageHeightPts,
  selected, locked, productSlot, productsOnPage = 1, slotIndex, dropTarget, dragging, originPatchUrl, onSelect, onReplace, onTransform, onMoveStart, snap, onGestureEnd,
}: PdfEngineImageSlotProps) {
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
        dropTarget
          ? "bg-emerald-500/25 ring-2 ring-emerald-500"
          : selected
            ? "ring-2 ring-sky-500"
            : "ring-1 ring-amber-500/70 hover:ring-2 hover:ring-amber-600"
      } ${selected ? "cursor-move" : "cursor-pointer"}`}
      data-pdf-image-slot={slotIndex}
      // The area around it is pinned to physical left-to-right for its
      // scroll maths; "auto" lets this slot's tooltip take its direction
      // from the words in it, so a Hebrew hint still reads as Hebrew.
      dir="auto"
      style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
      onPointerDown={(e) => {
        // Stopped unconditionally: the page below clears the selection on
        // pointerdown so clicking blank paper deselects, and without this
        // the same press would select this slot and then immediately
        // deselect it again as the event bubbled.
        e.stopPropagation()
        // Shift always reports, even on an already-selected slot, so a
        // shift-click can take one back OUT of a group.
        if (e.shiftKey) { onSelect(true); return }
        if (!selected) { onSelect(false); return }
        // A locked slot still selects, so it can be unlocked, but the press
        // never becomes a move.
        if (locked) return
        onMoveStart(e, e.currentTarget.getBoundingClientRect())
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!locked) onReplace() }}
      title={`${t("pdfTemplates.engineImageHint", "Double-click to replace. Drag to move it anywhere in the document, corners to resize.")} ${t("pdfTemplates.engineGroupHint", "Shift-click to move several things together.")} ${t("pdfTemplates.engineSnapHint", "Hold Alt while dragging to ignore alignment.")}`}
    >
      {productSlot && (
        <span
          data-pdf-slot-badge={productSlot.fieldId}
          className="pointer-events-none absolute -top-4 start-0 z-10 whitespace-nowrap rounded-sm bg-emerald-600 px-1 text-[9px] font-medium leading-4 text-white"
        >
          {productSlotBadge(t, productSlot, productsOnPage)}
        </span>
      )}
      {/* Nothing floats over the artwork: no toolbar, and no delete button
          either. On a dense catalogue page the boxes sit shoulder to
          shoulder, so a control hovering over each selection covered the
          very design the user is positioning against. The gesture IS the
          interface — drag to move, corner to resize, double-click to
          replace — and deleting is the Delete/Backspace key, the same as
          for a text box. */}
      {/* While this slot is in flight, the place it came from shows the page
          WITHOUT it — rendered by the engine, which is the only thing that
          knows what is behind an object. A flat cover could only ever be an
          opaque mark sitting on the artwork; this is the artwork. */}
      {dragging && originPatchUrl && (
        <img
          data-engine-drag-origin
          src={originPatchUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
        />
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
          role="presentation"
          data-resize-handle={handle.key}
          onPointerDown={(e) => transform.startResize(e, handle.key)}
          className={`absolute size-3 rounded-full border-2 border-white bg-sky-500 shadow ${handle.className}`}
          style={{ cursor: handle.cursor }}
        />
      ))}
    </div>
  )
}
