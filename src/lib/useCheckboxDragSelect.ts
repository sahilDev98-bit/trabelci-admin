import { useCallback, useRef } from "react"

// Real mouse/trackpad clicks are never perfectly motionless — a few pixels
// of hand tremor between mousedown and mouseup is normal and still fires
// genuine mousemove events. Without a threshold, that tremor alone can
// register as "the cursor moved over a different row" (especially the very
// next/previous row, since rows sit close together), dragging an unrelated
// row into the painted span and toggling it. Requiring real movement before
// engaging the drag logic at all keeps ordinary clicks from ever doing that,
// while a genuine drag — which moves far more than this — is unaffected.
const DRAG_THRESHOLD_PX = 6

interface UseCheckboxDragSelectOptions<T> {
  /** The current page/list of items, in the same order they're rendered. */
  items: T[]
  getKey: (item: T) => string
  isSelected: (item: T) => boolean
  /** Flips a single item's checked state (same function a plain click would call). */
  toggle: (key: string) => void
}

/**
 * Click-and-drag multi-select for a column of checkboxes (Excel/Gmail style):
 * mousedown on one checkbox, then drag across others without releasing, and
 * every row the cursor passes over is set to the same checked state as the
 * very first click — a "paint" gesture. Rows outside the dragged span are
 * never touched (no auto-reverting), so overshooting and dragging back never
 * undoes a row this drag already set, and — critically — never touches rows
 * that have nothing to do with this drag (e.g. one you checked a moment ago
 * in a separate click).
 *
 * Consumers must add `data-row-index={index}` to each row (or at least the
 * checkbox cell) so the drag can tell which row the cursor is over.
 */
export function useCheckboxDragSelect<T>({
  items,
  getKey,
  isSelected,
  toggle,
}: UseCheckboxDragSelectOptions<T>) {
  const dragRef = useRef<{
    startIndex: number
    targetChecked: boolean
    // Local "what we believe this row's checked state is right now" cache —
    // avoids re-reading isSelected() mid-drag (toggle()'s state update isn't
    // necessarily reflected yet) which would risk toggling the same row twice.
    current: Map<string, boolean>
  } | null>(null)

  // The checkbox's native click → onChange still fires after our own
  // mousedown-driven toggle below, even when the click event's
  // preventDefault() is called — confirmed by tracing actual toggle calls in
  // the browser, not just reading the spec. Without this flag a plain single
  // click would toggle twice (once here on mousedown, once via the native
  // onChange) and cancel itself out. This flag tells the checkbox's onChange
  // handler (see handleNativeChange below) to swallow that one redundant
  // call — but only when it was mouse-driven; a keyboard click (Space/Enter)
  // never fires mousedown, so the flag stays false and onChange runs normally.
  const mouseDrivenClickRef = useRef(false)

  const startDrag = useCallback(
    (startIndex: number, e: React.MouseEvent) => {
      e.preventDefault()
      mouseDrivenClickRef.current = true

      const startItem = items[startIndex]
      if (!startItem) return

      const startKey = getKey(startItem)
      const targetChecked = !isSelected(startItem)
      const current = new Map<string, boolean>([[startKey, targetChecked]])
      dragRef.current = { startIndex, targetChecked, current }

      // Instant feedback for the row the user actually pressed down on
      toggle(startKey)

      const startClientX = e.clientX
      const startClientY = e.clientY
      let isDragging = false

      const rowIndexFromPoint = (x: number, y: number): number | null => {
        for (const el of document.elementsFromPoint(x, y)) {
          const cell = (el as HTMLElement).closest?.("[data-row-index]") as HTMLElement | null
          if (cell) {
            const idx = cell.getAttribute("data-row-index")
            if (idx != null) return parseInt(idx, 10)
          }
        }
        return null
      }

      const onMove = (me: MouseEvent) => {
        const drag = dragRef.current
        if (!drag) return

        // Ignore everything until the cursor has genuinely moved — this is
        // what keeps plain click jitter from ever reaching the row-painting
        // logic below. Once a real drag is confirmed it stays confirmed for
        // the rest of this gesture, even if the cursor later settles back
        // near the start point.
        if (!isDragging) {
          const dx = me.clientX - startClientX
          const dy = me.clientY - startClientY
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          isDragging = true
        }

        const overIndex = rowIndexFromPoint(me.clientX, me.clientY)
        if (overIndex == null) return
        const lo = Math.min(drag.startIndex, overIndex)
        const hi = Math.max(drag.startIndex, overIndex)

        // Only set rows within the dragged span — never touch anything
        // outside it, whether that's a row from an earlier interaction or
        // one this same drag passed over and is now overshooting past.
        for (let idx = lo; idx <= hi; idx++) {
          const item = items[idx]
          if (!item) continue
          const key = getKey(item)
          if (drag.current.get(key) !== drag.targetChecked) {
            drag.current.set(key, drag.targetChecked)
            toggle(key)
          }
        }
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.body.classList.remove("checkbox-drag-selecting")
        dragRef.current = null
      }

      document.body.classList.add("checkbox-drag-selecting")
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [items, getKey, isSelected, toggle],
  )

  // Wire this to the checkbox's onChange (instead of calling the row's
  // toggle directly there). If the change was already handled by our own
  // mousedown logic above, swallow it here so it doesn't apply a second,
  // cancelling toggle. Keyboard-driven activation (Space/Enter) never sets
  // the flag, so it falls through and calls toggle normally.
  const handleNativeChange = useCallback(
    (key: string) => {
      if (mouseDrivenClickRef.current) {
        mouseDrivenClickRef.current = false
        return
      }
      toggle(key)
    },
    [toggle],
  )

  return { startDrag, handleNativeChange }
}
