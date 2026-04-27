import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCreateProductFromSapMutation, usePreviewProductFromSapMutation } from "@/features/products/api"
import type { SapProductPreview } from "@/features/products/types"

type AddProductFromSapDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type FormValues = {
  sku: string
}

export function AddProductFromSapDialog({ open, onOpenChange }: AddProductFromSapDialogProps) {
  const { t } = useTranslation()
  const previewMutation = usePreviewProductFromSapMutation()
  const createMutation = useCreateProductFromSapMutation()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preview, setPreview] = useState<SapProductPreview | null>(null)

  const form = useForm<FormValues>({
    defaultValues: {
      sku: "",
    },
  })

  const handleSubmit = async (values: FormValues) => {
    setSubmitError(null)
    setPreview(null)
    const trimmedSku = values.sku.trim()
    if (!trimmedSku) {
      setSubmitError(t("products.skuRequired"))
      return
    }

    try {
      const product = await previewMutation.mutateAsync(trimmedSku)
      setPreview(product)
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message)
      } else {
        setSubmitError(t("products.failedToFetchFromSap"))
      }
    }
  }

  const handleAdd = async () => {
    if (!preview) return
    setSubmitError(null)
    try {
      await createMutation.mutateAsync({ sku: preview.sku })
      setPreview(null)
      form.reset()
      onOpenChange(false)
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message)
      } else {
        setSubmitError(t("products.failedToAddFromSap"))
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          form.reset()
          setSubmitError(null)
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("products.addProductFromSap")}</DialogTitle>
          <DialogDescription>
            {t("products.addProductFromSapDesc")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit(handleSubmit)}
        >
          <div className="grid gap-1">
            <Label htmlFor="sku">{t("products.sku")}</Label>
            <Input
              id="sku"
              autoFocus
              placeholder={t("products.enterSapSku")}
              {...form.register("sku", { required: true })}
            />
          </div>

          {preview ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{preview.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("products.sku")}: {preview.sku}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("products.size")}: {preview.size ?? "—"} • {t("products.unitPrice")}: {preview.unitPrice != null ? preview.unitPrice.toFixed(2) : "—"} • {t("products.dealerPrice")}:{" "}
                {preview.dealerPrice != null ? preview.dealerPrice.toFixed(2) : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("products.stock")}: {preview.stockQuantity != null ? preview.stockQuantity : "—"} • Category: {preview.categoryName ?? "—"}
              </p>
            </div>
          ) : null}

          {submitError ? <ErrorMessage>{submitError}</ErrorMessage> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={previewMutation.isPending}>
              {previewMutation.isPending ? t("products.fetching") : t("products.fetchFromSap")}
            </Button>
            <Button type="button" disabled={!preview || createMutation.isPending} onClick={handleAdd}>
              {createMutation.isPending ? t("products.adding") : t("products.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

