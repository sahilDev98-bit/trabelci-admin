import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Dragging a slot across the WHOLE document, not just within its own page.
 *
 * The per-page move this replaces clamped every gesture to the page it
 * started on, so a caption could never reach page 2 — the box simply stuck
 * to the bottom edge. Here the dragged box is detached into a viewport-
 * fixed "ghost" that follows the cursor over page gaps and page breaks
 * alike, and the page it is finally released over becomes the target.
 *
 * Two things make that actually usable:
 *
 *   - Auto-scroll. A 14-page catalogue is far taller than the viewport, so
 *     without the document scrolling itself while the pointer rests near an
 *     edge, "drag it to page 9" would mean holding the button through an
 *     impossible scroll-wheel manoeuvre.
 *
 *   - Re-targeting on every animation frame, not only on pointermove. While
 *     auto-scrolling the pointer is usually STATIONARY — it is the pages
 *     that move underneath it — so a target computed only from move events
 *     would freeze on whichever page was under the cursor when the scroll
 *     began.
 *
 * Every move is routed through here, including one that ends on its
 * starting page. The caller decides what a same-page drop means; keeping
 * one gesture implementation means there is no second, subtly different
 * drag path to keep in step.
 */

export interface CrossPageDragItem {
  kind: "text" | "image"
  /** The page the drag STARTED on. */
  pageIndex: number
  /** Index of the line or image within that page. */
  index: number
  /** Shown inside the ghost so the user can see what they are carrying. */
  label: string
  direction?: "ltr" | "rtl"
  /** Text only: how to DRAW the words in the ghost instead of cropping them.
   * A crop of a text line necessarily brings whatever it sits on along with
   * it — dragging a white caption off a photo carried a rectangle of that
   * photo, which reads as pasting a patch rather than moving the words. */
  fontSizePx?: number
  color?: { r: number; g: number; b: number; a: number }
  /** Images only: the image rendered ON ITS OWN, prepared when the slot was
   * selected. Not a crop of the page — see below. */
  previewUrl?: string
}

/** Where a drag ended, in the TARGET page's own CSS pixels. */
export interface CrossPageDrop {
  item: CrossPageDragItem
  targetPageIndex: number
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
  /** How far the pointer actually travelled, in CSS px. A click on an
   * already-selected box arrives here as a drag of ~0, and the caller uses
   * this to tell the two apart rather than committing a no-op move. */
  travelledPx: number
  /**
   * How wide the target page is ACTUALLY drawn, in CSS px.
   *
   * Reported from the page element itself rather than left for the caller
   * to look up. The caller used to convert this drop into PDF points using
   * its own idea of the page width, which was the WINDOWED measurement —
   * so once the expanded view drew pages at a zoom, every drop landed about
   * 1.8x too far from the corner, and worse the further you zoomed in. The
   * page on screen is the only thing that knows how big the page on screen
   * is, so it is the thing that says.
   */
  targetPageWidthPx: number
}

/** Box position in viewport coordinates, for a `position: fixed` ghost. */
export interface GhostRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CrossPageDragState {
  item: CrossPageDragItem
  ghost: GhostRect
  /** Page currently under the pointer — highlighted as the drop target. */
  targetPageIndex: number | null
  /** A picture of what is being dragged, as a data URL, or null.
   *
   * For images this is the image rendered ON ITS OWN. It used to be a crop
   * of the page canvas, which showed everything painted in that area — so
   * dragging a photo with a caption over it carried the caption in the
   * preview even though only the photo would move. The preview has to show
   * exactly what the drop will do. */
  preview: string | null
}

/** How close to the viewport edge the pointer must get before the document
 * starts scrolling itself. Roughly a thumb's width: large enough to reach
 * without precision, small enough not to trigger on an ordinary drag
 * across the middle of the screen. */
const AUTOSCROLL_EDGE_PX = 110
/** Fastest auto-scroll, in CSS px per animation frame (~60/s), reached only
 * hard against the edge. Fast enough to cross a long document in a few
 * seconds without overshooting the page the user is aiming for. */
const AUTOSCROLL_MAX_STEP_PX = 24

/**
 * The element that actually scrolls.
 *
 * Not assumed: this editor's page column sits inside a container marked
 * `overflow-auto`, but that container has no height constraint from the
 * app's layout, so it grows instead and the WINDOW is what really scrolls.
 * Walking up from a real page element and testing each ancestor for actual
 * overflow finds whichever one it is, and survives the layout changing.
 */
function scrollParentOf(el: Element | null): Element {
  const fallback = document.scrollingElement ?? document.documentElement
  let node: Element | null = el?.parentElement ?? null
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    const scrolls = /(auto|scroll|overlay)/.test(style.overflowY)
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node
    node = node.parentElement
  }
  return fallback
}

