import { useTranslation } from "react-i18next"

import type { CrossPageDragState } from "./useCrossPageDrag"

/**
 * The box in flight during a cross-page drag, plus a readout of where it
 * would land.
 *
 * Its own component rather than markup inside the editor so the self test
 * can mount the exact thing the user sees. A test that reproduced this
 * markup instead would keep passing after the real ghost broke.
 *
 * Fixed to the VIEWPORT rather than positioned within a page, which is the
 * whole point: an element inside a page would be clipped at that page's
 * edge and could never be seen crossing a page break.
 */
export function CrossPageDragGhost({ drag }: { drag: CrossPageDragState | null }) {
  const { t } = useTranslation()
  if (!drag) return null

  return (
    <>
      <div
        data-engine-drag-ghost
        // pointer-events off: the ghost sits directly under the cursor, so
        // without this it would be the element every hit-test found and no
        // page could ever be the drop target.
        className="pointer-events-none fixed z-50 flex items-center overflow-hidden rounded-[2px] bg-blue-500/20 px-1 shadow-lg ring-2 ring-blue-600"
        style={{
          left: drag.ghost.left,
          top: drag.ghost.top,
          width: drag.ghost.width,
          height: drag.ghost.height,
        }}
        dir={drag.item.direction === "rtl" ? "rtl" : "ltr"}
      >
        <span className="truncate text-[11px] leading-none text-blue-900">{drag.item.label}</span>
      </div>

      {/* Which page it would land on, said in words. The ring drawn on the
          target page is easy to miss while the eye follows the cursor, and
          on a long document that page's edges are often off-screen. */}
      {drag.targetPageIndex !== null && (
        <div
          data-engine-drag-target
          className="pointer-events-none fixed bottom-6 start-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow-lg"
        >
          {drag.targetPageIndex === drag.item.pageIndex
            ? t("pdfTemplates.engineDragSamePage", "Page {{page}}", { page: drag.targetPageIndex + 1 })
            : t("pdfTemplates.engineDragToPage", "Move to page {{page}}", { page: drag.targetPageIndex + 1 })}
        </div>
      )}
    </>
  )
}
