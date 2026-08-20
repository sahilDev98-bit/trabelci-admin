import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"
import { usePageThumbnails } from "./usePageThumbnails"

/**
 * The strip of pages down the left-hand side.
 *
 * A permanent part of the editor rather than the pop-up page organiser we
 * already had. The two answer different questions: the organiser is for
 * REARRANGING pages, and takes over the screen to do it; this is for knowing
 * where you are in a long document and getting somewhere else quickly,
 * which is only useful if it is visible at the same time as the page you
 * are editing.
 *
 * It follows the document both ways — scrolling the pages highlights the
 * page here, and clicking here scrolls the pages — so the two never
 * disagree about which page you are on.
 */

interface PdfEngineThumbnailRailProps {
  doc: UsePdfEngineDocumentResult
  /** 1-based, matching what the toolbar shows. */
  currentPage: number
  onSelectPage: (pageIndex: number) => void
}

export function PdfEngineThumbnailRail({
  doc, currentPage, onSelectPage,
}: PdfEngineThumbnailRailProps) {
  const { t } = useTranslation()
  const { urls } = usePageThumbnails(doc, true)
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Keep the current page's thumbnail in view as the document is scrolled.
  // `nearest` rather than `center`, so scrolling one page along nudges the
  // strip by one page instead of jumping it to the middle every time.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" })
  }, [currentPage])

  return (
    <div
      data-pdf-thumbnail-rail
      className="flex w-48 shrink-0 flex-col border-e bg-background"
      aria-label={t("pdfTemplates.engineThumbnails", "Pages")}
    >
      <div ref={listRef} className="themed-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <ol className="flex flex-col items-center gap-1">
          {doc.pages.map((page, index) => {
            const active = index + 1 === currentPage
            const url = urls[index]
            // Held at the page's real proportions before the picture
            // arrives, so the strip does not reflow as thumbnails fill in.
            const ratio = page.widthPts > 0 ? page.heightPts / page.widthPts : 1.414
            return (
              <li key={index} className="flex flex-col items-center">
                <button
                  ref={active ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelectPage(index)}
                  aria-label={t("pdfTemplates.engineGoToPage", "Go to page {{n}}", { n: index + 1 })}
                  aria-current={active ? "true" : undefined}
                  className={`block w-full overflow-hidden rounded-sm bg-white transition ${
                    active
                      ? "ring-2 ring-primary"
                      : "ring-1 ring-black/10 hover:ring-black/25"
                  }`}
                  style={{ aspectRatio: `1 / ${ratio}` }}
                >
                  {url
                    ? <img src={url} alt="" className="block h-full w-full object-contain" />
                    : <span className="block h-full w-full animate-pulse bg-muted" />}
                </button>
                {/* The number sits UNDER the page rather than on it, where a
                    badge would cover the artwork it is labelling. */}
                <span
                  className={`my-1 min-w-7 rounded-full px-2 py-0.5 text-center text-xs ${
                    active
                      ? "bg-primary font-medium text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {index + 1}
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
