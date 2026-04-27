import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader2, Plus, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  useUploadGalleryImageMutation,
  useDeleteGalleryImageMutation,
} from "@/features/productImages/api"
import { cn } from "@/lib/utils"

interface GallerySectionProps {
  sku: string
  productUrls: string[]
  onImageChange?: () => void
}

export function GallerySection({ sku, productUrls, onImageChange }: GallerySectionProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const uploadMutation = useUploadGalleryImageMutation()
  const deleteMutation = useDeleteGalleryImageMutation()

  /** Upload a single file (shared by file input and drag-drop) */
  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return
      try {
        await uploadMutation.mutateAsync({ sku, file })
        toast.success(t("productDetail.imageUploaded"), {
          description: t("productDetail.imageUploadedDesc"),
        })
        onImageChange?.()
      } catch {
        toast.error(t("productDetail.imageUploadFailed"))
      }
    },
    [sku, uploadMutation, onImageChange, t],
  )

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      )
      // Upload files sequentially to preserve order
      for (const file of files) {
        await uploadFile(file)
      }
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [uploadFile],
  )

  const handleDelete = useCallback(
    async (index: number) => {
      try {
        await deleteMutation.mutateAsync({ sku, index: index + 1 })
        toast.success(t("productDetail.imageDeleted"), {
          description: t("productDetail.imageDeletedDesc"),
        })
        onImageChange?.()
      } catch {
        toast.error(t("productDetail.imageUploadFailed"))
      }
    },
    [sku, deleteMutation, onImageChange, t],
  )

  /** Drag-and-drop handlers */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      )

      // Upload files sequentially to preserve order
      for (const file of files) {
        await uploadFile(file)
      }
    },
    [uploadFile],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("productDetail.galleryImages")}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Drop zone wrapping the entire gallery grid */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            "relative rounded-lg p-3 -m-3 transition-all",
            isDragOver && "ring-2 ring-primary ring-offset-2 bg-primary/5",
          )}
        >
          {productUrls.length === 0 && !uploadMutation.isPending && !isDragOver ? (
            <p className="text-sm text-muted-foreground mb-4">
              {t("productDetail.noGalleryImages")}
            </p>
          ) : null}

          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {productUrls.map((url, index) => (
              <div key={url} className="relative group">
                <button
                  type="button"
                  className="w-24 h-24 rounded-lg border overflow-hidden cursor-pointer"
                  onClick={() => setPreviewUrl(url)}
                >
                  <img
                    src={url}
                    alt={`Gallery ${index + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -end-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity rounded-full"
                  disabled={deleteMutation.isPending}
                  onClick={() => handleDelete(index)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {/* Add image placeholder */}
            <button
              type="button"
              className={cn(
                "w-24 h-24 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors",
                isDragOver
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/30 hover:border-muted-foreground/50",
              )}
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
              ) : isDragOver ? (
                <Upload className="h-6 w-6 text-primary" />
              ) : (
                <Plus className="h-6 w-6 text-muted-foreground" />
              )}
            </button>
          </div>

          {/* Drag overlay */}
          {isDragOver ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none">
              <span className="text-sm font-medium text-primary bg-background/80 px-3 py-1 rounded-md">
                {t("productDetail.dropToAdd")}
              </span>
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelected}
        />

        <Dialog open={previewUrl !== null} onOpenChange={() => setPreviewUrl(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("productDetail.galleryImages")}</DialogTitle>
            </DialogHeader>
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-auto rounded-lg"
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
