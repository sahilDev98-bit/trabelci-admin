import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  PAGE_SIZE_PRESETS, matchPreset, orientationOf, resolvePageSize,
  type PageOrientation,
} from "./pageSizes"

/**
 * Choosing what a new blank page should be.
 *
 * Adding a page used to be one click that silently copied the neighbour's
 * size. That is right most of the time — a catalogue is usually one size
 * throughout — and wrong exactly when it matters: a landscape spread in a
 * portrait document, or an A3 pull-out.
 *
 * So the neighbour's size is still the default and is still one Enter away,
 * but the other answers are now reachable instead of impossible.
 */

interface PdfAddPageDialogProps {
  open: boolean
  /** The page the new one will follow — its size is the default. */
  afterPage: { widthPts: number; heightPts: number } | null
  afterPageNumber: number
  onCancel: () => void
  onAdd: (size: { widthPts: number; heightPts: number }) => void
}

export function PdfAddPageDialog({
  open, afterPage, afterPageNumber, onCancel, onAdd,
}: PdfAddPageDialogProps) {
  const { t } = useTranslation()

  /** "Same as the page you are on" is its own choice rather than a preset,
   * because a document's pages are often a size no standard has a name for
   * and copying it exactly is more useful than naming it approximately. */
  const [presetId, setPresetId] = useState<string>("same")
  const [orientation, setOrientation] = useState<PageOrientation>("portrait")

  // Re-derived rather than stored: the dialog can be opened from any page,
  // and remembering the last page's orientation would be wrong on the next.
  const suggested = useMemo(() => {
    if (!afterPage) return { preset: null, orientation: "portrait" as PageOrientation }
    return {
      preset: matchPreset(afterPage.widthPts, afterPage.heightPts),
      orientation: orientationOf(afterPage.widthPts, afterPage.heightPts),
    }
  }, [afterPage])

  const chosen = useMemo(() => {
    if (presetId === "same" && afterPage) {
      return { widthPts: afterPage.widthPts, heightPts: afterPage.heightPts }
    }
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === presetId) ?? PAGE_SIZE_PRESETS[0]
    return resolvePageSize(preset, orientation)
  }, [presetId, orientation, afterPage])

  const mm = (pts: number) => Math.round((pts / 72) * 25.4)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pdfTemplates.addPageTitle", "Add a blank page")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-page-size">{t("pdfTemplates.addPageSize", "Page size")}</Label>
            <select
              id="add-page-size"
              data-pdf-add-page-size
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value)
                // Picking a named size starts from the way the current page
                // is turned, which is nearly always what is wanted.
                if (e.target.value !== "same") setOrientation(suggested.orientation)
              }}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {afterPage && (
                <option value="same">
                  {t("pdfTemplates.addPageSame", "Same as page {{n}}", { n: afterPageNumber })}
                  {" — "}
                  {suggested.preset ? suggested.preset.label : `${mm(afterPage.widthPts)} × ${mm(afterPage.heightPts)} mm`}
                </option>
              )}
              {PAGE_SIZE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label} — {preset.detail}
                </option>
              ))}
            </select>
          </div>

          {/* Orientation is meaningless for "same as the page you are on" —
              that page already has one — so it is not offered there rather
              than offered and ignored. */}
          {presetId !== "same" && (
            <div className="space-y-1.5">
              <Label>{t("pdfTemplates.addPageOrientation", "Orientation")}</Label>
              <div className="flex gap-2">
                {(["portrait", "landscape"] as PageOrientation[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-pdf-add-page-orientation={value}
                    aria-pressed={orientation === value}
                    onClick={() => setOrientation(value)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      orientation === value ? "border-primary bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="border-2 border-current"
                      style={value === "portrait"
                        ? { width: 12, height: 16 }
                        : { width: 16, height: 12 }}
                    />
                    {value === "portrait"
                      ? t("pdfTemplates.addPagePortrait", "Portrait")
                      : t("pdfTemplates.addPageLandscape", "Landscape")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* What is actually about to be made, in millimetres. A size in
              points means nothing to anyone choosing paper. */}
          <p data-pdf-add-page-summary className="text-xs text-muted-foreground">
            {t("pdfTemplates.addPageSummary", "New page: {{w}} × {{h}} mm", {
              w: mm(chosen.widthPts), h: mm(chosen.heightPts),
            })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={() => onAdd(chosen)}>{t("common.add", "Add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
