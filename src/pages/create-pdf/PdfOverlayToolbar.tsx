import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, BoldIcon, ItalicIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { PdfOverlay, PdfOverlayAlign, PdfSessionFont } from "@/features/pdfTemplates/types"

interface PdfOverlayToolbarProps {
  /** Viewport y to pin the bar to — the same measured header bottom the tool
   * rail uses, so the two read as one layer of chrome. */
  top: number | null
  overlay: PdfOverlay
  /** The document's own embedded faces, offered alongside the bundled
   * default so added text can be made to match the catalogue's typeface. */
  fonts: Record<string, PdfSessionFont>
  availableFontIds: Set<string>
  onChange: (patch: Partial<PdfOverlay>) => void
  onRemove: () => void
}

// Fixed colours, matching the tool rail: this floats over the page-preview
// area, which stays light regardless of the app's theme.
const BAR_BG = "rgba(255,255,255,0.94)"
const BAR_BORDER = "1px solid rgba(0,0,0,0.08)"
const BTN = "flex size-8 items-center justify-center rounded-md transition-colors"
const BTN_IDLE = "text-[rgba(0,0,0,0.6)] hover:bg-[rgba(0,0,0,0.06)]"
const BTN_ON = "bg-[rgb(23,23,23)] text-white"

const ALIGNS: { value: PdfOverlayAlign; icon: typeof AlignLeftIcon }[] = [
  { value: "left", icon: AlignLeftIcon },
  { value: "center", icon: AlignCenterIcon },
  { value: "right", icon: AlignRightIcon },
]

/** Properties for whatever is currently selected. Only the controls that
 * apply to that item's type are shown — an image has no font or alignment,
 * so offering them greyed out would be noise rather than information. */
export function PdfOverlayToolbar({
  top,
  overlay,
  fonts,
  availableFontIds,
  onChange,
  onRemove,
}: PdfOverlayToolbarProps) {
  const { t } = useTranslation()
  const isText = overlay.type === "text"

  return (
    <div
      className="fixed z-40 flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-1.5 shadow-lg backdrop-blur-md animate-in fade-in-0 slide-in-from-top-2 duration-150"
      style={{
        top: (top ?? 113) + 4,
        left: "50%",
        transform: "translateX(-50%)",
        background: BAR_BG,
        border: BAR_BORDER,
      }}
    >
      {isText && (
        <>
          {/* A second way in to the words themselves. Typing directly in the
              box is the primary route, but a box that's been rotated — or
              shrunk to a few points — is genuinely awkward to click into, and
              this always works regardless of how the item is placed. */}
          <input
            type="text"
            value={overlay.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={t("pdfTemplates.overlayTextPlaceholder")}
            className="h-8 w-44 rounded-md border border-[rgba(0,0,0,0.12)] bg-white px-2 text-xs text-[rgba(0,0,0,0.8)] outline-none focus:border-[rgba(0,0,0,0.35)]"
            title={t("pdfTemplates.overlayTextPlaceholder")}
          />

          <select
            value={overlay.fontId}
            onChange={(e) => onChange({ fontId: e.target.value })}
            className="h-8 max-w-40 rounded-md bg-transparent px-1.5 text-xs text-[rgba(0,0,0,0.75)] outline-none"
            title={t("pdfTemplates.overlayFont")}
          >
            <option value="">{t("pdfTemplates.overlayFontDefault")}</option>
            {Object.entries(fonts)
              .filter(([id]) => availableFontIds.has(id))
              .map(([id, font]) => (
                <option key={id} value={id}>{font.name || id}</option>
              ))}
          </select>

          <input
            type="number"
            min={4}
            max={400}
            value={Math.round(overlay.fontSize)}
            onChange={(e) => {
              const next = Number(e.target.value)
              if (Number.isFinite(next) && next > 0) onChange({ fontSize: next })
            }}
            className="h-8 w-14 rounded-md bg-transparent px-1.5 text-xs text-[rgba(0,0,0,0.75)] outline-none"
            title={t("pdfTemplates.overlayFontSize")}
          />

          <input
            type="color"
            value={overlay.color}
            onChange={(e) => onChange({ color: e.target.value })}
            className="size-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
            title={t("pdfTemplates.overlayColor")}
          />

          <button
            type="button"
            onClick={() => onChange({ bold: !overlay.bold })}
            className={`${BTN} ${overlay.bold ? BTN_ON : BTN_IDLE}`}
            title={t("pdfTemplates.overlayBold")}
          >
            <BoldIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onChange({ italic: !overlay.italic })}
            className={`${BTN} ${overlay.italic ? BTN_ON : BTN_IDLE}`}
            title={t("pdfTemplates.overlayItalic")}
          >
            <ItalicIcon className="size-4" />
          </button>

          {ALIGNS.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ align: value })}
              className={`${BTN} ${overlay.align === value ? BTN_ON : BTN_IDLE}`}
              title={t(`pdfTemplates.overlayAlign_${value}`)}
            >
              <Icon className="size-4" />
            </button>
          ))}

          <span className="mx-0.5 h-5 w-px" style={{ background: "rgba(0,0,0,0.1)" }} />
        </>
      )}

      <input
        type="number"
        min={0}
        max={359}
        value={Math.round(overlay.rotation)}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange({ rotation: ((next % 360) + 360) % 360 })
        }}
        className="h-8 w-14 rounded-md bg-transparent px-1.5 text-xs text-[rgba(0,0,0,0.75)] outline-none"
        title={t("pdfTemplates.overlayRotation")}
      />

      <button
        type="button"
        onClick={onRemove}
        className={`${BTN} text-[rgb(185,28,28)] hover:bg-[rgba(185,28,28,0.1)]`}
        title={t("common.delete")}
      >
        <Trash2Icon className="size-4" />
      </button>
    </div>
  )
}
