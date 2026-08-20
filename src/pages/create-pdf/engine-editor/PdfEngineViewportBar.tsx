import {
  ChevronDownIcon, ChevronUpIcon, MaximizeIcon, ZoomInIcon, ZoomOutIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

/**
 * The floating bar over the bottom of the page.
 *
 * Everything on it is also somewhere in the toolbar, and that is deliberate,
 * not an oversight. These are the controls used WHILE reading — where am I,
 * next page, a bit bigger — and reaching to the top of the screen for them
 * breaks the thing you were doing. Sat over the document, they are always a
 * short movement away from wherever the pointer already is.
 *
 * Translucent and small on purpose: it covers a strip of the page it floats
 * over, so it stays out of the way until looked at.
 */

interface PdfEngineViewportBarProps {
  /** 1-based. */
  currentPage: number
  pageCount: number
  onPreviousPage: () => void
  onNextPage: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitPage: () => void
  /** Effective magnification, 1 = actual size. */
  zoomLevel: number
}

function BarButton({
  label, onClick, disabled, children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-full text-white/90 transition hover:bg-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function PdfEngineViewportBar({
  currentPage, pageCount, onPreviousPage, onNextPage,
  onZoomIn, onZoomOut, onFitPage, zoomLevel,
}: PdfEngineViewportBarProps) {
  const { t } = useTranslation()

  return (
    <div
      data-pdf-viewport-bar
      // pointer-events-none on the positioning layer so the strip of page
      // either side of the bar can still be clicked; the bar itself takes
      // them back.
      className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-800/85 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur">
        <span className="ps-1 pe-1 text-white/70">
          {t("pdfTemplates.enginePageLabel", "Page")}
        </span>
        <BarButton
          label={t("pdfTemplates.enginePreviousPage", "Previous page")}
          onClick={onPreviousPage}
          disabled={currentPage <= 1}
        >
          <ChevronUpIcon className="size-4" />
        </BarButton>
        <span className="min-w-11 text-center tabular-nums">
          {currentPage} / {pageCount}
        </span>
        <BarButton
          label={t("pdfTemplates.engineNextPage", "Next page")}
          onClick={onNextPage}
          disabled={currentPage >= pageCount}
        >
          <ChevronDownIcon className="size-4" />
        </BarButton>

        <span className="mx-1 h-5 w-px bg-white/25" aria-hidden />

        <BarButton label={t("pdfTemplates.engineZoomOut", "Zoom out")} onClick={onZoomOut}>
          <ZoomOutIcon className="size-4" />
        </BarButton>
        <span className="min-w-11 text-center tabular-nums text-white/80">
          {Math.round(zoomLevel * 100)}%
        </span>
        <BarButton label={t("pdfTemplates.engineZoomIn", "Zoom in")} onClick={onZoomIn}>
          <ZoomInIcon className="size-4" />
        </BarButton>
        <BarButton label={t("pdfTemplates.engineFitPage", "Fit page")} onClick={onFitPage}>
          <MaximizeIcon className="size-4" />
        </BarButton>
      </div>
    </div>
  )
}
