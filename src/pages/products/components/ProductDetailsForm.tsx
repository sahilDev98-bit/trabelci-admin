import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useUpdateProductMutation } from "@/features/products/api"
import type { Product } from "@/features/products/types"

interface ProductDetailsFormProps {
  product: Product
}

interface FormValues {
  name: string
  size: string
  unitPrice: string
  dealerPrice: string
  stockQuantity: string
}

function buildDefaultValues(product: Product): FormValues {
  return {
    name: product.name,
    size: product.size ?? "",
    unitPrice: product.unitPrice != null ? String(product.unitPrice) : "",
    dealerPrice: product.dealerPrice != null ? String(product.dealerPrice) : "",
    stockQuantity: product.stockQuantity != null ? String(product.stockQuantity) : "",
  }
}

export function ProductDetailsForm({ product }: ProductDetailsFormProps) {
  const { t } = useTranslation()
  const updateMutation = useUpdateProductMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty, errors },
  } = useForm<FormValues>({
    defaultValues: buildDefaultValues(product),
  })

  // Reset form when product data changes externally (e.g. after SAP refresh)
  useEffect(() => {
    reset(buildDefaultValues(product))
  }, [product, reset])

  const onSubmit = async (values: FormValues) => {
    try {
      await updateMutation.mutateAsync({
        id: product.id,
        name: values.name.trim(),
        size: values.size.trim() || null,
        unitPrice: values.unitPrice ? Number(values.unitPrice) : null,
        dealerPrice: values.dealerPrice ? Number(values.dealerPrice) : null,
        stockQuantity: values.stockQuantity ? Number(values.stockQuantity) : null,
      })
      toast.success(t("productDetail.changesSaved"), {
        description: t("productDetail.changesSavedDesc"),
      })
    } catch {
      toast.error(t("productDetail.saveFailed"))
    }
  }

  const handleCancel = () => {
    reset(buildDefaultValues(product))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("productDetail.productDetails")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{t("common.name")} *</Label>
            <Input
              id="name"
              {...register("name", { required: true })}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{t("common.required")}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="size">{t("products.size")}</Label>
            <Input id="size" {...register("size")} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="unitPrice">{t("products.unitPrice")}</Label>
              <Input
                id="unitPrice"
                type="number"
                step="any"
                {...register("unitPrice")}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dealerPrice">{t("products.dealerPrice")}</Label>
              <Input
                id="dealerPrice"
                type="number"
                step="any"
                {...register("dealerPrice")}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="stockQuantity">{t("products.stockQuantity")}</Label>
              <Input
                id="stockQuantity"
                type="number"
                step="1"
                {...register("stockQuantity")}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={updateMutation.isPending || !isDirty}>
              {updateMutation.isPending
                ? t("productDetail.saving")
                : t("productDetail.saveChanges")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty}
              onClick={handleCancel}
            >
              {t("common.cancel")}
            </Button>
            {isDirty && (
              <span className="text-sm text-muted-foreground">
                {t("productDetail.unsavedChanges")}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