function scrollBy(target: Element, dy: number) {
  if (target === document.scrollingElement || target === document.documentElement) {
    window.scrollBy(0, dy)
  } else {
    target.scrollTop += dy
  }
}

/**
 * Shouts if two elements claim to be the same page.
 *
 * That state is not a cosmetic problem: every drag resolves "where is page
 * N?" through the DOM, and the browser answers with the FIRST match — so a
 * second, hidden copy silently hijacks every measurement and the drag simply
 * appears broken, with nothing pointing at the cause. It happened once, when
 * the expanded view was drawn on top of the windowed one instead of
 * replacing it.
 *
 * Checked at the START of a drag only, never per frame, so it costs nothing
 * during the gesture. Dev builds only.
 */
function warnOnDuplicatePages(): void {
  if (!import.meta.env.DEV) return
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const el of document.querySelectorAll<HTMLElement>("[data-engine-page-index]")) {
    const index = el.dataset.enginePageIndex ?? "?"
    if (seen.has(index)) duplicates.add(index)
    seen.add(index)
  }
  if (duplicates.size > 0) {
    console.error(
      "[pdf-engine] Two page columns are mounted at once — pages "
      + `${[...duplicates].join(", ")} appear more than once. Every drag will `
      + "measure whichever copy comes first in the DOM, which is not "
      + "necessarily the one on screen. Render one column at a time.",
    )
  }
}

/** Every rendered page surface, with its live viewport rect. */
function pageRects(): { pageIndex: number; rect: DOMRect }[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-engine-page-index]")).map((el) => ({
    pageIndex: Number(el.dataset.enginePageIndex),
    rect: el.getBoundingClientRect(),
  }))
}

/**
 * Which page a point belongs to.
 *
 * Falls back to the vertically nearest page rather than returning nothing,
 * because the gaps between pages are a real place a pointer can be
 * released, and dropping there should mean "the page you were aiming at",
 * not "nothing happened".
 */
function pageAt(x: number, y: number): number | null {
  const rects = pageRects()
  if (rects.length === 0) return null
  for (const { pageIndex, rect } of rects) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return pageIndex
  }
  let best: { pageIndex: number; distance: number } | null = null
  for (const { pageIndex, rect } of rects) {
    const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
    if (!best || distance < best.distance) best = { pageIndex, distance }
  }
  return best?.pageIndex ?? null
}

export interface UseCrossPageDragResult {
  drag: CrossPageDragState | null
  /** Begin dragging a slot. `rect` is its CURRENT viewport rect, which is
   * what keeps the ghost exactly under the grab point. */
  start: (e: React.PointerEvent, item: CrossPageDragItem, rect: DOMRect) => void
}

