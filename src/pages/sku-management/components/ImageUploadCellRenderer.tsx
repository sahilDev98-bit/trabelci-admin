import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ICellRendererParams } from "ag-grid-community"
import { Loader2, Plus, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { uploadSkuImage, type SkuImageType } from "@/features/skuManagement/api"
import type { SkuMetadataRow } from "@/features/skuManagement/types"

type ImageUploadCellRendererParams = ICellRendererParams<
  SkuMetadataRow,
  string | string[]
> & {
  imageType: SkuImageType
  /** Multiple images per cell (product images) vs a single one (cover/ambience) */
  multiple?: boolean
}

// Spec point 4: image fields are uploads, not typed URLs. The cell opens a
// file picker, sends the file to the backend (which stores it in Cloudflare
// R2) and writes the returned URL(s) into the row via setDataValue — from
// there the normal Save Draft / approve flow persists it like any other field.
export function ImageUploadCellRenderer(params: ImageUploadCellRendererParams) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const multiple = params.multiple ?? false
  const colId = params.column?.getColId()

  const urls: string[] = multiple
    ? Array.isArray(params.value)
      ? params.value
      : []
    : params.value
      ? [params.value as string]
      : []

  const writeValue = (next: string[]) => {
    if (!colId || !params.node) return
    // Goes through AG Grid's edit pipeline → onCellValueChanged → _isDirty
    params.node.setDataValue(colId, multiple ? next : (next[0] ?? ""))
  }

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded: string[] = []
      for (const file of files) {
        const { url } = await uploadSkuImage(
          file,
          params.imageType,
          params.data?.sku || undefined
        )
        uploaded.push(url)
      }
      writeValue(multiple ? [...urls, ...uploaded] : [uploaded[uploaded.length - 1]])
    } catch {
      toast.error(t("sku.grid.imageUploadFailed"))
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = (index: number) => {
    writeValue(urls.filter((_, i) => i !== index))
  }

  return (
    <div className="flex h-full items-center gap-1 overflow-hidden">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) handleFiles(files)
          e.target.value = ""
        }}
      />

      {urls.map((url, index) => (
        <span key={`${url}-${index}`} className="group relative shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title={url.split("/").pop()}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={url}
              alt=""
              className="h-6 w-6 rounded object-cover ring-1 ring-border"
            />
          </a>
          <button
            type="button"
            title={t("sku.grid.removeImage")}
            className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
            onClick={(e) => {
              e.stopPropagation()
              handleRemove(index)
            }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {uploading ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("sku.grid.uploading")}
        </span>
      ) : multiple || urls.length === 0 ? (
        <button
          type="button"
          title={t("sku.grid.uploadImage")}
          className="flex shrink-0 items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:border-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            inputRef.current?.click()
          }}
        >
          {urls.length > 0 ? (
            <Plus className="h-3 w-3" />
          ) : (
            <>
              <Upload className="h-3 w-3" />
              {t("sku.grid.uploadImage")}
            </>
          )}
        </button>
      ) : null}
    </div>
  )
}
