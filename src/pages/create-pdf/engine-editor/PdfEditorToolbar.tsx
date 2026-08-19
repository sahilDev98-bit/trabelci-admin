import {
  ArrowUpDownIcon, CopyIcon, DownloadIcon, ImageIcon, ImagePlusIcon,
  Loader2Icon, MinimizeIcon, MinusIcon, PlusIcon, ScanSearchIcon,
  TextIcon, Trash2Icon, TypeIcon, XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { PdfContentMode, PdfOrganizerMode } from "../PdfEditorRail"
import type { SlotSelection } from "./PdfEnginePageColumn"
import { ZOOM_LEVELS } from "./zoom"

/**
 * The expanded editor's toolbar.
 *
 * Two zones, and the split matters:
 *
 *   - The DOCUMENT tools are always there. Zoom, page tools, add text, add
 *     image. An earlier version swapped these out for the selected item's
 *     tools, which meant that adding an image — which selects it — made
 *     "Add image" disappear, and the only way back was to guess that
 *     clicking blank paper would restore it. Tools you need constantly must
 *     not vanish because you happen to have something selected.
 *
 *   - The SELECTION tools are added alongside when something is selected,
 *     never in place of anything.
 *
 * The text section is where formatting (bold, italic, colour, alignment)
 * will live. It is left visibly empty rather than filled with buttons that
 * do nothing — a disabled control that never becomes enabled is worse than
 * an honest gap.
 */

interface PdfEditorToolbarProps {
  documentName: string
  pageCount: number
  /** 1-based page currently in view. */
  currentPage: number
  /** Effective magnification, 1 = actual size, whatever mode is active. */
  zoomLevel: number
  zoomLabel: string
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomLevel: (level: number) => void
  onFitWidth: () => void
  onFitPage: () => void
  /** Bring the selected slot up to a readable size. */
  onZoomToSelection: () => void
  selection: SlotSelection
  contentMode: PdfContentMode
  onToggleContentMode: () => void
  onAddText: () => void
  onAddImage: () => void
  onOpenOrganizer: (mode: PdfOrganizerMode) => void
  onEditSelectedText: () => void
  onReplaceSelectedImage: () => void
  onReplaceSelectedVector: () => void
  onDeleteSelected: () => void
  /** Clears the selection, so the selection tools fold away again. */
  onDeselect: () => void
  onExit: () => void
  onDownload: () => void
  downloading: boolean
  busy: boolean
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
}

function ToolButton({
  label, icon: Icon, onClick, active, danger,
}: {
  label: string
  icon: typeof TypeIcon
  onClick: () => void
  active?: boolean
  danger?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={active ? "secondary" : "ghost"}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={`size-9 shrink-0 p-0 ${danger ? "text-destructive hover:bg-destructive/10" : ""}`}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function PdfEditorToolbar({
  documentName, pageCount, currentPage,
  zoomLevel, zoomLabel, onZoomIn, onZoomOut, onZoomLevel, onFitWidth, onFitPage,
  onZoomToSelection, selection, contentMode, onToggleContentMode,
  onAddText, onAddImage, onOpenOrganizer,
  onEditSelectedText, onReplaceSelectedImage, onReplaceSelectedVector, onDeleteSelected,
  onDeselect, onExit, onDownload, downloading, busy,
}: PdfEditorToolbarProps) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-pdf-toolbar
        className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-background px-3 py-2"
      >
        <ToolButton
          label={t("pdfTemplates.engineExitFullscreen", "Exit")}
          icon={MinimizeIcon}
          onClick={onExit}
        />
        <span className="ms-1 max-w-56 shrink truncate text-sm font-medium">{documentName}</span>

        <Divider />

        {/* ── Zoom. First, because it is the reason full screen exists: the
            page can now be made big enough to read 3pt text. ── */}
        <ToolButton label={t("pdfTemplates.engineZoomOut", "Zoom out")} icon={MinusIcon} onClick={onZoomOut} />
        <select
          aria-label={t("pdfTemplates.engineZoom", "Zoom")}
          className="h-9 shrink-0 rounded-md border bg-background px-2 text-xs"
          value={zoomLabel}
          onChange={(e) => {
            const v = e.target.value
            if (v === "fit-width") { onFitWidth(); return }
            if (v === "fit-page") { onFitPage(); return }
            onZoomLevel(Number(v))
          }}
        >
          {/* The fit modes report the percentage they work out to, so
              "Fit width" is not an opaque setting. */}
          <option value="fit-width">
            {t("pdfTemplates.engineFitWidth", "Fit width")}
            {zoomLabel === "fit-width" ? ` — ${Math.round(zoomLevel * 100)}%` : ""}
          </option>
          <option value="fit-page">
            {t("pdfTemplates.engineFitPage", "Fit page")}
            {zoomLabel === "fit-page" ? ` — ${Math.round(zoomLevel * 100)}%` : ""}
          </option>
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>{Math.round(z * 100)}%</option>
          ))}
        </select>
        <ToolButton label={t("pdfTemplates.engineZoomIn", "Zoom in")} icon={PlusIcon} onClick={onZoomIn} />
        {selection && (
          <ToolButton
            label={t("pdfTemplates.engineZoomToSelection", "Zoom to selection")}
            icon={ScanSearchIcon}
            onClick={onZoomToSelection}
          />
        )}

        <Divider />

        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {t("pdfTemplates.enginePageOf", "Page {{current}} of {{total}}", {
            current: currentPage, total: pageCount,
          })}
        </span>

        <Divider />

        {/* ── Document tools. ALWAYS present, whatever is selected. ── */}
        <ToolButton
          label={contentMode === "text"
            ? t("pdfTemplates.railTextEditingOn", "Text boxes on")
            : t("pdfTemplates.railTextEditingOff", "Text boxes off")}
          icon={TypeIcon}
          onClick={onToggleContentMode}
          active={contentMode === "text"}
        />
        <ToolButton label={t("pdfTemplates.railAddText", "Add text")} icon={TextIcon} onClick={onAddText} />
        <ToolButton label={t("pdfTemplates.railAddImage", "Add image")} icon={ImagePlusIcon} onClick={onAddImage} />
        <Divider />
        <ToolButton label={t("pdfTemplates.railCopyPage", "Duplicate pages")} icon={CopyIcon} onClick={() => onOpenOrganizer("copy")} />
        <ToolButton label={t("pdfTemplates.railMovePage", "Reorder pages")} icon={ArrowUpDownIcon} onClick={() => onOpenOrganizer("move")} />
        <ToolButton label={t("pdfTemplates.railDeletePages", "Delete pages")} icon={Trash2Icon} onClick={() => onOpenOrganizer("delete")} danger />

        {/* ── Selection tools, ADDED alongside when something is chosen. ──
            Visually grouped so it is obvious they belong to the selection
            and not to the document. */}
        {selection && (
          <div
            data-pdf-toolbar-selection
            className="ms-1 flex shrink-0 items-center gap-1 rounded-md bg-muted/70 px-1.5 py-1"
          >
            {selection.kind === "text" && (
              <>
                <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onEditSelectedText}>
                  <TypeIcon className="size-4" />
                  {t("pdfTemplates.masterEditTextTitle", "Edit text")}
                </Button>
                {/* Formatting lands here — bold, italic, underline, colour,
                    size, alignment, font. An honest gap, not dead buttons. */}
                <span className="px-1 text-xs italic text-muted-foreground">
                  {t("pdfTemplates.engineFormattingSoon", "Formatting tools coming here")}
                </span>
              </>
            )}
            {selection.kind === "image" && (
              <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onReplaceSelectedImage}>
                <ImageIcon className="size-4" />
                {t("pdfTemplates.engineReplaceImage", "Replace image")}
              </Button>
            )}
            {selection.kind === "vector" && (
              <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onReplaceSelectedVector}>
                <ImageIcon className="size-4" />
                {t("pdfTemplates.engineReplaceArtwork", "Replace with image")}
              </Button>
            )}
            <ToolButton label={t("common.delete", "Delete")} icon={Trash2Icon} onClick={onDeleteSelected} danger />
            <ToolButton
              label={t("pdfTemplates.engineDeselect", "Deselect")}
              icon={XIcon}
              onClick={onDeselect}
            />
          </div>
        )}

        <div className="ms-auto flex shrink-0 items-center gap-2">
          {busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          <Button size="sm" onClick={onDownload} disabled={downloading || busy} className="gap-1.5">
            {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {t("pdfTemplates.masterDownload", "Download PDF")}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
