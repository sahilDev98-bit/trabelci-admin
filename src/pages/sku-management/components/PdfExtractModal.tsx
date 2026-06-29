import { useCallback, useRef, useState } from "react"
import { FileText, Upload, X, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Loader2, ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { useSkuExtractFromPdfMutation, type PdfExtractedEntry, type PdfExtractedProduct } from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"

// Maps PDF-extracted field names → SkuMetadataRow field names
const FIELD_MAP: Array<{
  extracted: keyof PdfExtractedProduct
  row: keyof SkuMetadataRow
}> = [
  { extracted: "supplier_name",        row: "supplier"          },
  { extracted: "supplier_code",        row: "supplier_code"     },
  { extracted: "supplier_sku",         row: "supplier_sku"      },
  { extracted: "series",               row: "series"            },
  { extracted: "series_english",       row: "series_en"         },
  { extracted: "color",                row: "color"             },
  { extracted: "color_english",        row: "color_en"          },
  { extracted: "size",                 row: "size"              },
  { extracted: "finish",               row: "finish"            },
  { extracted: "country_of_origin",    row: "country_of_origin" },
  { extracted: "shade",                row: "shade"             },
  { extracted: "quantity_per_carton",  row: "qty_per_carton"    },
  { extracted: "quantity_per_pallet",  row: "qty_per_pallet"    },
  { extracted: "name_english",         row: "display_name_en"   },
]

const REQUIRED_EXTRACTED = [
  "supplier_name", "series", "color", "size", "finish",
  "country_of_origin", "quantity_per_carton", "supplier_code",
]

function entryToRow(entry: PdfExtractedEntry): Partial<SkuMetadataRow> {
  const partial: Partial<SkuMetadataRow> = {}
  for (const { extracted, row } of FIELD_MAP) {
    const val = entry.product[extracted]
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      // @ts-expect-error dynamic field assignment
      partial[row] = String(val)
    }
  }
  return partial
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

interface UploadZoneProps {
  files: File[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
}

function UploadZone({ files, onAdd, onRemove }: UploadZoneProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      )
      if (dropped.length) onAdd(dropped)
    },
    [onAdd]
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/40",
        ].join(" ")}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t("sku.pdfExtract.dropZoneText")}</p>
        <p className="text-xs text-muted-foreground">{t("sku.pdfExtract.dropZoneHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              onAdd(Array.from(e.target.files))
              e.target.value = ""
            }
          }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">
                {(f.size / 1024 / 1024).toFixed(1)} MB
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Review step ──────────────────────────────────────────────────────────────

interface ReviewStepProps {
  entries: PdfExtractedEntry[]
  selected: Set<number>
  onToggle: (index: number) => void
  activeIndex: number
  onSetActive: (index: number) => void
  onUpdate: (entryIndex: number, field: keyof PdfExtractedProduct, value: string) => void
}

