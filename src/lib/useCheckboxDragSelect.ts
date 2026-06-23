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

// Auto-scroll tuning — identical numbers to the grid's fill-handle drag, so
// both gestures feel the same.
const AUTO_SCROLL_ZONE = 56
const AUTO_SCROLL_MAX_SPEED = 18

interface UseCheckboxDragSelectOptions<T> {
  /** The current page/list of items, in the same order they're rendered. */
  items: T[]
  getKey: (item: T) => string
  isSelected: (item: T) => boolean
  /** Flips a single item's checked state (same function a plain click would call). */
  toggle: (key: string) => void
  /** Returns the scrollable panel to auto-scroll near its top/bottom edge
   *  (e.g. the grid's `.ceramic-panel`). Called fresh on every drag start,
   *  so it's safe even if the element isn't mounted yet when this hook runs.
   *  Omit to disable auto-scroll. */
  getScrollContainer?: () => HTMLElement | null
}

/**
 * Click-and-drag multi-select for a column of checkboxes (Excel/Gmail style):
 * mousedown on one checkbox, then drag across others without releasing.
 * Every row between the start and the cursor is set to the same checked
 * state as the very first click — a "paint" gesture. Rows OUTSIDE the
 * dragged span revert to whatever they were before this drag started, so
 * overshooting and dragging back un-paints rows this same drag just set —
 * a true rubber-band selection, not a one-way paint. Rows untouched by this
 * drag are unaffected either way, since their "original" value is already
 * their current one.
 *
 * Also auto-scrolls the panel when the cursor nears its top/bottom edge,
 * matching the grid's fill-handle drag behavior.
 *
 * Consumers must add `data-row-index={index}` to each row (or at least the
 * checkbox cell) so the drag can tell which row the cursor is over.
 */