export function useCrossPageDrag(onDrop: (drop: CrossPageDrop) => void): UseCrossPageDragResult {
  const [drag, setDrag] = useState<CrossPageDragState | null>(null)
  /** Mirrors `drag` so the gesture's end can read the final position
   * without doing it inside a state updater — an updater must be pure, and
   * onDrop sets state on the caller. */
  const dragRef = useRef<CrossPageDragState | null>(null)
  /** Offset of the pointer INSIDE the box when the drag began, so the box
   * keeps the same relationship to the cursor rather than snapping its
   * corner to it. */
  const grabOffset = useRef({ x: 0, y: 0 })
  const pointer = useRef({ x: 0, y: 0 })
  /** Where the press started, so a release can say how far it travelled. */
  const origin = useRef({ x: 0, y: 0 })
  const scroller = useRef<Element | null>(null)
  const frame = useRef<number | null>(null)
  /** The caller's drop handler, held in a ref so a re-created callback does
   * not become a dependency of the gesture effect below — that effect owns
   * the auto-scroll's animation loop, and re-running it mid-drag cancels
   * the pending frame and stalls the scroll. Kept up to date in an effect
   * rather than assigned during render, which React forbids. */
  const onDropRef = useRef(onDrop)
  useEffect(() => { onDropRef.current = onDrop }, [onDrop])

  const apply = useCallback((next: CrossPageDragState | null) => {
    dragRef.current = next
    setDrag(next)
  }, [])

  /** Recomputes the ghost and the drop target from the last known pointer
   * position. Shared by pointermove and the auto-scroll frame, so a
   * stationary pointer over a scrolling document still re-targets. */
  const reposition = useCallback(() => {
    const current = dragRef.current
    if (!current) return
    const { x, y } = pointer.current
    apply({
      ...current,
      ghost: {
        left: x - grabOffset.current.x,
        top: y - grabOffset.current.y,
        width: current.ghost.width,
        height: current.ghost.height,
      },
      targetPageIndex: pageAt(x, y),
    })
  }, [apply])

  const stopAutoScroll = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const runAutoScroll = useCallback(() => {
    const step = () => {
      frame.current = null
      if (!dragRef.current) return
      const y = pointer.current.y
      // The edges belong to whatever is actually scrolling, not to the
      // window. In the expanded view the page area starts BELOW a toolbar,
      // so measuring from the window put the "scroll up" zone on top of the
      // toolbar — it would scroll while the pointer was over the buttons,
      // and never trigger at the real top of the pages.
      const el = scroller.current
      const isDocument = !el
        || el === document.scrollingElement
        || el === document.documentElement
      const bounds = isDocument
        ? { top: 0, bottom: window.innerHeight }
        : (el as Element).getBoundingClientRect()

      let dy = 0
      if (y < bounds.top + AUTOSCROLL_EDGE_PX) {
        // Proportional: a pointer just inside the zone creeps, one pressed
        // to the very edge moves at full speed. A fixed rate is either too
        // slow to cross a long document or too fast to stop on a page.
        dy = -AUTOSCROLL_MAX_STEP_PX
          * ((bounds.top + AUTOSCROLL_EDGE_PX - y) / AUTOSCROLL_EDGE_PX)
      } else if (y > bounds.bottom - AUTOSCROLL_EDGE_PX) {
        dy = AUTOSCROLL_MAX_STEP_PX
          * ((y - (bounds.bottom - AUTOSCROLL_EDGE_PX)) / AUTOSCROLL_EDGE_PX)
      }
      // Never faster than the zone allows, however far past the edge the
      // pointer goes.
      dy = Math.max(-AUTOSCROLL_MAX_STEP_PX, Math.min(AUTOSCROLL_MAX_STEP_PX, dy))
      if (dy !== 0 && scroller.current) {
        scrollBy(scroller.current, dy)
        // The pages just moved under a stationary cursor, so the target
        // has to be recomputed even though no pointer event fired.
        reposition()
      }
      frame.current = requestAnimationFrame(step)
    }
    if (frame.current === null) frame.current = requestAnimationFrame(step)
  }, [reposition])

  // Keyed on whether a drag is RUNNING, not on the drag object itself.
  // Depending on `drag` re-ran this effect on every pointer move, and its
  // cleanup cancelled the pending animation frame each time — which killed
  // the auto-scroll loop after a single frame, so holding at the edge
  // nudged the document ~20px and then stopped dead. Every callback below
  // is stable, so the listeners are attached once per gesture.
  const active = drag !== null

  useEffect(() => {
    if (!active) return

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
      reposition()
      runAutoScroll()
    }

    const onUp = () => {
      stopAutoScroll()
      const current = dragRef.current
      apply(null)
      if (!current || current.targetPageIndex === null) return
      const surface = document.querySelector<HTMLElement>(
        `[data-engine-page-index="${current.targetPageIndex}"]`,
      )
      if (!surface) return
      const rect = surface.getBoundingClientRect()
      // Reported AFTER clearing the drag state, for the same reason the
      // ghost is mirrored into a ref: onDrop mutates the document and
      // re-renders the pages, which must not happen mid-update.
      onDropRef.current({
        item: current.item,
        targetPageIndex: current.targetPageIndex,
        leftPx: current.ghost.left - rect.left,
        topPx: current.ghost.top - rect.top,
        widthPx: current.ghost.width,
        heightPx: current.ghost.height,
        travelledPx: Math.hypot(
          pointer.current.x - origin.current.x,
          pointer.current.y - origin.current.y,
        ),
        targetPageWidthPx: rect.width,
      })
    }

    /** Escape abandons the drag, leaving the document untouched. Without
     * it a drag begun by accident could only be undone by finishing it and
     * then dragging back. */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      stopAutoScroll()
      apply(null)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      window.removeEventListener("keydown", onKey)
      stopAutoScroll()
    }
  }, [active, reposition, runAutoScroll, stopAutoScroll, apply])

  const start = useCallback((e: React.PointerEvent, item: CrossPageDragItem, rect: DOMRect) => {
    e.preventDefault()
    e.stopPropagation()
    warnOnDuplicatePages()
    pointer.current = { x: e.clientX, y: e.clientY }
    origin.current = { x: e.clientX, y: e.clientY }
    grabOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    scroller.current = scrollParentOf(e.currentTarget as Element)
    apply({
      item,
      ghost: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      targetPageIndex: item.pageIndex,
      // Prepared when the slot was selected, so it is ready by the time a
      // drag begins. Text carries no picture at all — its words are drawn
      // from its own properties instead.
      preview: item.previewUrl ?? null,
    })
  }, [apply])

  return { drag, start }
}
