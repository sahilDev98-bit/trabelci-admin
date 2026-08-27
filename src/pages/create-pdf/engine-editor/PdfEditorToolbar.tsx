import {
  AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ArrowUpDownIcon,
  BoldIcon, CopyIcon, DownloadIcon, FlipHorizontalIcon, FlipVerticalIcon,
  ArrowLeftIcon, ImageIcon, ImagePlusIcon, ItalicIcon, LibraryIcon, Loader2Icon,
  MinusIcon, PackageSearchIcon, PlusIcon, RotateCcwIcon, RotateCwIcon,
  ScanSearchIcon, Trash2Icon, TypeIcon, TypeOutlineIcon, XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { PdfContentMode, PdfOrganizerMode } from "../pdfEditorTypes"
import type { SlotSelection } from "./PdfEnginePageColumn"

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
  /** Bring the selected slot up to a readable size. The one zoom control
   * that stays: it is an action on the SELECTION, not a way of setting the
   * magnification, and it answers "this caption is 3pt and I cannot see it
   * well enough to edit it". */
  onZoomToSelection: () => void
  selection: SlotSelection
  contentMode: PdfContentMode
  onToggleContentMode: () => void
  onAddText: () => void
  onAddImage: () => void
  /** Shows or hides the asset library. */
  assetPanelOpen: boolean
  onToggleAssetPanel: () => void
  /** Shows or hides the product panel. A toggle rather than a one-way open,
   * because the panel takes real width from the page and someone half way
   * through a layout needs it back. */
  productPanelOpen: boolean
  onToggleProductPanel: () => void
  onOpenOrganizer: (mode: PdfOrganizerMode) => void
  onEditSelectedText: () => void
  onReplaceSelectedImage: () => void
  onReplaceSelectedVector: () => void
  onDeleteSelected: () => void
  /** How the selected line is currently drawn, so the buttons show as
   * pressed rather than guessing. */
  textStyle: { bold: boolean; italic: boolean; color: { r: number; g: number; b: number } } | null
  onToggleBold: () => void
  onToggleItalic: () => void
  onTextColor: (color: { r: number; g: number; b: number }) => void
  onScaleText: (factor: number) => void
  onAlignText: (alignment: "left" | "center" | "right") => void
  onTransformImage: (
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => void
  onTransformVector: (
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => void
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
  documentName,
  onZoomToSelection, selection, contentMode, onToggleContentMode,
  onAddText, onAddImage, assetPanelOpen, onToggleAssetPanel,
  productPanelOpen, onToggleProductPanel, onOpenOrganizer,
  onEditSelectedText, onReplaceSelectedImage, onReplaceSelectedVector,
  textStyle, onToggleBold, onToggleItalic, onTextColor, onScaleText, onAlignText,
  onTransformImage, onTransformVector,
  onDeselect, onExit, onDownload, downloading, busy,
}: PdfEditorToolbarProps) {
  const { t } = useTranslation()

  return (
    <TooltipProvider delayDuration={400}>
      {/*  ONE row, and its height never changes.
           flex-nowrap rather than wrap: wrapping is the same fault as a
           second row by another name — a toolbar one item too long for the
           window would silently become two lines tall and push the document
           down. When it runs out of room it scrolls sideways instead, which
           costs a gesture and never moves the page. */}
      <div
        data-pdf-toolbar
        // h-14 rather than padding around whatever is inside: the selected
        // item's tools sit in a bordered group that is a few pixels taller
        // than a bare button, which was enough to grow the row from 55px to
        // 61px the moment anything was clicked — and the page area is sized
        // from what the toolbar leaves, so the document twitched down and
        // back. A fixed height cannot do that whatever goes in it.
        className="themed-scrollbar flex h-14 shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b bg-background px-3"
      >
          <ToolButton
            label={t("pdfTemplates.engineBackToTemplates", "Templates")}
            icon={ArrowLeftIcon}
            onClick={onExit}
          />
          <span className="ms-1 max-w-56 shrink truncate text-sm font-medium">{documentName}</span>

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
          {/* The two ways to put something NEW on the page, kept together and
              LABELLED rather than left as bare icons.

              "Add text" used to be an icon alone — lucide's TextIcon, which
              actually draws as text-align-start, so it was indistinguishable
              from the Align left button a few controls away. Two different
              actions must not look the same, and for the primary creation
              tools a word is clearer than any glyph could be. */}
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onAddText}
              className="h-8 shrink-0 gap-1.5 px-2"
              // The visible word is short so the toolbar stays compact; the
              // full action stays on the accessible name and the tooltip.
              aria-label={t("pdfTemplates.railAddText", "Add text")}
              title={t("pdfTemplates.railAddText", "Add text")}
            >
              <TypeOutlineIcon className="size-4" />
              <span className="text-xs">{t("pdfTemplates.engineAddTextShort", "Text")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onAddImage}
              className="h-8 shrink-0 gap-1.5 px-2"
              aria-label={t("pdfTemplates.railAddImage", "Add image")}
              title={t("pdfTemplates.railAddImage", "Add image")}
            >
              <ImagePlusIcon className="size-4" />
              <span className="text-xs">{t("pdfTemplates.engineAddImageShort", "Image")}</span>
            </Button>
            {/* The library of logos, icons and badges kept on the server.
                Sits with the other ways of putting something on the page:
                text and pictures come from you, artwork from the shelf,
                product details from the catalogue. */}
            <Button
              type="button"
              size="sm"
              variant={assetPanelOpen ? "secondary" : "ghost"}
              onClick={onToggleAssetPanel}
              aria-pressed={assetPanelOpen}
              className="h-8 shrink-0 gap-1.5 px-2"
              aria-label={t("pdfTemplates.assetPanelTitle", "Asset library")}
              title={t("pdfTemplates.assetPanelTitle", "Asset library")}
            >
              <LibraryIcon className="size-4" />
              <span className="text-xs">{t("pdfTemplates.engineAssetsShort", "Assets")}</span>
            </Button>
            {/* The last way of getting content onto the page, and it belongs
                with the others. Kept in the DOCUMENT tools so it is visible
                before anything is selected — a panel nobody can find until
                they happen to click a caption is a panel nobody uses. */}
            <Button
              type="button"
              size="sm"
              variant={productPanelOpen ? "secondary" : "ghost"}
              onClick={onToggleProductPanel}
              aria-pressed={productPanelOpen}
              className="h-8 shrink-0 gap-1.5 px-2"
              aria-label={t("pdfTemplates.engineProductPanel", "Product details")}
              title={t("pdfTemplates.engineProductPanel", "Product details")}
            >
              <PackageSearchIcon className="size-4" />
              <span className="text-xs">{t("pdfTemplates.engineProductShort", "Product")}</span>
            </Button>
          </div>
          <Divider />
          <ToolButton label={t("pdfTemplates.railCopyPage", "Duplicate pages")} icon={CopyIcon} onClick={() => onOpenOrganizer("copy")} />
          <ToolButton label={t("pdfTemplates.railMovePage", "Reorder pages")} icon={ArrowUpDownIcon} onClick={() => onOpenOrganizer("move")} />
          <ToolButton label={t("pdfTemplates.railDeletePages", "Delete pages")} icon={Trash2Icon} onClick={() => onOpenOrganizer("delete")} danger />

          {/* ── The selected item's own tools, ADDED to this same row. ──
              Never a second row. A row that appears on selection changes the
              toolbar's height, and the page area below it is sized from
              what is left — so clicking a caption shunted the whole document
              down a notch, and clicking away shunted it back. The editor
              twitching every time you pick something up is worse than a long
              row, and the row scrolls sideways if it ever runs out of
              space. ── */}
          {selection && (
            <>
            <ToolButton
              label={t("pdfTemplates.engineZoomToSelection", "Zoom to selection")}
              icon={ScanSearchIcon}
              onClick={onZoomToSelection}
            />

            <Divider />

            {/* ── The selected item's own tools. ──
                Visually grouped so it is obvious they belong to the selection
                and not to the document, whose tools are in the row above and
                stay put whatever is going on down here. */}
            <div
                data-pdf-toolbar-selection
                className="ms-1 flex h-10 shrink-0 items-center gap-1 rounded-md bg-muted/70 px-1.5"
              >
                {selection.kind === "text" && (
                  <>
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onEditSelectedText}>
                      <TypeIcon className="size-4" />
                      {t("pdfTemplates.masterEditTextTitle", "Edit text")}
                    </Button>
                    {/* Formatting. Applied to the text ALREADY in the document
                        rather than redrawing it, so the page keeps its own
                        typeface — see textStyle.ts. */}
                    <ToolButton
                      label={t("pdfTemplates.engineBold", "Bold")}
                      icon={BoldIcon}
                      onClick={onToggleBold}
                      active={textStyle?.bold}
                    />
                    <ToolButton
                      label={t("pdfTemplates.engineItalic", "Italic")}
                      icon={ItalicIcon}
                      onClick={onToggleItalic}
                      active={textStyle?.italic}
                    />
                    <ToolButton
                      label={t("pdfTemplates.engineSmaller", "Smaller")}
                      icon={MinusIcon}
                      onClick={() => onScaleText(1 / 1.15)}
                    />
                    <ToolButton
                      label={t("pdfTemplates.engineBigger", "Bigger")}
                      icon={PlusIcon}
                      onClick={() => onScaleText(1.15)}
                    />
                    <ToolButton label={t("pdfTemplates.engineAlignLeft", "Align left")} icon={AlignLeftIcon} onClick={() => onAlignText("left")} />
                    <ToolButton label={t("pdfTemplates.engineAlignCenter", "Centre")} icon={AlignCenterIcon} onClick={() => onAlignText("center")} />
                    <ToolButton label={t("pdfTemplates.engineAlignRight", "Align right")} icon={AlignRightIcon} onClick={() => onAlignText("right")} />
                    <label
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border"
                      title={t("pdfTemplates.engineTextColor", "Text colour")}
                    >
                      <input
                        type="color"
                        aria-label={t("pdfTemplates.engineTextColor", "Text colour")}
                        className="size-5 cursor-pointer border-0 bg-transparent p-0"
                        value={textStyle
                          ? `#${[textStyle.color.r, textStyle.color.g, textStyle.color.b]
                            .map((n) => n.toString(16).padStart(2, "0")).join("")}`
                          : "#000000"}
                        onChange={(e) => {
                          const hex = e.target.value
                          onTextColor({
                            r: parseInt(hex.slice(1, 3), 16),
                            g: parseInt(hex.slice(3, 5), 16),
                            b: parseInt(hex.slice(5, 7), 16),
                          })
                        }}
                      />
                    </label>
                  </>
                )}
                {selection.kind === "image" && (
                  <>
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onReplaceSelectedImage}>
                      <ImageIcon className="size-4" />
                      {t("pdfTemplates.engineReplaceImage", "Replace image")}
                    </Button>
                    {/* Turning and flipping are matrix changes, so the picture is
                        never re-encoded and loses no quality. */}
                    <ToolButton label={t("pdfTemplates.engineRotateLeft", "Rotate left")} icon={RotateCcwIcon} onClick={() => onTransformImage("rotate-left")} />
                    <ToolButton label={t("pdfTemplates.engineRotateRight", "Rotate right")} icon={RotateCwIcon} onClick={() => onTransformImage("rotate-right")} />
                    <ToolButton label={t("pdfTemplates.engineFlipH", "Flip horizontally")} icon={FlipHorizontalIcon} onClick={() => onTransformImage("flip-horizontal")} />
                    <ToolButton label={t("pdfTemplates.engineFlipV", "Flip vertically")} icon={FlipVerticalIcon} onClick={() => onTransformImage("flip-vertical")} />
                  </>
                )}
                {/* Artwork offers exactly what an image offers. It used to
                    offer only "replace", which made a logo a visibly weaker
                    kind of picture for no reason a user could see — paths
                    turn and scale at least as well as pixels do. */}
                {selection.kind === "vector" && (
                  <>
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onReplaceSelectedVector}>
                      <ImageIcon className="size-4" />
                      {t("pdfTemplates.engineReplaceArtwork", "Replace with image")}
                    </Button>
                    <ToolButton label={t("pdfTemplates.engineRotateLeft", "Rotate left")} icon={RotateCcwIcon} onClick={() => onTransformVector("rotate-left")} />
                    <ToolButton label={t("pdfTemplates.engineRotateRight", "Rotate right")} icon={RotateCwIcon} onClick={() => onTransformVector("rotate-right")} />
                    <ToolButton label={t("pdfTemplates.engineFlipH", "Flip horizontally")} icon={FlipHorizontalIcon} onClick={() => onTransformVector("flip-horizontal")} />
                    <ToolButton label={t("pdfTemplates.engineFlipV", "Flip vertically")} icon={FlipVerticalIcon} onClick={() => onTransformVector("flip-vertical")} />
                  </>
                )}
                {/* No delete here on purpose. A "Delete" sitting a few pixels
                    from "Delete pages" is a genuinely dangerous confusion — one
                    removes a caption, the other removes whole pages. Deleting a
                    selected item is the Delete key, which is where it is in
                    every other canvas editor. */}
                <ToolButton
                  label={t("pdfTemplates.engineDeselect", "Deselect")}
                  icon={XIcon}
                  onClick={onDeselect}
                />
            </div>
            </>
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
