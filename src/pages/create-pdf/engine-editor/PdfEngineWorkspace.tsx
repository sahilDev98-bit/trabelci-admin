import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { PdfEditorToolbar } from "./PdfEditorToolbar"
import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import { PdfEngineThumbnailRail } from "./PdfEngineThumbnailRail"
import { PdfEngineViewportBar } from "./PdfEngineViewportBar"
import {
  pageWidthForZoom, zoomLevelOf, stepZoom, zoomToFitSlot, clampZoom,
  MIN_ZOOM, MAX_ZOOM,
  type ZoomMode,
} from "./zoom"
import {
  anchoredScroll, previewLayout, wheelZoomFactor, ZOOM_SETTLE_MS,
} from "./zoomGesture"
import type { SlotSelection } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

/**
 * The editor, filling the browser window.
 *
 * Pinned to the viewport rather than using the browser's own full-screen
 * mode, which would also hide the tabs, the address bar and the taskbar.
 * The page gets the window; nothing outside the browser is disturbed.
 *
 * This began as a shell that opened on top of a windowed editor, reached
 * through an "Expand" button. That windowed editor is gone: this layout was
 * the one that got approved, so it is simply the editor now, and keeping the
 * old one alongside would have meant two layouts over one document and two
 * sets of interaction bugs to chase.
 *
 * It owns the LAYOUT only — the page strip, the toolbar, the zoom, the bar
 * over the bottom. The document, and every dialog that acts on it, belong to
 * PdfEngineEditorPage.
 */

/** Padding around the page column. Small — the point is to give the paper
 * the screen, not to frame it. */
const PAGE_AREA_PADDING_PX = 16

interface PdfEngineWorkspaceProps {
  doc: UsePdfEngineDocumentResult
  documentName: string
  onExit: () => void
  /** Reports the width pages are drawn at, so work prepared elsewhere (the
   * erase patch behind a dragged slot) matches what is on screen. */
  onDisplayWidthChange: (width: number) => void
  column: Omit<
    React.ComponentProps<typeof PdfEnginePageColumn>,
    "doc" | "displayWidth" | "gutter" | "columnRef"
  >
  toolbar: Omit<
    React.ComponentProps<typeof PdfEditorToolbar>,
    "documentName" | "onZoomToSelection" | "onExit"
  >
  selection: SlotSelection
  /**
   * The product panel, when it is open.
   *
   * Passed in as an element rather than built here because it is bound to the
   * DOCUMENT — which product is chosen, which box gets filled — and this
   * component deliberately knows nothing about either. It takes its place in
   * the layout beside the page area and nothing more.
   */
  panel?: React.ReactNode
}

