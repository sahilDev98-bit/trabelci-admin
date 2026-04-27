import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { apiFetch } from "@/lib/apiClient"
import { toast } from "sonner"

type ImportProductsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStartImport: () => void
}

type ImportResponse = {
  success: boolean
  importedCount: number
  failedCount: number
  failed: { sku: string; reason: string }[]
}

export function ImportProductsDialog({
  open,
  onOpenChange,
  onStartImport,
}: ImportProductsDialogProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!file) {
      // Basic guard; UI feedback handled via parent toast
      return
    }

    // Notify parent and close the dialog immediately
    onStartImport()
    onOpenChange(false)

    setIsSubmitting(true)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await apiFetch<ImportResponse>(API_ENDPOINTS.PRODUCTS_IMPORT_FROM_SAP, {
        method: "POST",
        body: formData,
      })

      toast.success(t("products.importCompleted"), {
        description: t("products.importCompletedDesc", { imported: res.importedCount, failed: res.failedCount }),
        // position: "top-center",
        id: "products-import",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t("products.failedToImportFromSap")
      toast.error(t("products.importFailed"), {
        description: message,
        // position: "top-center",
        id: "products-import",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("products.importFromSap")}</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing a <code>sku</code> column. For each SKU, the server will fetch the
            product from SAP and upsert it into Supabase.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="products-import-file"
              className="inline-flex cursor-pointer items-center justify-center rounded-md border border-dashed border-primary/60 bg-primary/5 px-4 py-3 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/10"
            >
              {file ? t("products.selectedFile", { name: file.name }) : t("products.chooseCsvFile")}
            </label>
            <input
              id="products-import-file"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const nextFile = e.target.files?.[0] ?? null
                setFile(nextFile)
              }}
            />
            <p className="text-xs text-muted-foreground">
              The file must include a header row with a <code>sku</code> column.
            </p>
          </div>

          {/* Any errors and summaries are shown via global toast in the parent */}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t("common.close")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? t("products.importing") : t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

