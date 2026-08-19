import { useCallback, useEffect, useRef, useState } from "react"

import { PdfEditorToolbar } from "./PdfEditorToolbar"
import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import {
  pageWidthForZoom, zoomLevelOf, stepZoom, zoomToFitSlot, clampZoom,
  type ZoomMode,
} from "./zoom"
import type { SlotSelection } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

/**
 * The editor filling the browser window.
 *
 * An overlay pinned to the viewport — the same shape as the page-organizer
 * dialog — NOT the browser's own full-screen mode, which would also hide the
 * tabs, the address bar and the taskbar. The page gets the window; nothing
 * outside the browser is disturbed.
 *
 * A separate shell rather than a mode inside the windowed editor, wrapping
 * the SAME page column and the same document state. The windowed view keeps
 * working exactly as it did; this one just gives the pages the whole display
 * and puts the tools in a proper toolbar across the top.
 *
 * Two things it must get right, both learned the hard way in the windowed
 * view:
 *   - the pages need the full width, with nothing reserved against a rail
 *     that is not there;
 *   - Escape has to mean "cancel the drag" while dragging, and only mean
 *     "leave full screen" when nothing is in flight.
 */

/** Padding around the page column. Small — the point is to give the paper
 * the screen, not to frame it. */
const PAGE_AREA_PADDING_PX = 16

interface PdfEngineFullscreenProps {
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
    | "documentName" | "pageCount" | "currentPage" | "zoomLevel" | "zoomLabel"
    | "onZoomIn" | "onZoomOut" | "onZoomLevel" | "onFitWidth" | "onFitPage"
    | "onZoomToSelection" | "onExit"
  >
  selection: SlotSelection
}

export function PdfEngineFullscreen({
  doc, documentName, onExit, onDisplayWidthChange, column, toolbar, selection,
}: PdfEngineFullscreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<ZoomMode>({ kind: "fit-width" })
  const [currentPage, setCurrentPage] = useState(1)

  // The page area's real size, measured rather than derived from the window:
  // the toolbar's height depends on how many tools it is showing, which
  // changes with the selection.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setSpace({
      width: Math.max(0, el.clientWidth - PAGE_AREA_PADDING_PX * 2),
      height: Math.max(0, el.clientHeight - PAGE_AREA_PADDING_PX * 2),
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const firstPage = doc.pages[0]
  const displayWidth = firstPage ? pageWidthForZoom(zoom, firstPage, space) : 0
  const level = firstPage ? zoomLevelOf(displayWidth, firstPage) : 1
  const zoomLabel = zoom.kind === "level" ? String(zoom.level) : zoom.kind

  useEffect(() => {
    if (displayWidth > 0) onDisplayWidthChange(displayWidth)
  }, [displayWidth, onDisplayWidthChange])

  /** Which page is in view, for the toolbar's page counter. */
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
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
      data-pdf-fullscreen
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={documentName}
    >
      <PdfEditorToolbar
        {...toolbar}
        documentName={documentName}
        pageCount={doc.pages.length}
        currentPage={currentPage}
        zoomLevel={level}
        zoomLabel={zoomLabel}
        onZoomIn={() => setZoom({ kind: "level", level: stepZoom(level, 1) })}
        onZoomOut={() => setZoom({ kind: "level", level: stepZoom(level, -1) })}
        onZoomLevel={(l) => setZoom({ kind: "level", level: clampZoom(l) })}
        onFitWidth={() => setZoom({ kind: "fit-width" })}
        onFitPage={() => setZoom({ kind: "fit-page" })}
        onZoomToSelection={zoomToSelection}
        onExit={onExit}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-muted/40"
        style={{ padding: PAGE_AREA_PADDING_PX }}
      >
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
  )
}
