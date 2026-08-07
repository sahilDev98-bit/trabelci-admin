import { useEffect, useRef } from "react"
import { RotateCwIcon, XIcon } from "lucide-react"

import type { PdfOverlay } from "@/features/pdfTemplates/types"

interface PdfOverlayItemProps {
  overlay: PdfOverlay
  /** On-screen pixels per PDF point for the page this sits on. */
  scale: number
  isSelected: boolean
  /** Typing mode for a text item. Single click selects (so it can be
   * dragged/resized); DOUBLE click enters this — the same split every design
   * tool uses, because one element can't both be dragged by the pointer and
   * have text selected by it. */
  isEditing: boolean
  onSelect: () => void
  onStartEdit: () => void
  onEndEdit: () => void
  onChange: (patch: Partial<PdfOverlay>) => void
  onRemove: () => void
  /** Canvas font shorthand for a text overlay, so its on-screen appearance
   * matches the typeface the export will draw with. */
  fontFamily: string
}

const HANDLE_CLASS =
  "absolute size-3 rounded-full border-2 border-white bg-[rgb(23,23,23)] shadow-sm"

/** Corner drag directions, as multipliers on the pointer delta. */
const CORNERS = [
  { key: "nw", dx: -1, dy: -1, style: { left: -6, top: -6, cursor: "nwse-resize" } },
  { key: "ne", dx: 1, dy: -1, style: { right: -6, top: -6, cursor: "nesw-resize" } },
  { key: "sw", dx: -1, dy: 1, style: { left: -6, bottom: -6, cursor: "nesw-resize" } },
  { key: "se", dx: 1, dy: 1, style: { right: -6, bottom: -6, cursor: "nwse-resize" } },
] as const

/** Smallest an overlay can be dragged down to, PDF points — below this the
 * handles overlap each other and it becomes impossible to grab again. */
const MIN_SIZE_PTS = 12

/**
 * One user-added item on a page: draggable, resizable from its corners, and
 * freely rotatable.
 *
 * Uses pointer events rather than HTML5 drag-and-drop. Native DnD only
 * reports a drop target, which is all the page organizer needs, but free
 * placement needs a continuous stream of positions while the pointer moves —
 * and setPointerCapture keeps that stream coming even when the pointer
 * leaves the element, which is exactly what happens when you drag quickly.
 */
