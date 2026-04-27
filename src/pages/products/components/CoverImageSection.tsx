import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ImagePlus, Trash2, Upload } from "lucide-react"

import {
  useUploadCoverMutation,
  useDeleteCoverMutation,
} from "@/features/productImages/api"
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface CoverImageSectionProps {
  sku: string
  coverUrl: string | null
  onImageChange?: () => void
}

export function CoverImageSection({
  sku,
  coverUrl,
  onImageChange,
}: CoverImageSectionProps) {
  const { t } = useTranslation()

  const uploadMutation = useUploadCoverMutation()
  const deleteMutation = useDeleteCoverMutation()

  const [, setPreviewFile] = useState<File | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const dragCounterRef = useRef(0)

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => { revokeObjectUrl() }
  }, [revokeObjectUrl])

  const displayUrl = objectUrlRef.current ?? coverUrl

  /** Process a file for upload (shared by file input and drag-drop) */
  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return

      revokeObjectUrl()
      const newUrl = URL.createObjectURL(file)
      objectUrlRef.current = newUrl
      setPreviewFile(file)

      uploadMutation.mutate(
        { sku, file },
        {
          onSuccess: () => {
            toast.success(t("productDetail.coverUploaded"), {
              description: t("productDetail.coverUploadedDesc"),
            })
            revokeObjectUrl()
            setPreviewFile(null)
            onImageChange?.()
          },
          onError: () => {
            toast.error(t("productDetail.coverUploadFailed"))
            revokeObjectUrl()
            setPreviewFile(null)
          },
        },
      )
    },
    [sku, uploadMutation, revokeObjectUrl, onImageChange, t],
  )

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) processFile(file)
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [processFile],
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
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragOver(false)

      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile],
  )

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(sku, {
      onSuccess: () => {
        toast.success(t("productDetail.coverDeleted"), {
          description: t("productDetail.coverDeletedDesc"),
        })
        setIsDeleteDialogOpen(false)
        onImageChange?.()
      },
      onError: () => {
        toast.error(t("productDetail.coverUploadFailed"))
        setIsDeleteDialogOpen(false)
      },
    })
  }, [sku, deleteMutation, onImageChange, t])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("productDetail.coverImage")}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drop zone wrapping the image/placeholder */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            "relative w-full max-w-sm rounded-lg transition-all",
            isDragOver && "ring-2 ring-primary ring-offset-2",
          )}
        >
          {displayUrl ? (
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="group relative cursor-pointer w-full"
            >
              <img
                src={displayUrl}
                alt={t("productDetail.coverImage")}
                className="h-48 w-full rounded-lg border object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="text-sm font-medium text-white">
                  {t("productDetail.clickToPreview")}
                </span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex h-48 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/40",
              )}
            >
              {isDragOver ? (
                <>
                  <Upload className="h-10 w-10 text-primary" />
                  <p className="text-sm font-medium text-primary">
                    {t("productDetail.dropHere")}
                  </p>
                </>
              ) : (
                <>
                  <ImagePlus className="h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {t("productDetail.noCoverImage")}
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    {t("productDetail.dragOrClick")}
                  </p>
                </>
              )}
            </button>
          )}

          {/* Drag overlay when dragging over an existing image */}
          {isDragOver && displayUrl ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-primary/20 border-2 border-primary border-dashed">
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-8 w-8 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {t("productDetail.dropToReplace")}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          {t("productDetail.imageRequirements")}
        </p>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <ImagePlus className="me-2 h-4 w-4" />
            {uploadMutation.isPending
              ? t("productDetail.uploading")
              : coverUrl
                ? t("productDetail.replaceCover")
                : t("productDetail.uploadCover")}
          </Button>

          {coverUrl ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="me-2 h-4 w-4" />
              {t("productDetail.deleteCover")}
            </Button>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("productDetail.coverImage")}</DialogTitle>
            </DialogHeader>
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={t("productDetail.coverImage")}
                className="w-full rounded-lg object-contain"
              />
            ) : null}
          </DialogContent>
        </Dialog>

        <ConfirmDeleteDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          title={t("productDetail.deleteCoverConfirm")}
          description={t("productDetail.deleteCoverDesc")}
          onConfirm={handleDeleteConfirm}
          isPending={deleteMutation.isPending}
        />
      </CardContent>
    </Card>
  )
}
