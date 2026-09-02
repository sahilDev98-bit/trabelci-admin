import {
  AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ArrowUpDownIcon,
  BoldIcon, CopyIcon, DownloadIcon, FlipHorizontalIcon, FlipVerticalIcon,
  ArrowLeftIcon, ImageIcon, ImagePlusIcon, ItalicIcon, LayersIcon, LibraryIcon, Loader2Icon,
  MinusIcon, PackageSearchIcon, PlusIcon, RedoIcon, RotateCcwIcon, RotateCwIcon,
  ScanSearchIcon, Trash2Icon, TypeIcon, TypeOutlineIcon, UndoIcon,
  FilePlusIcon, LockIcon, LockOpenIcon, CopyPlusIcon, CropIcon, XIcon,
  PanelLeftCloseIcon, PanelLeftOpenIcon, BookmarkPlusIcon, LayoutTemplateIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { PdfContentMode, PdfOrganizerMode } from "../pdfEditorTypes"
import type { SlotSelection } from "./PdfEnginePageColumn"
import { fixedLabelForKind } from "./productSlots"

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
  /** How many slots are selected. Above one, the toolbar offers the tools
   * that MEAN something for several things at once and hides the rest —
   * "Edit text" or a colour picker cannot act on a picture and a caption
   * together, and a button that silently ignores most of your selection is
   * worse than one that is not there. */
  selectionCount: number
  /** Which product detail the selected box holds, or null for fixed text.
   * This is what a template is built from — see productSlots.ts. */
  selectionSlotField: string | null
  onSetSlotField: (fieldId: string | null) => void
  /** What this KIND of box may hold: a picture can only be the photo, a line
   * of text can be any of the written details. */
  slotFieldOptions: { id: string; labelKey: string; labelFallback: string }[]
  /** Turn or mirror the whole selection as one shape. */
  onTransformGroup: (
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => boolean
  contentMode: PdfContentMode
  onToggleContentMode: () => void
  onAddText: () => void
  onAddImage: () => void
  /** Shows or hides the strip of page thumbnails down the side. It takes
   * real width from the page, and someone laying out a spread wants that
   * width back — so it is a toggle, not a fixture. */
  thumbnailRailOpen: boolean
  onToggleThumbnailRail: () => void
  /** Shows or hides the asset library. */
  assetPanelOpen: boolean
  onToggleAssetPanel: () => void
  /** Shows or hides the library of saved page designs. Shares the start edge
   * with the asset shelf, so opening one closes the other. */
  templatePanelOpen: boolean
  onToggleTemplatePanel: () => void
  /** Shows or hides the product panel. A toggle rather than a one-way open,
   * because the panel takes real width from the page and someone half way
   * through a layout needs it back. */
  productPanelOpen: boolean
  onToggleProductPanel: () => void
  /** The layers list. Shares the right-hand side with the product panel, so
   * opening one closes the other. */
  layersPanelOpen: boolean
  onToggleLayersPanel: () => void
  onOpenOrganizer: (mode: PdfOrganizerMode) => void
  /** Step the document back and forward. Disabled rather than hidden when
   * there is nowhere to go: a control that disappears is one you have to
   * hunt for, and its absence says nothing about why. */
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** Insert a blank page after the one in view. */
  onAddPage: () => void
  /** Save the page in view as a reusable template, with its product slots. */
  onSaveTemplate: () => void
  /** Whether the SELECTED slot is locked, and the toggle for it. Locks are a
   * property of this editing session; a PDF has nowhere to store one. */
  selectionLocked: boolean
  onToggleLock: () => void
  /** Copy the selected slot, offset from the original. */
  onDuplicate: () => void
  /** Trim the selected picture. Pictures only — there is nothing to trim on
   * a line of text or a path. */
  cropping: boolean
  onToggleCrop: () => void
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
  /**
   * Redraw the selected line in a chosen typeface.
   *
   * "document" keeps the page's own — the default, and the thing that stops
   * a heading changing when you edit it. The rest are the faces bundled with
   * the editor, for when you deliberately want something different.
   */
  onSetFont: (face: "document" | "regular" | "bold" | "hebrew") => void
  onAlignText: (alignment: "left" | "center" | "right") => void
  /** Turn or mirror the selected line of text. Text had none of these while
   * pictures and artwork had all four, so a sideways caption — a catalogue
   * spine, a vertical label — could not be made at all. */
  onTransformText: (
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => void
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
  label, icon: Icon, onClick, active, danger, disabled, iconClassName,
}: {
  label: string
  icon: typeof TypeIcon
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  /** For an icon that POINTS somewhere. Most do not, but one that shows a
   * panel on the left is wrong in Hebrew, where the panel is on the right. */
  iconClassName?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={active ? "secondary" : "ghost"}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={`size-9 shrink-0 p-0 ${danger ? "text-destructive hover:bg-destructive/10" : ""}`}
        >
          <Icon className={`size-4 ${iconClassName ?? ""}`} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function PdfEditorToolbar({
  documentName,
  onZoomToSelection, selection, selectionCount, onTransformGroup,
  selectionSlotField, onSetSlotField, slotFieldOptions,
  contentMode, onToggleContentMode,
  onAddText, onAddImage, thumbnailRailOpen, onToggleThumbnailRail,
  assetPanelOpen, onToggleAssetPanel, templatePanelOpen, onToggleTemplatePanel,
  productPanelOpen, onToggleProductPanel,
  layersPanelOpen, onToggleLayersPanel, onOpenOrganizer,
  canUndo, canRedo, onUndo, onRedo, onAddPage, onSaveTemplate,
  selectionLocked, onToggleLock, onDuplicate, cropping, onToggleCrop,
  onEditSelectedText, onReplaceSelectedImage, onReplaceSelectedVector,
  textStyle, onToggleBold, onToggleItalic, onTextColor, onScaleText, onSetFont, onAlignText,
  onTransformText, onTransformImage, onTransformVector,
  onDeselect, onExit, onDownload, downloading, busy,
}: PdfEditorToolbarProps) {
  const { t } = useTranslation()
  const fixedLabel = fixedLabelForKind(selection?.kind ?? "text")

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

          {/* The page thumbnails, shown or hidden. Placed here, at the very
              start of the row, because that is the edge it controls — a
              button for the left-hand strip buried among the right-hand
              panel toggles is a button nobody finds.

              The icon POINTS, so it is mirrored in Hebrew, where the strip
              is on the other side. */}
          <ToolButton
            label={thumbnailRailOpen
              ? t("pdfTemplates.engineHidePages", "Hide page thumbnails")
              : t("pdfTemplates.engineShowPages", "Show page thumbnails")}
            icon={thumbnailRailOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            iconClassName="rtl:-scale-x-100"
            onClick={onToggleThumbnailRail}
            active={thumbnailRailOpen}
          />

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
            <Button
              type="button"
              size="sm"
              variant={layersPanelOpen ? "secondary" : "ghost"}
              onClick={onToggleLayersPanel}
              aria-pressed={layersPanelOpen}
              className="h-8 shrink-0 gap-1.5 px-2"
              aria-label={t("pdfTemplates.layersPanelTitle", "Layers")}
              title={t("pdfTemplates.layersPanelTitle", "Layers")}
            >
              <LayersIcon className="size-4" />
              <span className="text-xs">{t("pdfTemplates.engineLayersShort", "Layers")}</span>
            </Button>
          <Divider />
          {/* Undo sits with the DOCUMENT tools, not the selection's: it
              applies to the last thing that happened whether or not anything
              is selected, and it is the control people reach for fastest. */}
          <ToolButton
            label={t("pdfTemplates.engineUndo", "Undo")}
            icon={UndoIcon}
            onClick={onUndo}
            disabled={!canUndo}
          />
          <ToolButton
            label={t("pdfTemplates.engineRedo", "Redo")}
            icon={RedoIcon}
            onClick={onRedo}
            disabled={!canRedo}
          />
          <Divider />
          <ToolButton
            label={t("pdfTemplates.engineAddPage", "Add blank page")}
            icon={FilePlusIcon}
            onClick={onAddPage}
          />
          <ToolButton label={t("pdfTemplates.railCopyPage", "Duplicate pages")} icon={CopyIcon} onClick={() => onOpenOrganizer("copy")} />
          <ToolButton label={t("pdfTemplates.railMovePage", "Reorder pages")} icon={ArrowUpDownIcon} onClick={() => onOpenOrganizer("move")} />
          <ToolButton label={t("pdfTemplates.railDeletePages", "Delete pages")} icon={Trash2Icon} onClick={() => onOpenOrganizer("delete")} danger />

          {/* The library of saved page designs, beside the tool that fills
              it. Applying a template and saving one are the two halves of the
              same idea, so they sit together rather than in separate corners. */}
          <Button
            type="button"
            size="sm"
            variant={templatePanelOpen ? "secondary" : "ghost"}
            onClick={onToggleTemplatePanel}
            aria-pressed={templatePanelOpen}
            className="h-8 shrink-0 gap-1.5 px-2"
            aria-label={t("pdfTemplates.templatePanelTitle", "Page templates")}
            title={t("pdfTemplates.templatePanelTitle", "Page templates")}
          >
            <LayoutTemplateIcon className="size-4" />
            <span className="text-xs">{t("pdfTemplates.engineTemplatesShort", "Templates")}</span>
          </Button>

          {/* Saving the page as a template. Sits with the PAGE tools rather
              than the selection tools: it acts on the whole page in view, and
              belongs beside the other things that do. */}
          <ToolButton
            label={t("pdfTemplates.saveTemplate", "Save page as template")}
            icon={BookmarkPlusIcon}
            onClick={onSaveTemplate}
          />

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
                {/* ── Several things selected ──
                    The per-kind tools below are hidden, because they cannot
                    honestly act on a mixed selection: "Edit text" has no
                    meaning for a photo, cropping has none for a caption, and
                    a colour picker showing ONE line's colour while three
                    things are selected states something untrue.

                    What remains is everything that genuinely applies to
                    several objects at once — turning, mirroring, copying,
                    locking, deleting — plus a count, so it is never a
                    mystery how much is about to be affected. */}
                {selectionCount > 1 && (
                  <>
                    <span className="shrink-0 px-1 text-xs font-medium text-muted-foreground">
                      {t("pdfTemplates.engineSelectedCount", "{{count}} selected", { count: selectionCount })}
                    </span>
                    <ToolButton label={t("pdfTemplates.engineRotateLeft", "Rotate left")} icon={RotateCcwIcon} onClick={() => onTransformGroup("rotate-left")} />
                    <ToolButton label={t("pdfTemplates.engineRotateRight", "Rotate right")} icon={RotateCwIcon} onClick={() => onTransformGroup("rotate-right")} />
                    <ToolButton label={t("pdfTemplates.engineFlipH", "Flip horizontally")} icon={FlipHorizontalIcon} onClick={() => onTransformGroup("flip-horizontal")} />
                    <ToolButton label={t("pdfTemplates.engineFlipV", "Flip vertically")} icon={FlipVerticalIcon} onClick={() => onTransformGroup("flip-vertical")} />
                  </>
                )}
                {selectionCount <= 1 && selection.kind === "text" && (
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
                    {/* Typeface. A native select rather than a styled menu:
                        it is four options that change rarely, and it stays
                        the same height as the buttons beside it, which the
                        toolbar's fixed row depends on. */}
                    <select
                      data-pdf-font-select
                      defaultValue="document"
                      onChange={(e) => {
                        onSetFont(e.target.value as "document" | "regular" | "bold" | "hebrew")
                        // Reset, because this is an ACTION rather than a
                        // setting: the control cannot know what the line is
                        // drawn in after an undo, and a stale value shown as
                        // if it were the truth is worse than none.
                        e.target.value = "document"
                      }}
                      aria-label={t("pdfTemplates.engineFont", "Typeface")}
                      title={t("pdfTemplates.engineFont", "Typeface")}
                      className="h-8 shrink-0 rounded-md border bg-background px-1 text-xs"
                    >
                      <option value="document">{t("pdfTemplates.engineFontDocument", "Page's own font")}</option>
                      <option value="regular">{t("pdfTemplates.engineFontRegular", "Standard")}</option>
                      <option value="bold">{t("pdfTemplates.engineFontBold", "Standard bold")}</option>
                      <option value="hebrew">{t("pdfTemplates.engineFontHebrew", "Hebrew")}</option>
                    </select>
                    <ToolButton label={t("pdfTemplates.engineAlignLeft", "Align left")} icon={AlignLeftIcon} onClick={() => onAlignText("left")} />
                    <ToolButton label={t("pdfTemplates.engineAlignCenter", "Centre")} icon={AlignCenterIcon} onClick={() => onAlignText("center")} />
                    <ToolButton label={t("pdfTemplates.engineAlignRight", "Align right")} icon={AlignRightIcon} onClick={() => onAlignText("right")} />
                    {/* The same four a picture has. Turning text moves the
                        glyphs; it does not re-wrap the words down the page,
                        which is what "rotate" means for something already
                        drawn. */}
                    <ToolButton label={t("pdfTemplates.engineRotateLeft", "Rotate left")} icon={RotateCcwIcon} onClick={() => onTransformText("rotate-left")} />
                    <ToolButton label={t("pdfTemplates.engineRotateRight", "Rotate right")} icon={RotateCwIcon} onClick={() => onTransformText("rotate-right")} />
                    <ToolButton label={t("pdfTemplates.engineFlipH", "Flip horizontally")} icon={FlipHorizontalIcon} onClick={() => onTransformText("flip-horizontal")} />
                    <ToolButton label={t("pdfTemplates.engineFlipV", "Flip vertically")} icon={FlipVerticalIcon} onClick={() => onTransformText("flip-vertical")} />
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
                {selectionCount <= 1 && selection.kind === "image" && (
                  <>
                    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5" onClick={onReplaceSelectedImage}>
                      <ImageIcon className="size-4" />
                      {t("pdfTemplates.engineReplaceImage", "Replace image")}
                    </Button>
                    {/* Turning and flipping are matrix changes, so the picture is
                        never re-encoded and loses no quality. */}
                    <ToolButton
                      label={t("pdfTemplates.engineCrop", "Crop")}
                      icon={CropIcon}
                      onClick={onToggleCrop}
                      active={cropping}
                    />
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
                {selectionCount <= 1 && selection.kind === "vector" && (
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
                {/* ── What this box holds. ──
                    The foundation of templates: a box marked "this is the
                    SKU" stops being text that happens to read 100201305 and
                    becomes a place any product's SKU can go.

                    Only for ONE box at a time. Marking several at once would
                    mean giving them all the same field, and a page cannot
                    have four SKU slots. */}
                {selectionCount <= 1 && (
                  <select
                    data-pdf-slot-field
                    value={selectionSlotField ?? ""}
                    onChange={(e) => onSetSlotField(e.target.value || null)}
                    aria-label={t("pdfTemplates.productSlotField", "Holds product detail")}
                    title={t(
                      "pdfTemplates.productSlotFieldHint",
                      "Mark this box as holding one of the product's details",
                    )}
                    className={`h-8 shrink-0 rounded-md border px-1 text-xs ${
                      selectionSlotField ? "border-primary bg-primary/10" : "bg-background"
                    }`}
                  >
                    {/* Named for the KIND of box selected. "Fixed text" in
                        front of a photograph reads as though the editor
                        thinks the picture is writing. */}
                    <option value="">
                      {t(fixedLabel.key, fixedLabel.fallback)}
                    </option>
                    {slotFieldOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t(option.labelKey, option.labelFallback)}
                      </option>
                    ))}
                  </select>
                )}

                {/* Both apply to text, pictures and artwork alike, so they
                    sit outside the per-kind blocks above. */}
                <ToolButton
                  label={t("pdfTemplates.engineDuplicate", "Duplicate")}
                  icon={CopyPlusIcon}
                  onClick={onDuplicate}
                />
                <ToolButton
                  label={selectionLocked
                    ? t("pdfTemplates.engineUnlock", "Unlock")
                    : t("pdfTemplates.engineLock", "Lock in place")}
                  icon={selectionLocked ? LockIcon : LockOpenIcon}
                  onClick={onToggleLock}
                  active={selectionLocked}
                />
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