export function PdfOverlayItem({
  overlay,
  scale,
  isSelected,
  isEditing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onChange,
  onRemove,
  fontFamily,
}: PdfOverlayItemProps) {
  const textRef = useRef<HTMLTextAreaElement>(null)

  // Focus the moment typing mode opens. Without this you'd have to click a
  // second time inside the box that just appeared — and a brand-new item is
  // created straight into edit mode precisely so you can start typing.
  useEffect(() => {
    if (!isEditing) return
    const el = textRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [isEditing])

  // Geometry at gesture start. Held in a ref, not state: it must not trigger
  // a render, and every pointermove needs the ORIGINAL values to compute an
  // absolute delta — accumulating frame-to-frame deltas drifts.
  const startRef = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0, rotation: 0 })

  const beginGesture = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startRef.current = {
      x: overlay.x,
      y: overlay.y,
      w: overlay.width,
      h: overlay.height,
      px: e.clientX,
      py: e.clientY,
      rotation: overlay.rotation,
    }
  }

  /** Pointer movement since gesture start, converted from screen pixels into
   * PDF points. */
  const deltaPts = (e: React.PointerEvent) => ({
    dx: (e.clientX - startRef.current.px) / scale,
    dy: (e.clientY - startRef.current.py) / scale,
  })

  const handleMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const { dx, dy } = deltaPts(e)
    onChange({ x: startRef.current.x + dx, y: startRef.current.y + dy })
  }

  const handleResize = (e: React.PointerEvent, corner: (typeof CORNERS)[number]) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const { dx, dy } = deltaPts(e)
    const s = startRef.current

    // The pointer delta arrives in PAGE axes, but the corner being dragged
    // belongs to the item's own (rotated) axes. Rotating the delta back by
    // -rotation converts it into the item's local space, so dragging the
    // right edge of a tilted box widens it along ITS width rather than
    // sliding it diagonally across the page.
    const rad = (-s.rotation * Math.PI) / 180
    const localDx = dx * Math.cos(rad) - dy * Math.sin(rad)
    const localDy = dx * Math.sin(rad) + dy * Math.cos(rad)

    const width = Math.max(MIN_SIZE_PTS, s.w + localDx * corner.dx)
    const height = Math.max(MIN_SIZE_PTS, s.h + localDy * corner.dy)

    // Dragging a top/left corner moves the origin as well as the size, and
    // it has to move along the item's own axes too — otherwise a rotated box
    // walks away from the corner under the pointer.
    const growW = width - s.w
    const growH = height - s.h
    const offX = corner.dx < 0 ? -growW : 0
    const offY = corner.dy < 0 ? -growH : 0
    const fwd = (s.rotation * Math.PI) / 180
    const x = s.x + (offX * Math.cos(fwd) - offY * Math.sin(fwd))
    const y = s.y + (offX * Math.sin(fwd) + offY * Math.cos(fwd))

    onChange({ x, y, width, height })
  }

  const handleRotate = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    // Angle is taken from the item's centre to the pointer, so the item
    // simply follows the cursor round rather than tracking a delta.
    const box = (e.currentTarget as HTMLElement).closest("[data-overlay-box]")
    if (!box) return
    const rect = box.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
    const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle)
    onChange({ rotation: ((snapped % 360) + 360) % 360 })
  }

  const endGesture = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      data-overlay-box
      // Every drag handler is off while typing. beginGesture calls
      // preventDefault, which would otherwise stop the textarea ever taking
      // focus or letting you select a word.
      onPointerDown={isEditing ? undefined : (e) => { onSelect(); beginGesture(e) }}
      onPointerMove={isEditing ? undefined : handleMove}
      onPointerUp={isEditing ? undefined : endGesture}
      onPointerCancel={isEditing ? undefined : endGesture}
      onDoubleClick={overlay.type === "text" && !isEditing ? (e) => { e.stopPropagation(); onStartEdit() } : undefined}
      style={{
        position: "absolute",
        left: overlay.x * scale,
        top: overlay.y * scale,
        width: overlay.width * scale,
        height: overlay.height * scale,
        transform: `rotate(${overlay.rotation}deg)`,
        transformOrigin: "center",
        cursor: isEditing ? "text" : "move",
        // Added items sit above every hotspot overlay (which use z-index 1–2)
        // — they're the newest thing on the page and must always be
        // reachable, never trapped behind a region of the original document.
        zIndex: 10,
        outline: isEditing
          ? "2px solid rgb(37,99,235)"
          : isSelected
            ? "1.5px solid rgb(23,23,23)"
            : "1px dashed rgba(23,23,23,0.35)",
        outlineOffset: 0,
        touchAction: "none",
      }}
    >
      {overlay.type === "image" ? (
        <img
          src={overlay.previewUrl}
          alt=""
          draggable={false}
          className="block size-full object-fill"
        />
      ) : isEditing ? (
        // A real textarea rather than a contentEditable div: the value stays
        // fully controlled by React, so the caret can't jump around while
        // typing, and multi-line input works for free. Styled to match the
        // rendered text exactly so the box doesn't visibly change the moment
        // you start editing.
        <textarea
          ref={textRef}
          value={overlay.text}
          onChange={(e) => onChange({ text: e.target.value })}
          // Keystrokes must not reach the page behind this — Delete/Escape
          // there act on the whole item rather than on the words.
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Escape") {
              e.preventDefault()
              onEndEdit()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={onEndEdit}
          className="size-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
          style={{
            font: `${overlay.italic ? "italic " : ""}${overlay.bold ? "bold " : ""}${overlay.fontSize * scale}px ${fontFamily}`,
            color: overlay.color,
            textAlign: overlay.align,
            lineHeight: 1.25,
          }}
        />
      ) : (
        <div
          className="size-full overflow-hidden whitespace-pre-wrap break-words"
          style={{
            font: `${overlay.italic ? "italic " : ""}${overlay.bold ? "bold " : ""}${overlay.fontSize * scale}px ${fontFamily}`,
            color: overlay.color,
            textAlign: overlay.align,
            lineHeight: 1.25,
          }}
        >
          {overlay.text}
        </div>
      )}

      {/* Handles are hidden while typing: they sit right where you'd click
          to place the caret at the start or end of the text, so leaving them
          live would turn an attempt to click into the words into a resize. */}
      {isSelected && !isEditing && (
        <>
          {CORNERS.map((corner) => (
            <div
              key={corner.key}
              className={HANDLE_CLASS}
              style={corner.style}
              onPointerDown={beginGesture}
              onPointerMove={(e) => handleResize(e, corner)}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          ))}

          <div
            className="absolute flex size-6 cursor-grab items-center justify-center rounded-full border-2 border-white bg-[rgb(23,23,23)] text-white shadow-sm"
            style={{ left: "50%", top: -34, marginLeft: -12 }}
            onPointerDown={beginGesture}
            onPointerMove={handleRotate}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <RotateCwIcon className="size-3" />
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="absolute flex size-6 items-center justify-center rounded-full border-2 border-white bg-[rgb(185,28,28)] text-white shadow-sm"
            style={{ right: -30, top: -30 }}
          >
            <XIcon className="size-3" />
          </button>
        </>
      )}
    </div>
  )
}
