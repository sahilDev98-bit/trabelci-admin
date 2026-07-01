import { useCallback, useRef } from "react"

const DRAG_THRESHOLD_PX = 6
const AUTO_SCROLL_ZONE = 56
const AUTO_SCROLL_MAX_SPEED = 18

interface UseCheckboxDragSelectOptions<T> {
  /** The current page/list of items, in the same order they're rendered. */
  items: T[]
  getKey: (item: T) => string
  isSelected: (item: T) => boolean
  /** Flips a single item's checked state (same function a plain click would call). */
  toggle: (key: string) => void
  /** Returns the scrollable panel to auto-scroll near its top/bottom edge. */
  getScrollContainer?: () => HTMLElement | null
}

/**
 * Click-and-drag multi-select for a column of checkboxes (Excel/Gmail style).
 *
 * Performance design:
 *
 * The grid can have 6 000+ rows all in the DOM. Any React state update during
 * drag causes a full re-render of every row — at this scale that takes
 * 100–200 ms per move event, making drag completely unusable.
 *
 * Solution:
 *   1. Row rects + checkbox <input> elements captured ONCE at drag start.
 *   2. During drag: visual feedback via direct DOM (.checked on <input>).
 *      Zero React state updates — zero re-renders.
 *   3. On mouseup: commit all changes by calling toggle() once per changed key
 *      synchronously. React 18 auto-batches all setState calls in the same
 *      task → exactly ONE re-render for the entire drag.
 *   4. Hit-testing uses binary search on the pre-built sorted rect array.
 *   5. paintAt processes only the delta (rows entering/leaving the span).
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
    original: Map<string, boolean>
    current: Map<string, boolean>
    prevLo: number
    prevHi: number
    prevFullyRetracted: boolean
    rowRects: Array<{ index: number; top: number; bottom: number }>
    // Checkbox <input> per row index — used for zero-React visual feedback
    checkboxEls: Map<number, HTMLInputElement>
  } | null>(null)

  // Suppresses the native onChange that fires after our mousedown-driven DOM
  // toggle — prevents the click from double-toggling the start row.
  const mouseDrivenClickRef = useRef(false)

  const startDrag = useCallback(
    (startIndex: number, e: React.MouseEvent) => {
      e.preventDefault()
      mouseDrivenClickRef.current = true

      const startItem = items[startIndex]
      if (!startItem) return

      const original = new Map<string, boolean>()
      items.forEach((item) => original.set(getKey(item), isSelected(item)))
      const current = new Map(original)

      const startKey = getKey(startItem)
      const targetChecked = !original.get(startKey)

      // ── Build rect index + checkbox element map (once, at drag start) ────────
      // The grid puts data-row-index on every cell, so we dedupe by index.
      // Capturing everything here (one querySelectorAll + getBoundingClientRect
      // pass) instead of re-querying on every mousemove is what makes drag
      // smooth at large row counts.
      const seenIdx = new Set<number>()
      const rowRects: Array<{ index: number; top: number; bottom: number }> = []
      const checkboxEls = new Map<number, HTMLInputElement>()

      for (const el of document.querySelectorAll<HTMLElement>("[data-row-index]")) {
        const attr = el.getAttribute("data-row-index")
        if (attr == null) continue
        const idx = parseInt(attr, 10)
        if (!seenIdx.has(idx)) {
          seenIdx.add(idx)
          const rect = el.getBoundingClientRect()
          rowRects.push({ index: idx, top: rect.top, bottom: rect.bottom })
        }
        // Grab the checkbox input if this element contains one and we haven't
        // stored one for this row yet
        if (!checkboxEls.has(idx)) {
          const input = el.querySelector<HTMLInputElement>("input.ceramic-checkbox")
          if (input) checkboxEls.set(idx, input)
        }
      }
      rowRects.sort((a, b) => a.top - b.top)

      dragRef.current = {
        startIndex,
        targetChecked,
        original,
        current,
        prevLo: startIndex,
        prevHi: startIndex,
        prevFullyRetracted: false,
        rowRects,
        checkboxEls,
      }

      // Instant visual feedback for the pressed row — DOM only, no React
      current.set(startKey, targetChecked)
      const startEl = checkboxEls.get(startIndex)
      if (startEl) startEl.checked = targetChecked

      const startClientX = e.clientX
      const startClientY = e.clientY
      let isDragging = false
      let lastClientX = e.clientX
      let lastClientY = e.clientY

      // ── Binary search hit-test — O(log n) per call ───────────────────────────
      const rowIndexFromPoint = (_x: number, y: number): number | null => {
        const rects = dragRef.current?.rowRects
        if (!rects?.length) return null

        let lo = 0
        let hi = rects.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          const r = rects[mid]
          if (y < r.top) hi = mid - 1
          else if (y > r.bottom) lo = mid + 1
          else return r.index
        }

        // Cursor in a gap — pick the closer adjacent entry
        const a = rects[Math.max(0, lo - 1)]
        const b = rects[Math.min(rects.length - 1, lo)]
        if (!a) return b?.index ?? null
        if (!b) return a.index
        const da = y < a.top ? a.top - y : y - a.bottom
        const db = y < b.top ? b.top - y : y - b.bottom
        return da <= db ? a.index : b.index
      }

      let everExtended = false

      // ── Delta paint — DOM only, O(delta) per move ────────────────────────────
      // Only rows that entered or left the active span are touched.
      // No React state is updated here — changes are committed in onUp.
      const paintAt = (x: number, y: number) => {
        const drag = dragRef.current
        if (!drag) return
        const overIndex = rowIndexFromPoint(x, y)
        if (overIndex == null) return

        if (overIndex !== drag.startIndex) everExtended = true
        const fullyRetracted = everExtended && overIndex === drag.startIndex

        const newLo = fullyRetracted ? 1 : Math.min(drag.startIndex, overIndex)
        const newHi = fullyRetracted ? 0 : Math.max(drag.startIndex, overIndex)

        const { prevLo, prevHi, prevFullyRetracted } = drag
        if (newLo === prevLo && newHi === prevHi && fullyRetracted === prevFullyRetracted) return

        drag.prevLo = newLo
        drag.prevHi = newHi
        drag.prevFullyRetracted = fullyRetracted

        // Union of old and new spans — only rows within this range can change
        const unionLo = Math.min(
          prevFullyRetracted ? Infinity  : prevLo,
          fullyRetracted     ? Infinity  : newLo,
        )
        const unionHi = Math.max(
          prevFullyRetracted ? -Infinity : prevHi,
          fullyRetracted     ? -Infinity : newHi,
        )

        for (let idx = unionLo; idx <= unionHi; idx++) {
          const inNew  = !fullyRetracted     && idx >= newLo  && idx <= newHi
          const inPrev = !prevFullyRetracted && idx >= prevLo && idx <= prevHi
          if (inNew === inPrev) continue

          const item = items[idx]
          if (!item) continue
          const key = getKey(item)
          const desired = inNew ? drag.targetChecked : (drag.original.get(key) ?? false)

          if (drag.current.get(key) !== desired) {
            drag.current.set(key, desired)
            // Direct DOM update — zero React re-renders during drag
            const el = drag.checkboxEls.get(idx)
            if (el) el.checked = desired
          }
        }
      }

      const scrollPanel = getScrollContainer?.() ?? null
      let scrollSpeed = 0
      let scrollRafId: number | null = null
      let lastScrollTop = scrollPanel?.scrollTop ?? 0

      const tickScroll = () => {
        if (scrollSpeed !== 0 && scrollPanel) {
          scrollPanel.scrollTop += scrollSpeed
          // Shift cached rects by the scroll delta so hit-testing stays
          // accurate without touching the DOM
          const newScrollTop = scrollPanel.scrollTop
          const delta = lastScrollTop - newScrollTop
          lastScrollTop = newScrollTop
          if (dragRef.current && delta !== 0) {
            for (const r of dragRef.current.rowRects) {
              r.top += delta
              r.bottom += delta
            }
          }
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
        if (!isDragging) {
          const dx = me.clientX - startClientX
          const dy = me.clientY - startClientY
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          isDragging = true
        }
        lastClientX = me.clientX
        lastClientY = me.clientY
        updateAutoScroll(me.clientY)
        paintAt(me.clientX, me.clientY)
      }

      const onUp = () => {
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.body.classList.remove("checkbox-drag-selecting")
        if (scrollRafId != null) cancelAnimationFrame(scrollRafId)

        const drag = dragRef.current
        dragRef.current = null

        if (!drag) return

        // Commit all changes to React state in one synchronous block.
        // React 18 auto-batches every setState call here → exactly 1 re-render
        // for the whole drag, no matter how many rows were touched.
        for (const [key, checked] of drag.current) {
          if (checked !== (drag.original.get(key) ?? false)) {
            toggle(key)
          }
        }
      }

      document.body.classList.add("checkbox-drag-selecting")
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [items, getKey, isSelected, toggle, getScrollContainer],
  )

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
