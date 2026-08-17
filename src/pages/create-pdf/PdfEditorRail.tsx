import { useState } from "react"
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ImagePlusIcon,
  RotateCwIcon,
  TextIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * The one job the page organizer dialog is opened to do. Each is a separate
 * entry point on purpose: opening the dialog for "delete" means deleting is
 * the ONLY thing it does there. A single panel that could delete, rotate,
 * copy and move all at once is exactly where a mis-click turns into an
 * accidental edit, so the tool you picked is the tool you get.
 */
export type PdfOrganizerMode = "copy" | "move" | "rotate" | "delete"

/** What clicking on the page itself does in the MAIN view. Page arranging
 * doesn't appear here at all any more — it happens entirely inside the
 * organizer dialog, so the main view never goes half-disabled. */
export type PdfContentMode = "text" | "images"

interface PdfEditorRailProps {
  /** Viewport y (px) to pin the rail's TOP edge to — the customizer measures
   * its own sticky header and passes that header's bottom, so the rail starts
   * on the same line the Download PDF button sits on rather than floating at
   * some arbitrary height. Null until that first measurement lands. */
  top: number | null
  contentMode: PdfContentMode
  onToggleContentMode: () => void
  onOpenOrganizer: (mode: PdfOrganizerMode) => void
  /** Add a free-floating item anywhere on the page — as opposed to editing
   * something the PDF already contained. */
  onAddText: () => void
  onAddImage: () => void
  /**
   * Whether to offer the text-boxes on/off switch.
   *
   * Off by default because the ORIGINAL customizer had it hidden at the
   * client's request (see the switch itself below for why). The PDFium
   * editor opts in: there the switch is how you reach a photo sitting
   * under a caption, since its text layer stacks above the image layer.
   */
  showContentModeToggle?: boolean
  /**
   * Whether to offer page rotation.
   *
   * On by default so the original customizer keeps the tool it has always
   * had. The PDFium editor opts out — rotating pages is not something its
   * users should be able to do.
   */
  showRotate?: boolean
}

// Only used for the very first paint, before the header has been measured
// (see the `top` prop) — app top bar (57px) + the customizer header's own
// resting height. Wrong by at most a few px for a single frame, versus the
// rail visibly jumping in from y=0 if it started unpositioned.
const FALLBACK_TOP_PX = 113

// Fixed (not theme-token) colors for the static container, same reasoning as
// TEXT_OUTLINE/IMAGE_OUTLINE in PdfMasterCustomizer.tsx: this rail floats
// over the page-preview area, which stays a fixed light "paper" background
// (#EEECE6) independent of the app's own light/dark theme — bg-background/
// text-muted-foreground would wash out or invert against it. The buttons
// themselves use Tailwind arbitrary-value classes instead (see below), so
// their hover/focus pseudo-states still work — an inline style would beat
// those classes on specificity and silently kill the hover feedback.
const RAIL_BG = "rgba(255,255,255,0.9)"
const RAIL_BORDER = "1px solid rgba(0,0,0,0.08)"
const RAIL_DIVIDER = "rgba(0,0,0,0.08)"

const BUTTON_BASE =
  "flex size-11 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:ring-offset-2"
// "Off"/neutral button: transparent until hovered. Active is the filled
// near-black below, matching the app's own primary emphasis in light mode
// (rgb(23,23,23)) rather than introducing an unrelated accent hue.
const BUTTON_IDLE = "bg-transparent text-[rgba(0,0,0,0.55)] hover:bg-[rgba(0,0,0,0.06)] hover:text-[rgba(0,0,0,0.75)]"
// "On"/active state for the text on/off switch.
const BUTTON_ACTIVE = "bg-[rgb(23,23,23)] text-white"
// Delete is the one destructive tool, so it hovers red rather than grey —
// the button that removes pages shouldn't feel identical to the one that
// copies them.
const BUTTON_DANGER = "bg-transparent text-[rgba(0,0,0,0.55)] hover:bg-[rgba(185,28,28,0.1)] hover:text-[rgb(185,28,28)]"

