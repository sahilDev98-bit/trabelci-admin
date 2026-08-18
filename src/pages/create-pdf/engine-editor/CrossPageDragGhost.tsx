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
        className={`pointer-events-none fixed z-50 flex items-center overflow-hidden rounded-[2px] shadow-lg ring-2 ring-blue-600 ${
          // The tint reads as "something is being carried" on a bare
          // outline, but muddies a real picture, so it goes when there is
          // one. Slight transparency stays either way, so the page beneath
          // shows through and the drop point is readable.
          // A cropped image needs no tint behind it; drawn text needs no
          // fill either, or the words would sit on a coloured block. Only
          // the bare fallback outline keeps one.
          drag.preview
            ? "opacity-85"
            : drag.item.kind === "text"
              ? "ring-blue-600/70"
              : "bg-blue-500/20 px-1"
        }`}
        style={{
          left: drag.ghost.left,
          top: drag.ghost.top,
          width: drag.ghost.width,
          height: drag.ghost.height,
        }}
        dir={drag.item.direction === "rtl" ? "rtl" : "ltr"}
      >
        {/* An IMAGE travels as its own pixels, cropped from the page — that
            is exactly what an image is. TEXT is drawn from its own size and
            colour instead: a crop would bring the artwork behind the words
            with it, which looks like pasting a patch of the page rather
            than moving the words. */}
        {drag.preview ? (
          <img
            src={drag.preview}
            alt=""
            draggable={false}
            className="pointer-events-none h-full w-full select-none object-fill"
          />
        ) : drag.item.kind === "text" && drag.item.fontSizePx ? (
          <span
            className="w-full select-none overflow-hidden whitespace-nowrap leading-none"
            style={{
              fontSize: `${drag.item.fontSizePx}px`,
              // The document's own colour, so a white caption stays white
              // and a dark one stays dark. The embedded typeface itself is
              // not available to the browser, so a neutral stack stands in
              // for it; size, colour and direction are the properties that
              // make it recognisable at a glance.
              color: drag.item.color
                ? `rgb(${drag.item.color.r} ${drag.item.color.g} ${drag.item.color.b})`
                : undefined,
              textAlign: drag.item.direction === "rtl" ? "right" : "left",
            }}
          >
            {drag.item.label}
          </span>
        ) : (
          <span className="truncate text-[11px] leading-none text-blue-900">{drag.item.label}</span>
        )}
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
