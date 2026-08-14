import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Pointer-driven RESIZE for a box laid over the page canvas.
 *
 * Works in CSS pixels while the gesture is live and reports the final rect
 * once, on release. The engine is only touched at that point — committing
 * on every pointer move would mean a full PDFium re-render per frame,
 * which is both slow and visually laggy.
 *
 * Moving deliberately does NOT live here. A resize is inherently confined
 * to one page (a box cannot be stretched across a page break), so clamping
 * to the page is correct for it; a move is not, and is handled by
 * useCrossPageDrag so a box can be carried to any page in the document.
 * Keeping a second, page-clamped move path here as well would leave two
 * drag implementations to keep in step.
 */

export type ResizeHandle = "nw" | "ne" | "sw" | "se"

export interface BoxRectPx {
  left: number
  top: number
  width: number
  height: number
}

/** Smallest box a gesture may produce, in CSS px. Below roughly this the
 * handles overlap each other and the box can no longer be grabbed to undo
 * the mistake. */
const MIN_SIZE_PX = 16

interface UseBoxTransformOptions {
  /** Live rect while idle — the box's committed position. */
  rect: BoxRectPx
  /** Page bounds in CSS px, so a gesture cannot drag content off-page. */
  pageWidth: number
  pageHeight: number
  /** Called once, on release, with the final rect. */
  onCommit: (rect: BoxRectPx) => void
  disabled?: boolean
}

export interface UseBoxTransformResult {
  /** What to render: the live gesture rect, or the committed one. */
  rect: BoxRectPx
  dragging: boolean
  startResize: (e: React.PointerEvent, handle: ResizeHandle) => void
}

export function useBoxTransform({
  rect, pageWidth, pageHeight, onCommit, disabled,
}: UseBoxTransformOptions): UseBoxTransformResult {
  const [live, setLive] = useState<BoxRectPx | null>(null)
  /** Mirrors `live` so the end of a gesture can read the final rect without
   * reaching for it inside a state updater — see finish(). */
  const liveRef = useRef<BoxRectPx | null>(null)
  const gesture = useRef<{
    kind: ResizeHandle
    startX: number
    startY: number
    origin: BoxRectPx
  } | null>(null)

  const applyLive = useCallback((next: BoxRectPx | null) => {
    liveRef.current = next
    setLive(next)
  }, [])

  // The committed rect can change under us (an edit elsewhere re-lists the
  // page), so the live rect is dropped whenever a gesture is not running.
  const committed = live ?? rect

  const finish = useCallback(() => {
    const g = gesture.current
    const final = liveRef.current
    gesture.current = null
    applyLive(null)
    // Called AFTER the state update, never inside its updater: an updater
    // must be pure, and onCommit sets state on the parent — doing it in
    // there makes React warn about updating one component while rendering
    // another, and is a real correctness hazard rather than noise.
    if (g && final) onCommit(final)
  }, [onCommit, applyLive])

  useEffect(() => {
    if (!gesture.current) return
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const o = g.origin

      // Each corner moves its own two edges; the opposite corner stays
      // pinned, which is what makes a resize feel like dragging a corner
      // rather than scaling about the centre.
      const east = g.kind === "ne" || g.kind === "se"
      const south = g.kind === "se" || g.kind === "sw"
      let left = o.left
      let top = o.top
      let width = east ? o.width + dx : o.width - dx
      let height = south ? o.height + dy : o.height - dy
      if (!east) left = o.left + dx
      if (!south) top = o.top + dy

      if (width < MIN_SIZE_PX) {
        if (!east) left = o.left + (o.width - MIN_SIZE_PX)
        width = MIN_SIZE_PX
      }
      if (height < MIN_SIZE_PX) {
        if (!south) top = o.top + (o.height - MIN_SIZE_PX)
        height = MIN_SIZE_PX
      }
      // Clamped to the page so a corner drag cannot push content off it.
      left = Math.min(Math.max(0, left), pageWidth - MIN_SIZE_PX)
      top = Math.min(Math.max(0, top), pageHeight - MIN_SIZE_PX)
      width = Math.min(width, pageWidth - left)
      height = Math.min(height, pageHeight - top)
      applyLive({ left, top, width, height })
    }

    const onUp = () => finish()
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [live, pageWidth, pageHeight, finish, applyLive])

  const begin = (e: React.PointerEvent, kind: ResizeHandle) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, origin: rect }
    // Seeded immediately so the effect above has a live rect to update and
    // its listeners are attached on this same interaction.
    applyLive(rect)
  }

  return {
    rect: committed,
    dragging: live !== null,
    startResize: (e, handle) => begin(e, handle),
  }
}