/**
 * Floating right-edge tool rail, pinned to the top of the page area (see the
 * `top` prop) so it reads as part of the editor's chrome rather than a
 * free-floating widget.
 *
 * Collapsible: the chevron handle stays put at the top while the tools below
 * it fold away, so the rail never moves position when opened/closed.
 */
export function PdfEditorRail({
  top,
  contentMode,
  onToggleContentMode,
  onOpenOrganizer,
  onAddText,
  onAddImage,
  showContentModeToggle = false,
  showRotate = true,
}: PdfEditorRailProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)

  const pageTools: { mode: PdfOrganizerMode; icon: typeof TypeIcon; label: string; danger?: boolean }[] = [
    { mode: "copy", icon: CopyIcon, label: t("pdfTemplates.railCopyPage") },
    { mode: "move", icon: ArrowUpDownIcon, label: t("pdfTemplates.railMovePage") },
    ...(showRotate
      ? [{ mode: "rotate" as const, icon: RotateCwIcon, label: t("pdfTemplates.railRotatePages") }]
      : []),
    { mode: "delete", icon: Trash2Icon, label: t("pdfTemplates.railDeletePages"), danger: true },
  ]

  return (
    <TooltipProvider delayDuration={300}>
      <div
        // Marked so the page column can measure how much of itself this
        // actually covers. The rail is fixed to the VIEWPORT while the pages
        // sit in a centred, max-width panel, so whether the two overlap at
        // all depends entirely on the window — it cannot be assumed.
        data-pdf-tool-rail
        className="fixed z-30 flex flex-col gap-1.5 rounded-full p-2 shadow-lg backdrop-blur-md"
        style={{ top: top ?? FALLBACK_TOP_PX, insetInlineEnd: 20, background: RAIL_BG, border: RAIL_BORDER }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              className={`${BUTTON_BASE} ${BUTTON_IDLE}`}
            >
              {expanded ? <ChevronUpIcon className="size-4.5" /> : <ChevronDownIcon className="size-4.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {expanded ? t("pdfTemplates.railHideOptions") : t("pdfTemplates.railShowOptions")}
          </TooltipContent>
        </Tooltip>

        {expanded && (
          // Unmounted rather than height-animated: a rounded-full container
          // has no fixed height to animate between, and this reveal reads as
          // instant either way at this size.
          <div className="flex animate-in flex-col gap-1.5 fade-in-0 slide-in-from-top-1 duration-150">
            <div className="mx-auto h-px w-5" style={{ background: RAIL_DIVIDER }} />

            {/* Hidden by default, and was hidden outright on 2026-08-10 at
                the client's request: in the original customizer this switch
                let clicks fall THROUGH to images underneath instead of
                grabbing the text over them, which read as the editor
                ignoring the click.

                The PDFium editor opts back in (showContentModeToggle),
                where it does something different and wanted: its text layer
                deliberately stacks above its image layer so a caption wins
                the click, and turning the text boxes off is the only way to
                reach the photo underneath. */}
            {showContentModeToggle && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={contentMode === "text"}
                    onClick={onToggleContentMode}
                    className={`${BUTTON_BASE} ${contentMode === "text" ? BUTTON_ACTIVE : BUTTON_IDLE}`}
                  >
                    <TypeIcon className="size-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {contentMode === "text" ? t("pdfTemplates.railTextEditingOn") : t("pdfTemplates.railTextEditingOff")}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Adding new content sits with the text switch, above the page
                tools: both are about what's ON a page, whereas the group
                below is about the pages themselves. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onAddText} className={`${BUTTON_BASE} ${BUTTON_IDLE}`}>
                  <TextIcon className="size-4.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("pdfTemplates.railAddText")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={onAddImage} className={`${BUTTON_BASE} ${BUTTON_IDLE}`}>
                  <ImagePlusIcon className="size-4.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t("pdfTemplates.railAddImage")}</TooltipContent>
            </Tooltip>

            <div className="mx-auto h-px w-5" style={{ background: RAIL_DIVIDER }} />

            {pageTools.map(({ mode, icon: Icon, label, danger }) => (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onOpenOrganizer(mode)}
                    className={`${BUTTON_BASE} ${danger ? BUTTON_DANGER : BUTTON_IDLE}`}
                  >
                    <Icon className="size-4.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
