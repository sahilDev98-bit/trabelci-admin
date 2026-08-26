import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react"
import { toast } from "sonner"

import {
  useProductByIdQuery,
  useProductSapDetailQuery,
  useRefreshProductFromSapMutation,
  useTelegramImagesQuery,
} from "@/features/products/api"
import { useProductImagesQuery } from "@/features/productImages/api"
import { useAnalyzeSingleProductMutation } from "@/features/similarity/api"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ROUTES } from "@/lib/routes"
import { CoverImageSection } from "@/pages/products/components/CoverImageSection"
import { GallerySection } from "@/pages/products/components/GallerySection"
import { ProductDetailsForm } from "@/pages/products/components/ProductDetailsForm"
import { ProductInfoCard } from "@/pages/products/components/ProductInfoCard"
import { SimilarProductsSection } from "@/pages/products/components/SimilarProductsSection"

export function ProductDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: "/_app/products/$id" })
  const navigate = useNavigate()

  const {
    data: product,
    isLoading,
    isError,
    error,
    refetch: refetchProduct,
  } = useProductByIdQuery(id ?? null)

  const {
    data: images,
    refetch: refetchImages,
  } = useProductImagesQuery(product?.sku ?? null)

  // BUG-021: Finish/Showroom/Warehouse Bins/Quantity per Carton aren't
  // synced Supabase columns — only available live from SAP, via the same
  // rich endpoint the mobile app's product page already reads.
  const { data: sapDetail } = useProductSapDetailQuery(product?.sku ?? null)
  const { data: telegramImages } = useTelegramImagesQuery(product?.sku ?? null)

  const refreshFromSap = useRefreshProductFromSapMutation()
  const analyzeSimilarity = useAnalyzeSingleProductMutation()

  const handleRefreshFromSap = async () => {
    if (!id) return
    try {
      await refreshFromSap.mutateAsync({ id })
      toast.success(t("productDetail.refreshed"), {
        description: t("productDetail.refreshedDesc"),
      })
    } catch {
      toast.error(t("productDetail.refreshFromSap"))
    }
  }

  const handleAnalyzeSimilarity = async () => {
    if (!id) return
    try {
      await analyzeSimilarity.mutateAsync(id)
      toast.success(t("productDetail.analyzeSimilarity"))
    } catch {
      toast.error(t("productDetail.analyzeSimilarity"))
    }
  }

  const handleImageChange = () => {
    refetchImages()
    refetchProduct()
  }

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate({ to: ROUTES.PRODUCTS })}>
          <ArrowLeft className="size-4" />
        </Button>

        <div className="flex-1 min-w-0">
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="product"
            isEmpty={!product}
            onRetry={() => refetchProduct()}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold truncate">{product?.name}</h1>
              <Badge variant="outline" className="font-mono text-xs">
                {product?.sku}
              </Badge>
              <Badge variant={product?.sapSyncStatus === "synced" ? "default" : "secondary"}>
                {product?.sapSyncStatus}
              </Badge>
            </div>
          </QueryStateWrapper>
        </div>

        {product && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={refreshFromSap.isPending}
              onClick={handleRefreshFromSap}
            >
              <RefreshCw className={`size-4 me-1.5 ${refreshFromSap.isPending ? "animate-spin" : ""}`} />
              {refreshFromSap.isPending
                ? t("productDetail.refreshing")
                : t("productDetail.refreshFromSap")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={analyzeSimilarity.isPending}
              onClick={handleAnalyzeSimilarity}
            >
              <Sparkles className="size-4 me-1.5" />
              {analyzeSimilarity.isPending
                ? t("productDetail.analyzing")
                : t("productDetail.analyzeSimilarity")}
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      {product && (
        <>
          <CoverImageSection
            sku={product.sku}
            coverUrl={images?.coverUrl ?? product.coverUrl}
            onImageChange={handleImageChange}
          />

          <GallerySection
            sku={product.sku}
            productUrls={images?.productUrls ?? product.images}
            onImageChange={handleImageChange}
          />

          <ProductDetailsForm product={product} />

          <ProductInfoCard product={product} sapDetail={sapDetail} telegramImages={telegramImages} />

          <SimilarProductsSection productId={product.id} />
        </>
      )}
    </div>
  )
}
