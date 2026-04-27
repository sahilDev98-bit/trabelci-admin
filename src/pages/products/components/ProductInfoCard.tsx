import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/formatDate"
import type { Product } from "@/features/products/types"

interface ProductInfoCardProps {
  product: Product
}

export function ProductInfoCard({ product }: ProductInfoCardProps) {
  const { t } = useTranslation()

  const infoItems = [
    {
      label: t("productDetail.sku"),
      value: <span className="font-mono text-sm">{product.sku}</span>,
    },
    {
      label: t("productDetail.category"),
      value: product.sku,
    },
    {
      label: t("products.stock"),
      value: product.stockQuantity != null ? String(product.stockQuantity) : "—",
    },
    {
      label: t("products.available"),
      value: product.availableStock != null ? String(product.availableStock) : "—",
    },
    {
      label: t("products.onOrder"),
      value: product.onOrder != null ? String(product.onOrder) : "—",
    },
    {
      label: t("products.committed"),
      value: product.isCommitted != null ? String(product.isCommitted) : "—",
    },
    {
      label: t("products.stockSyncedAt"),
      value: product.stockSyncedAt ? formatDate(product.stockSyncedAt) : "—",
    },
    {
      label: t("productDetail.sapSyncStatus"),
      value: (
        <Badge variant={product.sapSyncStatus === "synced" ? "default" : "secondary"}>
          {product.sapSyncStatus}
        </Badge>
      ),
    },
    {
      label: t("productDetail.createdAt"),
      value: formatDate(product.createdAt),
    },
    {
      label: t("productDetail.updatedAt"),
      value: formatDate(product.updatedAt),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("productDetail.productInfo")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {infoItems.map((item) => (
            <div key={item.label} className="grid gap-1">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium">{item.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