export function useCheckboxDragSelect<T>({
  items,
  getKey,
  isSelected,
  toggle,
  getScrollContainer,
}: UseCheckboxDragSelectOptions<T>) {
  const dragRef = useRef<{
    startIndex: number
    targetChecked: boolean
    // Snapshot of every row's checked state at drag-start — the fallback
    // for any row currently outside the dragged span.
    original: Map<string, boolean>
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

      // Snapshot every row's current state once. Untouched rows simply have
      // original === current, so they're never affected; rows this drag
      // paints and then retreats past fall back to this original value.
      const original = new Map<string, boolean>()
      items.forEach((item) => original.set(getKey(item), isSelected(item)))
      const current = new Map(original)

      const startKey = getKey(startItem)
      const targetChecked = !original.get(startKey)
      dragRef.current = { startIndex, targetChecked, original, current }

      // eslint-disable-next-line no-console
      console.log(
        `%c[CHECKBOX DRAG] START at index=${startIndex} key=${startKey} targetChecked=${targetChecked}`,
        "color:#34d399;font-weight:bold",
      )

      // Instant feedback for the row the user actually pressed down on
      current.set(startKey, targetChecked)
      toggle(startKey)

      const startClientX = e.clientX
      const startClientY = e.clientY
      let isDragging = false
      let lastClientX = e.clientX
      let lastClientY = e.clientY

      // Geometric hit-test: which row's own vertical span contains this Y?
      // (Horizontal position is irrelevant — any X within the grid works.)
      // Deliberately NOT elementsFromPoint(x, y): grids/lists using this hook
      // can have a few pixels of gap between cells (e.g. CSS grid `gap`), and
      // a fast drag's cursor regularly lands exactly in that gap for a frame
      // — elementsFromPoint then returns the container itself (no
      // data-row-index), silently dropping that move event and leaving
      // whatever row was last detected "stuck". Checking each row's own rect
      // instead is immune to that, and falls back to the nearest row when the
      // cursor IS in a gap, so no move event is ever dropped.
      //
      // Some grids (e.g. the SKU sheet) put data-row-index on every column's
      // cell, not just one per row — dedupe by index so each row's rect is
      // only checked once.
      const rowIndexFromPoint = (_x: number, y: number): number | null => {
        const seen = new Set<number>()
        let best: { index: number; distance: number } | null = null
        let scanned = 0
        for (const el of document.querySelectorAll<HTMLElement>("[data-row-index]")) {
          const idxAttr = el.getAttribute("data-row-index")
          if (idxAttr == null) continue
          const index = parseInt(idxAttr, 10)
          if (seen.has(index)) continue
          seen.add(index)
          scanned++
          const rect = el.getBoundingClientRect()
          if (y >= rect.top && y <= rect.bottom) {
            // eslint-disable-next-line no-console
            console.log(`[CHECKBOX DRAG] hit-test y=${y.toFixed(0)} → EXACT row ${index} (scanned ${scanned} unique rows)`)
            return index
          }
          const distance = y < rect.top ? rect.top - y : y - rect.bottom
          if (!best || distance < best.distance) best = { index, distance }
        }
        // eslint-disable-next-line no-console
        console.log(
          `[CHECKBOX DRAG] hit-test y=${y.toFixed(0)} → NEAREST row ${best?.index ?? "none"} ` +
          `(distance=${best?.distance.toFixed(1) ?? "n/a"}, scanned ${scanned} unique rows)`,
        )
        return best?.index ?? null
      }

      // Has the cursor ever left the anchor row during this drag? `lo`/`hi`
      // below always include startIndex by construction (min/max can never
      // exclude one of their own inputs) — so without this, the anchor row
      // could never be un-painted, no matter how far you retract. Once the
      // drag has genuinely moved away and then fully retracted back onto
      // the anchor, treat that as "nothing painted" (anchor included) —
      // matching the same rubber-band logic as every other row.
      let everExtended = false

      // Re-applies the rubber-band rule for wherever the cursor currently
      // is — called on real mousemove AND on every auto-scroll tick, since
      // scrolling moves rows under a stationary cursor too.
      const paintAt = (x: number, y: number) => {
        const drag = dragRef.current
        if (!drag) return
        const overIndex = rowIndexFromPoint(x, y)
        if (overIndex == null) {
          // eslint-disable-next-line no-console
          console.log("[CHECKBOX DRAG] paintAt: overIndex is NULL — move event dropped, span unchanged")
          return
        }
        if (overIndex !== drag.startIndex) everExtended = true
        const fullyRetracted = everExtended && overIndex === drag.startIndex
        const lo = fullyRetracted ? 1 : Math.min(drag.startIndex, overIndex)
        const hi = fullyRetracted ? 0 : Math.max(drag.startIndex, overIndex)
        // eslint-disable-next-line no-console
        console.log(
          `[CHECKBOX DRAG] paintAt: startIndex=${drag.startIndex} overIndex=${overIndex} → ` +
          `${fullyRetracted ? "FULLY RETRACTED (nothing painted, anchor included)" : `span=[${lo},${hi}]`} targetChecked=${drag.targetChecked}`,
        )

        items.forEach((item, idx) => {
          const key = getKey(item)
          const inSpan = idx >= lo && idx <= hi
          const desired = inSpan ? drag.targetChecked : (drag.original.get(key) ?? false)
          if (drag.current.get(key) !== desired) {
            // eslint-disable-next-line no-console
            console.log(
              `[CHECKBOX DRAG]   toggle idx=${idx} key=${key} ${drag.current.get(key)} → ${desired} ` +
              `(${inSpan ? "in span" : "reverted to original"})`,
            )
            drag.current.set(key, desired)
            toggle(key)
          }
        })
      }

      const scrollPanel = getScrollContainer?.() ?? null
      let scrollSpeed = 0
      let scrollRafId: number | null = null

      const tickScroll = () => {
        if (scrollSpeed !== 0 && scrollPanel) {
          scrollPanel.scrollTop += scrollSpeed
          paintAt(lastClientX, lastClientY)
          scrollRafId = requestAnimationFrame(tickScroll)
        } else {
          scrollRafId = null
        }
      }

      const updateAutoScroll = (clientY: number) => {
        if (!scrollPanel) return
        const rect = scrollPanel.getBoundingClientRect()
        if (clientY < rect.top + AUTO_SCROLL_ZONE) {
          const dist = Math.max(0, clientY - rect.top)
          const intensity = 1 - Math.min(1, dist / AUTO_SCROLL_ZONE)
          scrollSpeed = -Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED)
        } else if (clientY > rect.bottom - AUTO_SCROLL_ZONE) {
          const dist = Math.max(0, rect.bottom - clientY)
          const intensity = 1 - Math.min(1, dist / AUTO_SCROLL_ZONE)
          scrollSpeed = Math.ceil(intensity * AUTO_SCROLL_MAX_SPEED)
        } else {
          scrollSpeed = 0
        }
        if (scrollSpeed !== 0 && scrollRafId == null) {
          scrollRafId = requestAnimationFrame(tickScroll)
        }
      }

      const onMove = (me: MouseEvent) => {
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
          // eslint-disable-next-line no-console
          console.log("[CHECKBOX DRAG] threshold passed — isDragging=true")
        }

        lastClientX = me.clientX
        lastClientY = me.clientY
        updateAutoScroll(me.clientY)
        paintAt(me.clientX, me.clientY)
      }

      const onUp = () => {
        // eslint-disable-next-line no-console
        console.log(
          "[CHECKBOX DRAG] END — final current map:",
          Array.from(dragRef.current?.current.entries() ?? []),
        )
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.body.classList.remove("checkbox-drag-selecting")
        if (scrollRafId != null) cancelAnimationFrame(scrollRafId)
        dragRef.current = null
      }

      document.body.classList.add("checkbox-drag-selecting")
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [items, getKey, isSelected, toggle, getScrollContainer],
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
