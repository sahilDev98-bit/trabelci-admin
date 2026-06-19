import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Check, CheckSquare, Pencil, Search, Square, Trash2, X } from "lucide-react"

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { ErrorMessage } from "@/components/ErrorMessage"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useProductGroupQuery,
  useGroupProductsQuery,
  useUpdateProductGroupMutation,
  useAddProductsToGroupMutation,
  useRemoveProductsFromGroupMutation,
} from "@/features/productGroups/api"
import { useQueries } from "@tanstack/react-query"
import { useProductsListQuery, fetchProductsPage, type ProductsListResult } from "@/features/products/api"
import { productsQueryKeys } from "@/features/products/queryKeys"
import { useCategoriesQuery } from "@/features/categories/api"
import { ROUTES } from "@/lib/routes"
import { useCheckboxDragSelect } from "@/lib/useCheckboxDragSelect"
import { toast } from "sonner"

const ADD_PAGE_SIZE = 10
const CURRENT_PAGE_SIZE = 10
const BATCH_SIZE = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export function ProductGroupManagePage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: "/_app/product-groups/$id" })
  const navigate = useNavigate()

  const { data: group, isLoading: groupLoading, isError: groupError, error: groupErrorObj } = useProductGroupQuery(id ?? null)
  const { data: groupProducts, isLoading: productsLoading } = useGroupProductsQuery(id ?? null)
  const { data: categories } = useCategoriesQuery()

  const updateMutation = useUpdateProductGroupMutation()
  const addMutation = useAddProductsToGroupMutation(id ?? "")
  const removeMutation = useRemoveProductsFromGroupMutation(id ?? "")

  // ---------------------------------------------------------------------------
  // Inline name editing
  // ---------------------------------------------------------------------------
  const [isEditingName, setIsEditingName] = useState(false)
  const nameForm = useForm<{ name: string }>({ defaultValues: { name: "" } })
  const [nameError, setNameError] = useState<string | null>(null)

  const startEditingName = () => {
    nameForm.reset({ name: group?.name ?? "" })
    setNameError(null)
    setIsEditingName(true)
  }

  const cancelEditingName = () => {
    setIsEditingName(false)
    setNameError(null)
  }

  const handleSaveName = async (values: { name: string }) => {
    const trimmed = values.name.trim()
    if (!trimmed) {
      setNameError(t("productGroups.nameRequired"))
      return
    }
    if (!id) return

    try {
      await updateMutation.mutateAsync({ id, payload: { name: trimmed } })
      setIsEditingName(false)
      setNameError(null)
      toast.success(t("productGroups.groupNameUpdated"), {
        description: t("productGroups.groupNameUpdatedDesc", { name: trimmed }),
      })
    } catch (error) {
      setNameError(error instanceof Error ? error.message : t("productGroups.failedToUpdateGroupName"))
    }
  }

  // ---------------------------------------------------------------------------
  // Add Products — server-side pagination & filters
  // ---------------------------------------------------------------------------
  const [addPage, setAddPage] = useState(1)
  const [productSearchInput, setProductSearchInput] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)
  const [excludedProductIds, setExcludedProductIds] = useState<Set<string>>(new Set())

  // Debounce search input
  useEffect(() => {
    const handle = setTimeout(() => {
      setProductSearch(productSearchInput)
      setAddPage(1)
    }, 400)
    return () => clearTimeout(handle)
  }, [productSearchInput])

  // Reset page when category filter changes
  const handleCategoryChange = (value: string[]) => {
    setSelectedCategoryIds(value)
    setSelectedProductIds(new Set())
    setIsSelectAllMode(false)
    setExcludedProductIds(new Set())
    setAddPage(1)
  }

  // Server-side paginated query — single or no category
  const isMultiCategory = selectedCategoryIds.length > 1
  const selectedCategoryId = selectedCategoryIds.length === 1 ? selectedCategoryIds[0] : null

  const singleCatQuery = useProductsListQuery({
    page: addPage,
    pageSize: ADD_PAGE_SIZE,
    search: productSearch,
    categoryId: selectedCategoryId,
  })

  // Multi-category: fire one query per category, fetch large pages to merge client-side
  const MULTI_CAT_PAGE_SIZE = 500
  const multiCatQueries = useQueries({
    queries: isMultiCategory
      ? selectedCategoryIds.map((catId) => ({
          queryKey: [...productsQueryKeys.listPage(1, MULTI_CAT_PAGE_SIZE, productSearch), catId],
          queryFn: () =>
            fetchProductsPage({
              page: 1,
              pageSize: MULTI_CAT_PAGE_SIZE,
              search: productSearch,
              categoryId: catId,
            }),
        }))
      : [],
  })

  const multiCatLoading = isMultiCategory && multiCatQueries.some((q) => q.isLoading)

  // Merge + deduplicate multi-category results
  const multiCatMerged = useMemo(() => {
    if (!isMultiCategory) return null
    const seen = new Set<string>()
    const items: ProductsListResult["items"] = []
    for (const q of multiCatQueries) {
      for (const p of q.data?.items ?? []) {
        if (!seen.has(p.id)) {
          seen.add(p.id)
          items.push(p)
        }
      }
    }
    return items
  }, [isMultiCategory, multiCatQueries])

  const allProductsLoading = isMultiCategory ? multiCatLoading : singleCatQuery.isLoading

  const groupProductIds = useMemo(
    () => new Set((groupProducts ?? []).map((p) => p.id)),
    [groupProducts],
  )

  // Build the available product list & pagination
  const { pageProducts, addTotal, addPageCount, totalAvailableCount } = useMemo(() => {
    if (isMultiCategory) {
      // Client-side filtering + pagination on merged results
      const available = (multiCatMerged ?? []).filter((p) => !groupProductIds.has(p.id))
      const total = available.length
      const pageCount = Math.max(1, Math.ceil(total / ADD_PAGE_SIZE))
      const start = (addPage - 1) * ADD_PAGE_SIZE
      const page = available.slice(start, start + ADD_PAGE_SIZE)
      return { pageProducts: page, addTotal: total, addPageCount: pageCount, totalAvailableCount: total }
    }

    // Single / no category — use server-paginated data
    const items = (singleCatQuery.data?.items ?? []).filter((p) => !groupProductIds.has(p.id))
    const serverTotal = singleCatQuery.data?.total ?? 0
    const pageCount = Math.max(1, Math.ceil(serverTotal / ADD_PAGE_SIZE))
    const availableCount = Math.max(0, serverTotal - groupProductIds.size)
    return { pageProducts: items, addTotal: serverTotal, addPageCount: pageCount, totalAvailableCount: availableCount }
  }, [isMultiCategory, multiCatMerged, singleCatQuery.data, groupProductIds, addPage])

  const toggleProduct = (productId: string) => {
    if (isSelectAllMode) {
      setExcludedProductIds((prev) => {
        const next = new Set(prev)
        if (next.has(productId)) next.delete(productId)
        else next.add(productId)
        return next
      })
    } else {
      setSelectedProductIds((prev) => {
        const next = new Set(prev)
        if (next.has(productId)) next.delete(productId)
        else next.add(productId)
        return next
      })
    }
  }

  const isProductSelected = (productId: string) => {
    if (isSelectAllMode) return !excludedProductIds.has(productId)
    return selectedProductIds.has(productId)
  }

  // Click-and-drag multi-select across the checkbox column (Excel/Gmail
  // style) — mousedown on one checkbox, drag over others, they all flip to
  // the same checked state as the first click.
  const { startDrag: startCheckboxDrag, handleNativeChange: handleCheckboxChange } = useCheckboxDragSelect({
    items: pageProducts,
    getKey: (p) => p.id,
    isSelected: (p) => isProductSelected(p.id),
    toggle: toggleProduct,
  })

  const allPageSelected = pageProducts.length > 0 && pageProducts.every((p) => isProductSelected(p.id))

  const toggleSelectAllPage = () => {
    if (isSelectAllMode) {
      // In select-all mode, toggle exclusions for current page
      if (allPageSelected) {
        // Exclude all on this page
        setExcludedProductIds((prev) => {
          const next = new Set(prev)
          for (const p of pageProducts) next.add(p.id)
          return next
        })
      } else {
        // Remove exclusions for this page
        setExcludedProductIds((prev) => {
          const next = new Set(prev)
          for (const p of pageProducts) next.delete(p.id)
          return next
        })
      }
    } else {
      if (allPageSelected) {
        setSelectedProductIds((prev) => {
          const next = new Set(prev)
          for (const p of pageProducts) next.delete(p.id)
          return next
        })
      } else {
        setSelectedProductIds((prev) => {
          const next = new Set(prev)
          for (const p of pageProducts) next.add(p.id)
          return next
        })
      }
    }
  }

  const handleSelectAllProducts = () => {
    setIsSelectAllMode(true)
    setExcludedProductIds(new Set())
    setSelectedProductIds(new Set())
  }

  const handleClearSelection = () => {
    setIsSelectAllMode(false)
    setExcludedProductIds(new Set())
    setSelectedProductIds(new Set())
  }

  const selectedCount = isSelectAllMode
    ? totalAvailableCount - excludedProductIds.size
    : selectedProductIds.size

  const handleAddProducts = async () => {
    if (!id || selectedCount === 0) return

    let idsToAdd: number[]

    if (isSelectAllMode) {
      // Paginate through ALL server pages to collect every product ID
      const seen = new Set<string>()
      const allIds: number[] = []
      const fetchSize = 200

      // For multi-category, fetch each category separately; otherwise single fetch
      const categoryIdsToFetch = isMultiCategory ? selectedCategoryIds : [selectedCategoryId]

      for (const catId of categoryIdsToFetch) {
        let pg = 1
        let totalPages = 1

        while (pg <= totalPages) {
          const res = await fetchProductsPage({
            page: pg,
            pageSize: fetchSize,
            search: productSearch,
            categoryId: catId,
          })
          totalPages = Math.ceil(res.total / fetchSize)

          for (const p of res.items) {
            const pid = String(p.id)
            if (!seen.has(pid) && !groupProductIds.has(pid) && !excludedProductIds.has(pid)) {
              seen.add(pid)
              allIds.push(Number(p.id))
            }
          }
          pg++
        }
      }

      idsToAdd = allIds
    } else {
      idsToAdd = Array.from(selectedProductIds).map(Number)
    }

    if (idsToAdd.length === 0) return

    const batches = chunk(idsToAdd, BATCH_SIZE)
    for (const batch of batches) {
      await addMutation.mutateAsync({ productIds: batch })
    }
    toast.success(t("productGroups.productsAddedToGroup"), {
      description: t("productGroups.productsAddedToGroupDesc", { count: idsToAdd.length, name: group?.name }),
    })
    handleClearSelection()
  }

  // ---------------------------------------------------------------------------
  // Current Products — search & client-side pagination
  // ---------------------------------------------------------------------------
  const [currentSearchInput, setCurrentSearchInput] = useState("")
  const [currentSearch, setCurrentSearch] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [removeAllOpen, setRemoveAllOpen] = useState(false)

  useEffect(() => {
    const handle = setTimeout(() => {
      setCurrentSearch(currentSearchInput)
      setCurrentPage(1)
    }, 400)
    return () => clearTimeout(handle)
  }, [currentSearchInput])

  const filteredGroupProducts = useMemo(() => {
    const q = currentSearch.trim().toLowerCase()
    if (!q) return groupProducts ?? []
    return (groupProducts ?? []).filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    )
  }, [groupProducts, currentSearch])

  const currentTotal = filteredGroupProducts.length
  const currentPageCount = Math.max(1, Math.ceil(currentTotal / CURRENT_PAGE_SIZE))
  const currentPageProducts = useMemo(() => {
    const start = (currentPage - 1) * CURRENT_PAGE_SIZE
    return filteredGroupProducts.slice(start, start + CURRENT_PAGE_SIZE)
  }, [filteredGroupProducts, currentPage])

  // If current page goes beyond available pages, reset
  useEffect(() => {
    if (currentPage > currentPageCount) {
      setCurrentPage(Math.max(1, currentPageCount))
    }
  }, [currentPage, currentPageCount])

  const handleRemoveProduct = async (productId: string) => {
    if (!id) return
    await removeMutation.mutateAsync({ productIds: [Number(productId)] })
    toast.success(t("productGroups.productRemovedFromGroup"), {
      description: t("productGroups.productRemovedFromGroupDesc"),
    })
  }

  const handleRemoveAll = useCallback(async () => {
    if (!id || !groupProducts || groupProducts.length === 0) return
    const allIds = groupProducts.map((p) => Number(p.id))
    const batches = chunk(allIds, BATCH_SIZE)
    for (const batch of batches) {
      await removeMutation.mutateAsync({ productIds: batch })
    }
    toast.success(t("productGroups.allProductsRemovedFromGroup"), {
      description: t("productGroups.allProductsRemovedFromGroupDesc", { count: allIds.length, name: group?.name }),
    })
    setRemoveAllOpen(false)
    setCurrentPage(1)
  }, [id, groupProducts, removeMutation, group?.name, t])

  return (
    <div className="grid gap-6">
      {/* Header with back button */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate({ to: ROUTES.PRODUCT_GROUPS })}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <QueryStateWrapper
            isLoading={groupLoading}
            isError={groupError}
            error={groupErrorObj}
            entityName="product group"
            isEmpty={!group}
            emptyMessage={t("productGroups.noGroupsFound")}
          >
            {isEditingName ? (
              <form
                className="flex items-center gap-2"
                onSubmit={nameForm.handleSubmit(handleSaveName)}
              >
                <Input
                  autoFocus
                  className="max-w-sm text-xl font-semibold"
                  {...nameForm.register("name")}
                />
                <Button type="submit" size="icon" variant="ghost" disabled={updateMutation.isPending}>
                  <Check className="size-4 text-green-600" />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={cancelEditingName}>
                  <X className="size-4" />
                </Button>
                {nameError ? <ErrorMessage>{nameError}</ErrorMessage> : null}
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">{group?.name}</h1>
                <Button variant="ghost" size="icon" onClick={startEditingName}>
                  <Pencil className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            )}
          </QueryStateWrapper>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* Add Products                                                         */}
      {/* ------------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{t("productGroups.addProducts")}</CardTitle>
          <Button
            size="sm"
            disabled={selectedCount === 0 || addMutation.isPending}
            onClick={handleAddProducts}
          >
            {addMutation.isPending
              ? t("products.adding")
              : t("productGroups.addSelectedCount", { count: selectedCount })}
          </Button>
        </CardHeader>
        <CardContent>
          {/* Filters row */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("productGroups.searchProductsByNameOrSku")}
                className="ps-8"
                value={productSearchInput}
                onChange={(e) => setProductSearchInput(e.target.value)}
              />
            </div>
            <Combobox
              multiple
              value={selectedCategoryIds}
              onValueChange={handleCategoryChange}
              itemToStringLabel={(val) =>
                (categories ?? []).find((c) => c.id === val)?.name ?? ""
              }
            >
              <ComboboxInput
                placeholder={t("productGroups.filterByCategory")}
                className="w-[220px]"
              />
              <ComboboxContent>
                <ComboboxList>
                  {(categories ?? []).map((c) => (
                    <ComboboxItem key={c.id} value={c.id}>
                      <span className="flex-1">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.productCount}</span>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
                <ComboboxEmpty>{t("common.noResults")}</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
            {selectedCategoryIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {selectedCategoryIds.map((catId) => {
                  const cat = (categories ?? []).find((c) => c.id === catId)
                  return (
                    <Badge key={catId} variant="secondary" className="gap-1">
                      {cat?.name ?? catId}
                      <button
                        type="button"
                        className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
                        onClick={() => handleCategoryChange(selectedCategoryIds.filter((cid) => cid !== catId))}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  )
                })}
              </div>
            )}
            {pageProducts.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleSelectAllPage}
              >
                {allPageSelected ? (
                  <>
                    <CheckSquare className="me-1.5 size-3.5" />
                    {t("productGroups.deselectAll")}
                  </>
                ) : (
                  <>
                    <Square className="me-1.5 size-3.5" />
                    {t("productGroups.selectAll")}
                  </>
                )}
              </Button>
            ) : null}
          </div>

          {/* Select-all-across-pages banner */}
          {allPageSelected && !isSelectAllMode && totalAvailableCount > pageProducts.length && (
            <div className="mb-3 rounded-md border bg-muted/50 px-4 py-2 text-center text-sm">
              {t("productGroups.allOnPageSelected", { count: pageProducts.length })}{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                onClick={handleSelectAllProducts}
              >
                {t("productGroups.selectAllProducts", { count: totalAvailableCount })}
              </button>
            </div>
          )}
          {isSelectAllMode && (
            <div className="mb-3 rounded-md border bg-primary/10 px-4 py-2 text-center text-sm">
              {t("productGroups.allProductsSelectedBanner", { count: selectedCount })}{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                onClick={handleClearSelection}
              >
                {t("productGroups.clearSelection")}
              </button>
            </div>
          )}

          {allProductsLoading ? (
            <p className="py-4 text-sm text-muted-foreground">{t("productGroups.loadingProducts")}</p>
          ) : pageProducts.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t("productGroups.noAvailableProducts")}</p>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]" />
                      <TableHead>{t("products.sku")}</TableHead>
                      <TableHead>{t("common.name")}</TableHead>
                      <TableHead>{t("products.unitPrice")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageProducts.map((p, idx) => {
                      const isSelected = isProductSelected(p.id)
                      return (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          data-row-index={idx}
                          onClick={() => toggleProduct(p.id)}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-4 rounded border-input accent-primary"
                              checked={isSelected}
                              onChange={() => handleCheckboxChange(p.id)}
                              onMouseDown={(e) => {
                                e.stopPropagation()
                                startCheckboxDrag(idx, e)
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.unitPrice != null ? p.unitPrice.toFixed(2) : "—"}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("common.page", { page: addPage, pageCount: addPageCount })} • {t("common.totalItems", { count: addTotal })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={addPage <= 1}
                    onClick={() => setAddPage((p) => Math.max(1, p - 1))}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={addPage >= addPageCount}
                    onClick={() => setAddPage((p) => Math.min(addPageCount, p + 1))}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------- */}
      {/* Current Products                                                     */}
      {/* ------------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CardTitle>{t("productGroups.currentProducts")}</CardTitle>
            {groupProducts ? (
              <Badge variant="secondary">{groupProducts.length}</Badge>
            ) : null}
          </div>
          {groupProducts && groupProducts.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              disabled={removeMutation.isPending}
              onClick={() => setRemoveAllOpen(true)}
            >
              <Trash2 className="me-1.5 size-3.5" />
              {t("productGroups.removeAll")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {productsLoading ? (
            <p className="py-4 text-sm text-muted-foreground">{t("productGroups.loadingGroupProducts")}</p>
          ) : !groupProducts || groupProducts.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t("productGroups.noProductsInGroup")}</p>
          ) : (
            <>
              {/* Search */}
              <div className="mb-3 relative max-w-sm">
                <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("productGroups.searchCurrentProducts")}
                  className="ps-8"
                  value={currentSearchInput}
                  onChange={(e) => setCurrentSearchInput(e.target.value)}
                />
              </div>

              {filteredGroupProducts.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">{t("productGroups.noCurrentProductsMatch")}</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("products.sku")}</TableHead>
                        <TableHead>{t("common.name")}</TableHead>
                        <TableHead>{t("products.unitPrice")}</TableHead>
                        <TableHead>{t("products.dealerPrice")}</TableHead>
                        <TableHead className="w-[80px] text-end">{t("common.remove")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentPageProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs sm:text-sm">{p.sku}</TableCell>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.unitPrice != null ? p.unitPrice.toFixed(2) : "—"}</TableCell>
                          <TableCell>{p.dealerPrice != null ? p.dealerPrice.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={removeMutation.isPending}
                              onClick={() => handleRemoveProduct(p.id)}
                              aria-label={`${t("common.remove")} ${p.name}`}
                            >
                              <X className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {t("common.page", { page: currentPage, pageCount: currentPageCount })} • {t("common.totalItems", { count: currentTotal })}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        {t("common.previous")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= currentPageCount}
                        onClick={() => setCurrentPage((p) => Math.min(currentPageCount, p + 1))}
                      >
                        {t("common.next")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Remove All confirmation dialog */}
      <ConfirmDeleteDialog
        open={removeAllOpen}
        onOpenChange={setRemoveAllOpen}
        title={t("productGroups.removeAllTitle")}
        description={t("productGroups.removeAllDesc", { count: groupProducts?.length ?? 0, name: group?.name })}
        onConfirm={handleRemoveAll}
        isPending={removeMutation.isPending}
      />
    </div>
  )
}
