import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "@tanstack/react-router"

import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useDeleteProductMutation,
  useProductsListQuery,
  useRefreshProductFromSapMutation,
} from "@/features/products/api"
import type { Product } from "@/features/products/types"
import { SapProductSearchDialog } from "@/pages/products/components/SapProductSearchDialog"
import { ImportProductsDialog } from "@/pages/products/components/ImportProductsDialog"
import { SimilarityStatusBar } from "@/pages/products/components/SimilarityStatusBar"
import { useAnalyzeSingleProductMutation } from "@/features/similarity/api"
import { MoreVerticalIcon } from "lucide-react"
import { toast } from "sonner"

export function ProductsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const pageSize = 10

  const [searchInput, setSearchInput] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(handle)
  }, [searchInput])

  const { data, isLoading, isError, error } = useProductsListQuery({
    page,
    pageSize,
    search: searchTerm,
  })
  const refreshMutation = useRefreshProductFromSapMutation()
  const deleteMutation = useDeleteProductMutation()
  const analyzeSimilarityMutation = useAnalyzeSingleProductMutation()
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)

  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)

  const products = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const renderSapStatus = (status: string) => {
    if (status === "synced") {
      return <Badge variant="secondary">{t("common.synced")}</Badge>
    }
    return <Badge variant="outline">{t("common.pendingSapSync")}</Badge>
  }

  const handleRefresh = async (product: Product) => {
    setRefreshingId(product.id)
    try {
      await refreshMutation.mutateAsync({ id: product.id })
      toast.success(t("products.refreshedFromSap"), {
        description: t("products.refreshedFromSapDesc", { sku: product.sku }),
      })
    } finally {
      setRefreshingId((current) => (current === product.id ? null : current))
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.id)
    toast.success(t("products.productDeleted"), {
      description: t("products.productDeletedDesc", { sku: pendingDelete.sku }),
    })
    setPendingDelete(null)
    // If we were on the last page and deleted the last item, go back one page
    if (products.length === 1 && page > 1) {
      setPage((p) => p - 1)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("products.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("products.description")}
            </p>
          </div>
          <div className="flex w-full max-w-xl items-center gap-2">
            <Input
              placeholder={t("products.searchPlaceholder")}
              aria-label={t("products.searchProducts")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={() => setSearchDialogOpen(true)}>
              {t("products.searchSap")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportDialogOpen(true)}>
              {t("common.import")}
            </Button>
          </div>
        </CardHeader>
        <SimilarityStatusBar />
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="products"
            isEmpty={products.length === 0}
            emptyMessage={t("products.noProductsFound")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">{t("productDetail.coverImage")}</TableHead>
                  <TableHead>{t("products.sku")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("products.size")}</TableHead>
                  <TableHead>{t("products.unitPrice")}</TableHead>
                  <TableHead>{t("products.dealerPrice")}</TableHead>
                  <TableHead>{t("products.stock")}</TableHead>
                  <TableHead>{t("products.available")}</TableHead>
                  <TableHead>{t("products.sapSync")}</TableHead>
                  <TableHead className="w-[140px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate({ to: "/products/$id", params: { id: p.id } })}>
                    <TableCell>
                      {p.coverUrl ? (
                        <img
                          src={p.coverUrl}
                          alt={p.name}
                          className="size-10 rounded-md border object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid size-10 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
                          —
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.size ?? "—"}</TableCell>
                    <TableCell>{p.unitPrice != null ? `${p.unitPrice.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{p.dealerPrice != null ? `${p.dealerPrice.toFixed(2)}` : "—"}</TableCell>
                    <TableCell>{p.stockQuantity != null ? p.stockQuantity : "—"}</TableCell>
                    <TableCell>{p.availableStock != null ? p.availableStock : "—"}</TableCell>
                    <TableCell>{renderSapStatus(p.sapSyncStatus)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("products.productActions")}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVerticalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleRefresh(p) }}>
                            {refreshMutation.isPending && refreshingId === p.id ? t("products.refreshing") : t("products.refreshFromSap")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!p.coverUrl || (analyzeSimilarityMutation.isPending && analyzingId === p.id)}
                            onClick={async (e) => {
                              e.stopPropagation()
                              setAnalyzingId(p.id)
                              try {
                                await analyzeSimilarityMutation.mutateAsync(p.id)
                                toast.success(t("similarity.analyzeCompleted"), {
                                  description: t("similarity.analyzeCompletedDesc", { sku: p.sku }),
                                })
                              } catch {
                                toast.error(t("similarity.analyzeFailed"))
                              } finally {
                                setAnalyzingId(null)
                              }
                            }}
                          >
                            {analyzeSimilarityMutation.isPending && analyzingId === p.id
                              ? t("similarity.analyzing")
                              : t("similarity.analyzeSimilarity")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(p) }}
                          >
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("common.page", { page, pageCount })} • {t("common.totalItems", { count: total })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("common.previous")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                {t("common.next")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <SapProductSearchDialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
      <ImportProductsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onStartImport={() => {
          toast.loading(t("products.importStarted"), {
            description: t("products.importStartedDesc"),
            id: "products-import",
          })
        }}
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t("products.deleteProduct")}
        description={
          <>
            This will permanently remove{" "}
            <span className="font-medium text-foreground">
              {pendingDelete?.name} ({pendingDelete?.sku})
            </span>{" "}
            from Supabase.
          </>
        }
        onConfirm={handleConfirmDelete}
        isPending={deleteMutation.isPending}
      />
    </>
  )
}

