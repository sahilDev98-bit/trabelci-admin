import { useTranslation } from "react-i18next"

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
  dropTarget: boolean
  /** True while THIS image is the one being carried across the document. */
  dragging: boolean
  /** The page rendered without this slot, laid over it while in flight. */
  originPatchUrl: string | null
  onSelect: () => void
  onReplace: () => void
  /** Fired once on gesture release, in PDF points (y measured from the
   * bottom, as PDF stores it). */
  onTransform: (rect: { x: number; y: number; width: number; height: number }) => void
  /** Begins a document-wide move, carrying the element's viewport rect. */
  onMoveStart: (e: React.PointerEvent, rect: DOMRect) => void
}

const HANDLES: { key: ResizeHandle; className: string; cursor: string }[] = [
  { key: "nw", className: "-start-1.5 -top-1.5", cursor: "nwse-resize" },
  { key: "ne", className: "-end-1.5 -top-1.5", cursor: "nesw-resize" },
  { key: "sw", className: "-start-1.5 -bottom-1.5", cursor: "nesw-resize" },
  { key: "se", className: "-end-1.5 -bottom-1.5", cursor: "nwse-resize" },
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
  selected, dropTarget, dragging, originPatchUrl, onSelect, onReplace, onTransform, onMoveStart,
}: PdfEngineImageSlotProps) {
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
        dropTarget
          ? "bg-emerald-500/25 ring-2 ring-emerald-500"
          : selected
            ? "ring-2 ring-sky-500"
            : "ring-1 ring-amber-500/40 hover:ring-2 hover:ring-amber-500/80"
      } ${selected ? "cursor-move" : "cursor-pointer"}`}
      style={{ left: live.left, top: live.top, width: live.width, height: live.height }}
      onPointerDown={(e) => {
        // Stopped unconditionally: the page below clears the selection on
        // pointerdown so clicking blank paper deselects, and without this
        // the same press would select this slot and then immediately
        // deselect it again as the event bubbled.
        e.stopPropagation()
        if (!selected) { onSelect(); return }
        onMoveStart(e, e.currentTarget.getBoundingClientRect())
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onReplace() }}
      title={t("pdfTemplates.engineImageHint", "Double-click to replace. Drag to move it anywhere in the document, corners to resize.")}
    >
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

      {selected && HANDLES.map((handle) => (
        <span
          key={handle.key}
          role="presentation"
          onPointerDown={(e) => transform.startResize(e, handle.key)}
          className={`absolute size-3 rounded-full border-2 border-white bg-sky-500 shadow ${handle.className}`}
          style={{ cursor: handle.cursor }}
        />
      ))}
    </div>
  )
}