function ReviewStep({ entries, selected, onToggle, activeIndex, onSetActive, onUpdate }: ReviewStepProps) {
  const { t, i18n } = useTranslation()
  const isRtl = i18n.dir() === "rtl"
  const active = entries[activeIndex]

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-10 w-10 text-amber-500" />
        <p className="text-sm font-medium">{t("sku.pdfExtract.noProducts")}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {t("sku.pdfExtract.noProductsDesc")}
        </p>
      </div>
    )
  }

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft
  const NextIcon = isRtl ? ChevronLeft : ChevronRight

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* Left: product list */}
      <div className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto">
        {entries.map((entry, i) => {
          const sku = entry.product.supplier_sku || entry.product.supplier_code || `${t("sku.pdfExtract.productOf", { current: i + 1, total: entries.length })}`
          const description = [entry.product.series, entry.product.color, entry.product.size]
            .filter(Boolean)
            .join(" · ")
          const isActive = i === activeIndex
          const isSelected = selected.has(i)

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSetActive(i)}
              className={[
                "flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:border-border hover:bg-muted/40",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium truncate">{sku}</span>
                {entry.complete ? (
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
              </div>
              {description && (
                <span className="truncate text-muted-foreground">{description}</span>
              )}
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(i)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3 w-3 accent-primary"
                />
                <span className={isSelected ? "text-primary" : "text-muted-foreground"}>
                  {isSelected ? t("sku.pdfExtract.selectedLabel") : t("sku.pdfExtract.skipLabel")}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Right: field detail */}
      {active && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {/* Navigator */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => onSetActive(activeIndex - 1)}
              className="flex items-center gap-1 rounded p-1 hover:bg-muted/50 disabled:opacity-30"
            >
              <PrevIcon className="h-3.5 w-3.5" /> {t("sku.pdfExtract.prev")}
            </button>
            <span>
              {t("sku.pdfExtract.productOf", { current: activeIndex + 1, total: entries.length })}
            </span>
            <button
              type="button"
              disabled={activeIndex === entries.length - 1}
              onClick={() => onSetActive(activeIndex + 1)}
              className="flex items-center gap-1 rounded p-1 hover:bg-muted/50 disabled:opacity-30"
            >
              {t("sku.pdfExtract.next")} <NextIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            {active.complete ? (
              <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
                ✓ {t("sku.pdfExtract.complete")}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                {t("sku.pdfExtract.fieldsMissing", { count: active.missing_required.length })}
              </Badge>
            )}
            {active.docs.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t("sku.pdfExtract.from")} {active.docs.join(", ")}
              </span>
            )}
          </div>

          {/* Fields grid */}
          <div className="grid grid-cols-2 gap-2">
            {FIELD_MAP.map(({ extracted }) => {
              const value = active.product[extracted]
              const source = active.sources[extracted]
              const currentStr = value != null ? String(value) : ""
              const isMissingRequired = REQUIRED_EXTRACTED.includes(extracted) && !currentStr.trim()
              const hasValue = currentStr.trim() !== ""
              const label = t(`sku.pdfExtract.fields.${extracted}`)

              return (
                <div
                  key={extracted}
                  className={[
                    "flex flex-col gap-0.5 rounded-md border px-3 py-2 text-xs",
                    isMissingRequired
                      ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                      : hasValue
                      ? "border-green-200 bg-green-50/30 dark:border-green-900 dark:bg-green-950/20"
                      : "border-border bg-muted/20",
                  ].join(" ")}
                >
                  <span className="font-medium text-muted-foreground">{label}</span>
                  <input
                    type="text"
                    value={currentStr}
                    placeholder={isMissingRequired ? t("sku.pdfExtract.requiredNotFound") : "—"}
                    onChange={(e) => onUpdate(activeIndex, extracted, e.target.value)}
                    className={[
                      "bg-transparent font-medium outline-none w-full",
                      "placeholder:font-normal",
                      isMissingRequired
                        ? "placeholder:text-red-400"
                        : "placeholder:text-muted-foreground/40",
                    ].join(" ")}
                  />
                  {source && (
                    <span className="truncate text-muted-foreground/60">{source}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface PdfExtractModalProps {
  open: boolean
  onClose: () => void
  onApprove: (rows: Partial<SkuMetadataRow>[]) => void
}

type Step = "upload" | "review"

export function PdfExtractModal({ open, onClose, onApprove }: PdfExtractModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>("upload")
  const [files, setFiles] = useState<File[]>([])
  const [entries, setEntries] = useState<PdfExtractedEntry[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [activeIndex, setActiveIndex] = useState(0)

  const extract = useSkuExtractFromPdfMutation()

  const handleClose = () => {
    setStep("upload")
    setFiles([])
    setEntries([])
    setSelected(new Set())
    setActiveIndex(0)
    extract.reset()
    onClose()
  }

  const handleAddFiles = (added: File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      const deduped = added.filter((f) => !existing.has(f.name))
      return [...prev, ...deduped]
    })
  }

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleExtract = async () => {
    if (!files.length) return
    const result = await extract.mutateAsync(files)
    const allSelected = new Set(result.products.map((_, i) => i))
    setEntries(result.products)
    setSelected(allSelected)
    setActiveIndex(0)
    setStep("review")
  }

  const handleToggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleUpdate = (entryIndex: number, field: keyof PdfExtractedProduct, value: string) => {
    setEntries((prev) => {
      const next = [...prev]
      const entry = next[entryIndex]
      const updatedProduct = { ...entry.product, [field]: value || null }
      const missing = REQUIRED_EXTRACTED.filter(
        (f) => !updatedProduct[f as keyof PdfExtractedProduct]
      )
      next[entryIndex] = {
        ...entry,
        product: updatedProduct,
        missing_required: missing,
        complete: missing.length === 0,
      }
      return next
    })
  }

  const handleApprove = () => {
    const rows = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => entryToRow(entries[i]))
    onApprove(rows)
    handleClose()
  }

  const selectedCount = selected.size
  const completeCount = entries.filter((e) => e.complete).length
  const incompleteCount = entries.filter((e) => !e.complete).length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent
        className="flex flex-col gap-0 p-0 sm:max-w-3xl"
        style={{ maxHeight: "90vh" }}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {t("sku.pdfExtract.title")}
          </DialogTitle>
          {step === "review" && entries.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("sku.pdfExtract.reviewSummary", {
                complete: completeCount,
                incomplete: incompleteCount,
                selected: selectedCount,
              })}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-hidden px-6 py-4" style={{ minHeight: 0 }}>
          {step === "upload" ? (
            <div className="flex flex-col gap-4">
              <UploadZone files={files} onAdd={handleAddFiles} onRemove={handleRemoveFile} />
              {extract.isError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {extract.error instanceof Error ? extract.error.message : t("sku.pdfExtract.extractionFailed")}
                </p>
              )}
            </div>
          ) : (
            <div style={{ height: "calc(90vh - 200px)" }}>
              <ReviewStep
                entries={entries}
                selected={selected}
                onToggle={handleToggle}
                activeIndex={activeIndex}
                onSetActive={setActiveIndex}
                onUpdate={handleUpdate}
              />
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          {step === "upload" ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExtract}
                disabled={files.length === 0 || extract.isPending}
              >
                {extract.isPending ? (
                  <>
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    {t("sku.pdfExtract.extracting")}
                  </>
                ) : (
                  <>
                    <FileText className="me-1.5 h-4 w-4" />
                    {files.length > 1
                      ? t("sku.pdfExtract.extractButtonPlural", { count: files.length })
                      : t("sku.pdfExtract.extractButton")}
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setStep("upload"); extract.reset() }}
              >
                <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" />
                {t("sku.pdfExtract.back")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleApprove}
                disabled={selectedCount === 0}
              >
                <CheckCircle className="me-1.5 h-4 w-4" />
                {t("sku.pdfExtract.approveButton", { count: selectedCount })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
