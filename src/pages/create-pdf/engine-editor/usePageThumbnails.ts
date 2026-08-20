// Small pictures of every page, for the strip down the side.
//
// Two things make this more than a loop over the pages.
//
// The engine is a single worker, and it is also what draws the page you are
// actually looking at. Asking it for fourteen thumbnails at once puts the
// page you are editing behind fourteen jobs. So they are rendered ONE at a
// time, and a render already in flight is abandoned the moment the document
// changes underneath it.
//
// And an edit does not invalidate the whole document. When the engine
// reports which page an edit touched — which it does for every move, resize
// and restyle — only that page is redrawn. Redrawing all of them after every
// nudge would put a steady stream of work in front of the editing itself,
// which is exactly the fault that made dragging stutter before.
import { useEffect, useRef, useState } from "react"

import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

/** Rendered width, in CSS pixels. Enough to recognise a page by its
 * layout and its colour, which is all the strip is for. */
const THUMBNAIL_WIDTH_PX = 150

export interface PageThumbnails {
  /** Page index -> data URL. A page missing from here is still rendering. */
  urls: Record<number, string>
  /** How many are done, for a progress hint on a long document. */
  ready: number
}

export function usePageThumbnails(
  doc: UsePdfEngineDocumentResult,
  enabled: boolean,
): PageThumbnails {
  const [urls, setUrls] = useState<Record<number, string>>({})
  /** Which revision each thumbnail was drawn at, so a page is redrawn only
   * once it is genuinely out of date. */
  const drawnAt = useRef<Record<number, number>>({})
  const pageCount = doc.pages.length
  const revision = doc.revision
  const changedPage = doc.lastChange?.pageIndex ?? null
  const { renderPage } = doc

  useEffect(() => {
    if (!enabled || pageCount === 0) return
    let cancelled = false

    // Which pages are out of date. An edit that named the page it touched
    // invalidates only that one; anything else (a page reorder, a delete, an
    // edit that reported no area) invalidates the lot, because there is no
    // way to know what moved.
    const stale: number[] = []
    for (let i = 0; i < pageCount; i++) {
      const drawn = drawnAt.current[i]
      if (drawn === revision) continue
      if (drawn !== undefined && changedPage !== null && changedPage !== i) {
        // Untouched by this edit: keep the picture and mark it current, so
        // it is not re-rendered again on the next edit either.
        drawnAt.current[i] = revision
        continue
      }
      stale.push(i)
    }
    if (stale.length === 0) return

    const run = async () => {
      for (const index of stale) {
        if (cancelled) return
        const page = doc.pages[index]
        if (!page || page.widthPts <= 0) continue
        const rendered = await renderPage(index, THUMBNAIL_WIDTH_PX / page.widthPts)
        if (cancelled) return
        if (!rendered) continue
        const canvas = document.createElement("canvas")
        canvas.width = rendered.width
        canvas.height = rendered.height
        const ctx = canvas.getContext("2d")
        if (!ctx) continue
        const data = ctx.createImageData(rendered.width, rendered.height)
        data.data.set(new Uint8ClampedArray(rendered.rgba))
        ctx.putImageData(data, 0, 0)
        drawnAt.current[index] = revision
        const url = canvas.toDataURL("image/png")
        // Published one at a time rather than in a batch at the end, so a
        // long document fills in from the top instead of showing nothing
        // and then everything.
        setUrls((prev) => ({ ...prev, [index]: url }))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [enabled, pageCount, revision, changedPage, renderPage, doc.pages])

  // Pages that no longer exist must not leave their old picture behind.
  useEffect(() => {
    setUrls((prev) => {
      const keys = Object.keys(prev).map(Number).filter((i) => i >= pageCount)
      if (keys.length === 0) return prev
      const next = { ...prev }
      for (const k of keys) {
        delete next[k]
        delete drawnAt.current[k]
      }
      return next
    })
  }, [pageCount])

  return { urls, ready: Object.keys(urls).length }
}
