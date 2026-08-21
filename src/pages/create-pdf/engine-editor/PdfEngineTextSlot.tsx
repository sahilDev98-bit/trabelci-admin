import { useTranslation } from "react-i18next"

import type { EngineTextLine } from "@/lib/pdf-engine"
import { useBoxTransform, type BoxRectPx, type ResizeHandle } from "./useBoxTransform"

interface PdfEngineTextSlotProps {
  line: EngineTextLine
  rect: BoxRectPx
  pageWidthPx: number
  pageHeightPx: number
  scale: number
  selected: boolean
  /** True while THIS box is the one being carried across the document. */
  dragging: boolean
  /** The page rendered without this slot, laid over it while in flight. */
  originPatchUrl: string | null
  onSelect: () => void
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
  selected, dragging, originPatchUrl, onSelect, onEdit, onMoveStart, onResize,
}: PdfEngineTextSlotProps) {
  const { t } = useTranslation()

  const transform = useBoxTransform({
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
          : "cursor-text ring-1 ring-blue-500/30 hover:bg-blue-500/10 hover:ring-2 hover:ring-blue-500/70"
      }`}
      data-pdf-text-slot
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
        if (!selected) { onSelect(); return }
        onMoveStart(e, e.currentTarget.getBoundingClientRect())
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onEdit() }}
    >
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

      {selected && HANDLES.map((handle) => (
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
