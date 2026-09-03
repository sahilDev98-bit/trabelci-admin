import { useTranslation } from "react-i18next"
import { productSlotBadge, type ProductSlotMark } from "./productSlots"

import type { EngineTextLine } from "@/lib/pdf-engine"
import { useBoxTransform, type BoxRectPx, type ResizeHandle } from "./useBoxTransform"

interface PdfEngineTextSlotProps {
  line: EngineTextLine
  rect: BoxRectPx
  pageWidthPx: number
  pageHeightPx: number
  scale: number
  selected: boolean
  /** Locked slots can be selected — you have to be able to reach one to
   * unlock it — but not moved or resized, and they show no handles. */
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
  /** True while THIS box is the one being carried across the document. */
  dragging: boolean
  /** The page rendered without this slot, laid over it while in flight. */
  originPatchUrl: string | null
  /** `additive` is true when Shift was held: the caller adds this slot to
   * the current selection rather than replacing it. */
  onSelect: (additive: boolean) => void
  onEdit: () => void
  /** Begins a document-wide move. The element's live viewport rect goes
   * with it so the ghost can appear exactly over the box. */
  onMoveStart: (e: React.PointerEvent, rect: DOMRect) => void
  /** Resize: text has no box to stretch, so this reports the new type size
   * and the new wrap width the box was dragged to. */
  onResize: (fontSize: number, maxWidth: number) => void
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
 * One editable line of existing text: click to select, drag to move, pull a
 * corner to change its size.
 *
 * Resizing text is not the same operation as resizing an image. A PDF text
 * object has no width or height to stretch — it has a type size — so a
 * corner drag is translated into a new font size (from how much the box
 * grew) plus a new wrap width. Stretching the glyphs instead would produce
 * the distorted, horizontally-squashed type that gives away a bad PDF
 * editor.
 */
export function PdfEngineTextSlot({
  line, rect, pageWidthPx, pageHeightPx, scale,
  selected, locked, productSlot, productsOnPage = 1, dragging, originPatchUrl, onSelect, onEdit, onMoveStart, onResize, snap, onGestureEnd,
}: PdfEngineTextSlotProps) {
  const { t } = useTranslation()

  const transform = useBoxTransform({
    snap,
    onGestureEnd,
    rect,
    pageWidth: pageWidthPx,
    pageHeight: pageHeightPx,
    disabled: !selected,
    onCommit: (finalRect) => {
      // Only resizes reach here now — moves are a separate, document-wide
      // gesture — so there is no move/grow branch to disambiguate.
      // Scale taken from the WIDTH: it is the axis the user is really
      // sizing to, and matching height instead would make a line of text
      // jump wildly for a small vertical nudge.
      const ratio = rect.width > 0 ? finalRect.width / rect.width : 1
      onResize(Math.max(1, line.fontSize * ratio), finalRect.width / scale)
    },
  })

  const live = transform.rect

  return (
    <div
      className={`absolute rounded-[2px] transition-shadow ${
        selected
          ? "cursor-move bg-blue-500/5 ring-2 ring-blue-600"
          // Visible at rest, not just on hover. At 30% opacity a one-pixel
          // ring around 8pt text is invisible on white paper at ordinary
          // zoom — which made perfectly editable lines look like plain
          // artwork, and was reported as "this text cannot be edited". The
          // page below is the customer's design and should stay readable, so
          // this is the lightest outline that can actually be SEEN rather
          // than the lightest that can be drawn.
          : "cursor-text ring-1 ring-blue-500/70 hover:bg-blue-500/10 hover:ring-2 hover:ring-blue-600"
      }`}
      data-pdf-text-slot={line.lineIndex}
      // The area around it is pinned to physical left-to-right for its
      // scroll maths; "auto" lets this slot's tooltip take its direction
      // from the words in it, so a Hebrew hint still reads as Hebrew.
      dir="auto"
      style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
      title={`${line.text}
${Math.round(line.fontSize)}pt · ${t("pdfTemplates.engineTextHint", "Double-click to edit. Drag to move it anywhere in the document, corners to resize.")}`}
      onPointerDown={(e) => {
        // Stopped so the page below does not clear the selection this same
        // press just made.
        e.stopPropagation()
        // Shift always reports, even on an already-selected slot, so a
        // shift-click can take one back OUT of a group.
        if (e.shiftKey) { onSelect(true); return }
        if (!selected) { onSelect(false); return }
        // A locked box still selects, so it can be unlocked, but the press
        // never becomes a move.
        if (locked) return
        onMoveStart(e, e.currentTarget.getBoundingClientRect())
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!locked) onEdit() }}
    >
      {/* What this box holds, when it is a product slot. Shown on the box
          rather than only in the toolbar: a slot you cannot see is a slot you
          forget you made, and on a finished page a product slot looks exactly
          like any other text. */}
      {productSlot && (
        <span
          data-pdf-slot-badge={productSlot.fieldId}
          className="pointer-events-none absolute -top-4 start-0 z-10 whitespace-nowrap rounded-sm bg-emerald-600 px-1 text-[9px] font-medium leading-4 text-white"
        >
          {productSlotBadge(t, productSlot, productsOnPage)}
        </span>
      )}
      {/* No floating toolbar. On a dense catalogue page the boxes sit
          shoulder to shoulder, and a panel hovering over each selection
          covered the very artwork the user is positioning against. The
          gesture IS the interface: drag to move, corner to resize,
          double-click to edit the words. */}
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
          className={`absolute size-3 rounded-full border-2 border-white bg-blue-600 shadow ${handle.className}`}
          style={{ cursor: handle.cursor }}
        />
      ))}
    </div>
  )
}