export function PdfEngineWorkspace({
  doc, documentName, onExit, onDisplayWidthChange, column, toolbar, selection, panel,
}: PdfEngineWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Sized to the SCALED content during a gesture, so the scrollbars match
   * what is on screen — a CSS transform changes no layout, so without this
   * the container would think the document was still its unzoomed size. */
  const trackRef = useRef<HTMLDivElement>(null)
  /** The element the preview transform is applied to. */
  const zoomRef = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<ZoomMode>({ kind: "fit-width" })
  const [currentPage, setCurrentPage] = useState(1)

  /**
   * The gesture in flight, or null between gestures.
   *
   * Held in a ref and written straight to the DOM rather than kept in state
   * on purpose: re-rendering the column costs about 144ms on a real
   * catalogue, and a wheel fires roughly twenty times a second. A gesture
   * must therefore cause NO React render at all — every setState reachable
   * from a wheel event is guarded by this being non-null.
   */
  const gesture = useRef<{ scale: number; naturalWidth: number; naturalHeight: number } | null>(null)
  const settleTimer = useRef<number | null>(null)
  /** Set for exactly one render: the one that lays the real width out. */
  const committing = useRef(false)
  /** Where the view was when the gesture ended, restored after that render
   * so committing the width does not also jump the page. */
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)

  // The page area's real size, measured rather than derived from the window:
  // the toolbar's height depends on how many tools it is showing, which
  // changes with the selection.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      // Never mid-gesture. Zooming in can bring a horizontal scrollbar in,
      // which shrinks this element's content box and would otherwise fire a
      // re-measure — and so a 144ms re-render — in the middle of the roll.
      if (gesture.current) return
      setSpace({
        width: Math.max(0, el.clientWidth - PAGE_AREA_PADDING_PX * 2),
        height: Math.max(0, el.clientHeight - PAGE_AREA_PADDING_PX * 2),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const firstPage = doc.pages[0]
  const displayWidth = firstPage ? pageWidthForZoom(zoom, firstPage, space) : 0
  const level = firstPage ? zoomLevelOf(displayWidth, firstPage) : 1

  /**
   * The committed zoom, readable from the wheel handler.
   *
   * The handler is attached once and must not be re-attached on every zoom
   * change — re-registering a listener mid-gesture drops events — so it
   * reads the current level from here rather than closing over it.
   */
  const levelRef = useRef(level)
  useEffect(() => { levelRef.current = level }, [level])

  useEffect(() => {
    if (displayWidth > 0) onDisplayWidthChange(displayWidth)
  }, [displayWidth, onDisplayWidthChange])

  /** Which page is in view, for the toolbar's page counter. */
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Skipped while zooming: a gesture moves the scroll on every event, and
    // this ends in a setState that would re-render the whole column.
    if (gesture.current) return
    const mid = el.getBoundingClientRect().top + el.clientHeight / 2
    const surfaces = Array.from(el.querySelectorAll<HTMLElement>("[data-engine-page-index]"))
    let best = 0
    let bestDistance = Infinity
    for (const s of surfaces) {
      const r = s.getBoundingClientRect()
      const distance = Math.abs((r.top + r.bottom) / 2 - mid)
      if (distance < bestDistance) {
        bestDistance = distance
        best = Number(s.dataset.enginePageIndex ?? 0)
      }
    }
    setCurrentPage(best + 1)
  }, [])

  /**
   * Put the real width in place, now that the wheel has stopped.
   *
   * The one expensive render of the whole gesture. Everything before it was
   * a transform; this is what makes the page sharp again.
   */
  const commitGesture = useCallback(() => {
    const active = gesture.current
    const scroller = scrollRef.current
    if (!active || !scroller) return
    // Captured BEFORE the render, because clearing the preview changes the
    // scrollable size and the browser would otherwise clamp the offsets.
    pendingScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop }
    committing.current = true
    setZoom({ kind: "level", level: clampZoom(levelRef.current * active.scale) })
  }, [])

  /**
   * Take the preview off, once the real width has been laid out.
   *
   * A layout effect, so it runs after React has written the new width to the
   * DOM but BEFORE the browser paints — the frame where the transform and
   * the new width are both applied, and the document would look twice as
   * big as it should, is never shown.
   *
   * Deliberately has no dependency array: the commit must be undone on the
   * very next render whether or not the width actually changed, and it does
   * not change when the zoom was already at its limit.
   */
  useLayoutEffect(() => {
    if (!committing.current) return
    committing.current = false
    gesture.current = null
    if (zoomRef.current) {
      zoomRef.current.style.transform = ""
      zoomRef.current.style.width = ""
      zoomRef.current.style.marginInline = ""
    }
    if (trackRef.current) {
      trackRef.current.style.width = ""
      trackRef.current.style.height = ""
    }
    const scroller = scrollRef.current
    if (scroller && pendingScroll.current) {
      scroller.scrollLeft = pendingScroll.current.left
      scroller.scrollTop = pendingScroll.current.top
    }
    pendingScroll.current = null
  })

  /**
   * Ctrl (or Cmd) with the wheel zooms, pinned to the pointer.
   *
   * Registered by hand rather than as an onWheel prop because React attaches
   * wheel listeners passively, and a passive listener may not call
   * preventDefault — without which the BROWSER zooms the whole application
   * instead, toolbar and all.
   *
   * A trackpad pinch arrives here too: browsers report it as a wheel event
   * with ctrlKey set, so pinching to zoom works with no extra code.
   */
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    const onWheel = (e: WheelEvent) => {
      // A plain wheel keeps scrolling the document, untouched.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      const zoomEl = zoomRef.current
      const track = trackRef.current
      if (!zoomEl || !track) return

      if (!gesture.current) {
        // Measured once, at the start, while the content is still at its
        // real size. zoomEl shrink-wraps its content, so this is the width
        // of a PAGE and not of the window — which is what makes the preview
        // and the committed layout centre the page identically.
        gesture.current = {
          scale: 1,
          naturalWidth: zoomEl.offsetWidth,
          naturalHeight: zoomEl.offsetHeight,
        }
      }
      const active = gesture.current
      const committed = levelRef.current

      // Clamped against the SAME limits the buttons obey, so the wheel
      // cannot quietly take the page somewhere the renderer refuses to
      // follow — past 400% the page is blown up from a capped bitmap and
      // goes soft, which is the opposite of the point of zooming in.
      const wanted = active.scale * wheelZoomFactor(e.deltaY, e.deltaMode)
      const scale = Math.min(
        MAX_ZOOM / committed,
        Math.max(MIN_ZOOM / committed, wanted),
      )
      const ratio = scale / active.scale
      if (ratio === 1) return

      const box = scroller.getBoundingClientRect()
      const containerWidth = scroller.clientWidth - PAGE_AREA_PADDING_PX * 2
      const from = previewLayout(
        active.naturalWidth, active.naturalHeight, active.scale, containerWidth)
      const to = previewLayout(
        active.naturalWidth, active.naturalHeight, scale, containerWidth)

      const next = anchoredScroll({
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
        pointerX: e.clientX - box.left,
        pointerY: e.clientY - box.top,
        originBefore: { x: PAGE_AREA_PADDING_PX + from.offsetX, y: PAGE_AREA_PADDING_PX },
        originAfter: { x: PAGE_AREA_PADDING_PX + to.offsetX, y: PAGE_AREA_PADDING_PX },
        ratio,
      })

      active.scale = scale
      // The transform is what the eye sees; the track's size is what the
      // scrollbars see. Both are needed — a transform alone leaves the
      // container believing the document never changed size. The width is
      // pinned on zoomEl too, so widening the track cannot stretch it and
      // scale the content twice over.
      zoomEl.style.width = `${active.naturalWidth}px`
      zoomEl.style.marginInline = "0"
      zoomEl.style.transformOrigin = "0 0"
      zoomEl.style.transform = `translateX(${to.offsetX}px) scale(${scale})`
      track.style.width = `${to.trackWidth}px`
      track.style.height = `${to.trackHeight}px`

      // Deliberate synchronous layout, and the reason a fast roll used to
      // lose its anchor: a mouse can deliver several wheel events inside one
      // frame, and until the browser has laid the new track size out it
      // clamps any scroll assignment to the OLD extent. Reading a layout
      // property forces that work now, so the scroll below lands where it
      // was asked to.
      void scroller.scrollHeight

      scroller.scrollLeft = next.scrollLeft
      scroller.scrollTop = next.scrollTop

      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(commitGesture, ZOOM_SETTLE_MS)
    }

    scroller.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      scroller.removeEventListener("wheel", onWheel)
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    }
  }, [commitGesture])

  /**
   * Put a page at the top of the view.
   *
   * Scrolled by arithmetic rather than scrollIntoView: the pages sit inside
   * a padded container, and scrollIntoView aligns to the element's own box,
   * which leaves the page's top edge tight against the toolbar with its
   * margin swallowed.
   */
  const goToPage = useCallback((pageIndex: number) => {
    const scroller = scrollRef.current
    if (!scroller) return
    const target = scroller.querySelector<HTMLElement>(
      `[data-engine-page-index="${pageIndex}"]`)
    if (!target) return
    const delta = target.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
    scroller.scrollTop += delta - PAGE_AREA_PADDING_PX
  }, [])

  /**
   * Bring the selected slot up to a readable size and put it in view.
   *
   * The direct answer to "this caption is 3pt and I cannot read it well
   * enough to edit it" — a quarter of this catalogue's text is under 7pt.
   */
  const zoomToSelection = useCallback(() => {
    if (!selection || selection.kind === "vector") return
    const page = doc.pages[selection.pageIndex]
    if (!page) return
    const box = selection.kind === "text"
      ? doc.pageText[selection.pageIndex]?.lines[selection.index]?.bbox
      : doc.pageImages[selection.pageIndex]?.images[selection.index]?.bbox
    if (!box) return
    setZoom({ kind: "level", level: zoomToFitSlot(box.top - box.bottom) })
    // Scrolled on the next frame, once the pages have been laid out at the
    // new size — scrolling to a position measured at the old zoom lands
    // somewhere else entirely.
    requestAnimationFrame(() => {
      const surface = scrollRef.current
        ?.querySelector<HTMLElement>(`[data-engine-page-index="${selection.pageIndex}"]`)
      surface?.scrollIntoView({ block: "center", inline: "center" })
    })
  }, [selection, doc.pages, doc.pageText, doc.pageImages])

  return (
    <div
      data-pdf-workspace
      className="fixed inset-0 z-50 flex flex-col bg-background"
      // Not a dialog. It was one while it opened ON TOP of a windowed view
      // and could be dismissed back to it; now it is the editor itself, and
      // announcing it as a modal would tell a screen-reader user there is
      // something behind it to return to.
      role="region"
      aria-label={documentName}
    >
      <PdfEditorToolbar
        {...toolbar}
        documentName={documentName}
        onZoomToSelection={zoomToSelection}
        onExit={onExit}
      />

      <div className="flex min-h-0 flex-1">
        <PdfEngineThumbnailRail
          doc={doc}
          currentPage={currentPage}
          onSelectPage={goToPage}
        />

      {/* The page area and its floating bar, in their own positioning
          context. The bar centres itself across whatever it is anchored to,
          so anchoring it to the whole row would push it off-centre by half
          the panel's width the moment the panel opened. */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // dir="ltr" even in Hebrew, and this is not an oversight.
        //
        // A browser numbers a container's horizontal scroll from the reading
        // direction: right-to-left containers report scrollLeft as ZERO at
        // the RIGHT edge and negative going left. Every measurement in here
        // — where the pointer is over the page, where to scroll so a zoom
        // stays pinned to it — is in the page's own physical coordinates,
        // because a sheet of paper does not flip when the interface language
        // does. Left in RTL, zooming under Hebrew threw the page nearly a
        // thousand pixels sideways.
        //
        // Only the scroll axis is fixed here. The toolbar, the page strip and
        // every word of the interface still follow the user's language.
        dir="ltr"
        className="themed-scrollbar min-h-0 flex-1 overflow-auto bg-muted/40"
        style={{ padding: PAGE_AREA_PADDING_PX }}
      >
        {/* w-max min-w-full, not a centring flex box.
            A page zoomed past the width of the window is WIDER than this
            container, and content centred by a flex parent overflows equally
            on both sides — the left half then sits at a negative offset that
            no amount of scrolling can reach, so the left edge of the page
            becomes unreachable exactly when zoom is being used to read it.
            Sizing this track to its content instead keeps both edges inside
            the scrollable area. */}
        <div ref={trackRef} className="w-max min-w-full">
          {/* The preview transform is applied here, and only here.
              w-max so it shrinks to the page rather than the window, and
              mx-auto so a page narrower than the window sits in the middle —
              the preview reproduces both by hand, and they have to match. */}
          <div ref={zoomRef} className="mx-auto w-max">
            {displayWidth > 0 && (
              <PdfEnginePageColumn
                {...column}
                doc={doc}
                displayWidth={displayWidth}
                // Nothing to clear: full screen has no floating rail.
                gutter={0}
              />
            )}
          </div>
        </div>
      </div>

        <PdfEngineViewportBar
          currentPage={currentPage}
          pageCount={doc.pages.length}
          zoomLevel={level}
          onPreviousPage={() => goToPage(Math.max(0, currentPage - 2))}
          onNextPage={() => goToPage(Math.min(doc.pages.length - 1, currentPage))}
          onZoomIn={() => setZoom({ kind: "level", level: stepZoom(level, 1) })}
          onZoomOut={() => setZoom({ kind: "level", level: stepZoom(level, -1) })}
          onFitPage={() => setZoom({ kind: "fit-page" })}
        />
      </div>

        {/* Beside the page area, not over it. A panel floating on top would
            cover the right-hand edge of the paper — which is exactly where a
            catalogue keeps the details being filled in. */}
        {panel}
      </div>
    </div>
  )
}
