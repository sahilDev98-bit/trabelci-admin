import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate } from "@/lib/formatDate"
import type { Product } from "@/features/products/types"
import type { ProductSapDetail, TelegramImage } from "@/features/products/api"

interface ProductInfoCardProps {
  product: Product
  // Both undefined while their own queries are still loading — rendered
  // as "—" rather than blocking this whole card on them (BUG-021: these
  // fields only existed on Mobile before, fetched here from the same rich
  // SAP-joined endpoint mobile already uses, since none of them are synced
  // Supabase columns).
  sapDetail?: ProductSapDetail
  telegramImages?: TelegramImage[]
}

export function ProductInfoCard({ product, sapDetail, telegramImages }: ProductInfoCardProps) {
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
      label: t("products.quantityPerCarton"),
      value: sapDetail?.quantityPerCarton != null ? String(sapDetail.quantityPerCarton) : "—",
    },
    {
      label: t("products.warehousePrice"),
      value:
        sapDetail?.latestWarehouseInventoryPrice != null
          ? String(sapDetail.latestWarehouseInventoryPrice)
          : "—",
    },
    {
      label: t("products.supplierName"),
      value: sapDetail?.supplierName || "—",
    },
    {
      label: t("products.countryOfOrigin"),
      value: sapDetail?.countryOfOrigin || "—",
    },
    {
      label: t("products.finish"),
      value: sapDetail?.finish || "—",
    },
    {
      label: t("products.warehouseBins"),
      value: sapDetail?.warehouseBins?.length ? sapDetail.warehouseBins.join(", ") : "—",
    },
    {
      label: t("products.showroom1"),
      value: sapDetail?.showroom1 || "—",
    },
    {
      label: t("products.showroom2"),
      value: sapDetail?.showroom2 || "—",
    },
    {
      label: t("products.showroom3"),
      value: sapDetail?.showroom3 || "—",
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
      <CardContent className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {infoItems.map((item) => (
            <div key={item.label} className="grid gap-1">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-medium">{item.value}</span>
            </div>
          ))}
        </div>

        {/* Telegram-sourced photos — a separate pipeline from the Cover/
            Gallery Image system above (CoverImageSection/GallerySection),
            same distinction the mobile app's "Telegram Photos" button
            makes (BUG-022). Simple thumbnail-links-out rather than a full
            lightbox — admin only needs to see what's there, not manage it
            here. */}
        {telegramImages && telegramImages.length > 0 && (
          <div className="grid gap-2 border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {t("products.telegramPhotos")} ({telegramImages.length})
            </span>
            <div className="flex flex-wrap gap-2">
              {telegramImages.map((img) => (
                <a
                  key={img.url}
                  href={img.url}
                  target="_blank"
                  rel="noreferrer"
                  title={img.caption ?? undefined}
                  className="block overflow-hidden rounded-md border"
                >
                  <img src={img.url} alt={img.caption ?? ""} className="h-20 w-20 object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
