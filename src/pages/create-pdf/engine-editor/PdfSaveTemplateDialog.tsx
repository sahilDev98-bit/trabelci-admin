import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { productFieldLabel } from "./productSlots"

/**
 * Saving the page you are looking at as a reusable template.
 *
 * The dialog's real job is not collecting a name — it is showing WHAT is
 * about to be saved. A template is only useful because of its product slots,
 * and a page saved with none is a picture: it can be inserted, but nothing
 * will ever fill it. So the slots are listed, and their absence is said
 * plainly before the save rather than discovered afterwards.
 */

/** The groupings a template can be filed under. Deliberately short: the
 * brief's fourteen "types" are mostly one mechanism with different numbers of
 * products, and a list nobody can choose from is worse than a brief one. */
const CATEGORIES = [
  { id: "product", labelKey: "pdfTemplates.templateCategoryProduct", fallback: "Product page" },
  { id: "grid", labelKey: "pdfTemplates.templateCategoryGrid", fallback: "Product grid" },
  { id: "cover", labelKey: "pdfTemplates.templateCategoryCover", fallback: "Cover" },
  { id: "supplier", labelKey: "pdfTemplates.templateCategorySupplier", fallback: "Supplier opening" },
  { id: "contact", labelKey: "pdfTemplates.templateCategoryContact", fallback: "Contact / final page" },
  { id: "other", labelKey: "pdfTemplates.templateCategoryOther", fallback: "Other" },
] as const

interface PdfSaveTemplateDialogProps {
  open: boolean
  /** Which page is being saved, 1-based, for the heading. */
  pageNumber: number
  pageSize: { widthPts: number; heightPts: number } | null
  /** The field ids marked on that page, in the order they will be stored. */
  slotFieldIds: string[]
  saving: boolean
  onCancel: () => void
  onSave: (details: {
    name: string; description: string; category: string; supplier: string
  }) => void
}

export function PdfSaveTemplateDialog({
  open, pageNumber, pageSize, slotFieldIds, saving, onCancel, onSave,
}: PdfSaveTemplateDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState<string>("product")
  const [supplier, setSupplier] = useState("")

  const mm = (pts: number) => Math.round((pts / 72) * 25.4)
  const trimmedName = name.trim()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("pdfTemplates.saveTemplateTitle", "Save page {{n}} as a template", { n: pageNumber })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">{t("pdfTemplates.saveTemplateName", "Name")}</Label>
            <Input
              id="template-name"
              data-pdf-template-name
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("pdfTemplates.saveTemplateNamePlaceholder", "One product, large photo")}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-category">{t("pdfTemplates.saveTemplateCategory", "Kind of page")}</Label>
              <select
                id="template-category"
                data-pdf-template-category
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{t(c.labelKey, c.fallback)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-supplier">
                {t("pdfTemplates.saveTemplateSupplier", "Supplier (optional)")}
              </Label>
              <Input
                id="template-supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder={t("pdfTemplates.saveTemplateSupplierPlaceholder", "Varmora")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="template-description">
              {t("pdfTemplates.saveTemplateDescription", "Note (optional)")}
            </Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t(
                "pdfTemplates.saveTemplateDescriptionPlaceholder",
                "When to use this layout",
              )}
            />
          </div>

          {/* ── What is actually being saved ──
              The point of the dialog. A template's value IS its product
              slots, and one saved without any can be inserted but never
              filled — so that is said here, before the save, rather than
              discovered when someone tries to use it. */}
          <div data-pdf-template-slots className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium">
              {t("pdfTemplates.saveTemplateSlots", "Product slots on this page")}
            </p>
            {slotFieldIds.length === 0 ? (
              <p className="mt-1 text-xs text-destructive">
                {t(
                  "pdfTemplates.saveTemplateNoSlots",
                  "None. This page can be inserted, but nothing will fill it — mark a box as holding a product detail first.",
                )}
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {slotFieldIds.map((fieldId) => (
                  <span
                    key={fieldId}
                    className="rounded-sm bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                  >
                    {productFieldLabel(t, fieldId)}
                  </span>
                ))}
              </div>
            )}
            {pageSize && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("pdfTemplates.saveTemplateSize", "Page size: {{w}} × {{h}} mm", {
                  w: mm(pageSize.widthPts), h: mm(pageSize.heightPts),
                })}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            data-pdf-template-save
            onClick={() => onSave({
              name: trimmedName, description: description.trim(),
              category, supplier: supplier.trim(),
            })}
            // A template with no name cannot be found again in the library.
            disabled={saving || trimmedName === ""}
            className="gap-1.5"
          >
            {saving && <Loader2Icon className="size-4 animate-spin" />}
            {t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
