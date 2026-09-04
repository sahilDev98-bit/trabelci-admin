import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { productsQueryKeys } from "./queryKeys"
import type {
  CreateProductFromSapInput,
  Product,
  RefreshProductFromSapInput,
  SapProductPreview,
  UpdateProductInput,
} from "./types"

type ProductRow = {
  id: number
  sku: string
  name: string
  size: string | null
  unitPrice: number | null
  dealerPrice: number | null
  stockQuantity: number | null
  onHand: number | null
  onOrder: number | null
  isCommitted: number | null
  availableStock: number | null
  stockSyncedAt: string | null
  sapSyncStatus: string | null
  coverUrl: string | null
  images: unknown
  createdAt: string | null
  updatedAt: string | null
}

const mapImages = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === "string" ? item : String(item)))
}

const mapProductRow = (row: ProductRow): Product => ({
  id: String(row.id),
  sku: row.sku,
  name: row.name,
  unitPrice: row.unitPrice,
  size: row.size,
  dealerPrice: row.dealerPrice,
  stockQuantity: row.stockQuantity,
  onHand: row.onHand,
  onOrder: row.onOrder,
  isCommitted: row.isCommitted,
  availableStock: row.availableStock,
  stockSyncedAt: row.stockSyncedAt,
  sapSyncStatus: row.sapSyncStatus ?? "pending_sap_sync",
  coverUrl: row.coverUrl,
  images: mapImages(row.images),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export type ProductsListParams = {
  page: number
  pageSize: number
  search: string
  categoryId?: string | null
}

export type ProductsListResult = {
  items: Product[]
  total: number
  page: number
  pageSize: number
}

const DEFAULT_ALL_PRODUCTS_PAGE = 1
const DEFAULT_ALL_PRODUCTS_PAGE_SIZE = 1000

export async function fetchProductsPage(params: ProductsListParams): Promise<ProductsListResult> {
  const search = params.search.trim()
  const query = new URLSearchParams()
  query.set("page", String(params.page))
  query.set("limit", String(params.pageSize))
  if (search) {
    query.set("q", search)
  }
  if (params.categoryId) {
    query.set("categoryId", params.categoryId)
  }

  const res = await apiFetch<{
    success: true
    products: ProductRow[]
    total: number
    page: number
    limit: number
  }>(`${API_ENDPOINTS.PRODUCTS}?${query.toString()}`, {
    method: "GET",
  })

  return {
    items: (res.products ?? []).map(mapProductRow),
    total: res.total ?? 0,
    page: res.page,
    pageSize: res.limit,
  }
}

// BUG-035/037: this used to fetch a single page (1000 items) and call that
// "all products" — PostgREST hard-caps any single response at 1000 rows
// regardless of the limit requested, so anything past the first 1000 (the
// catalog has ~6,400) was silently invisible to every picker built on top
// of this (BP Assignments' "Add Individual Products" and "Excluded
// Products" search, both of which filter this list client-side). Loop
// through every page instead so the picker's candidate list is genuinely
// the whole catalog.
async function fetchAllProducts(): Promise<Product[]> {
  const items: Product[] = []
  let page = DEFAULT_ALL_PRODUCTS_PAGE
  while (true) {
    const result = await fetchProductsPage({
      page,
      pageSize: DEFAULT_ALL_PRODUCTS_PAGE_SIZE,
      search: "",
    })
    items.push(...result.items)
    if (result.items.length < DEFAULT_ALL_PRODUCTS_PAGE_SIZE || items.length >= result.total) break
    page += 1
  }
  return items
}

async function fetchProductById(id: string): Promise<Product> {
  const res = await apiFetch<{ success: true; product: ProductRow }>(`${API_ENDPOINTS.PRODUCTS}/${id}`, {
    method: "GET",
  })
  return mapProductRow(res.product)
}

// Supplemental fields the Supabase-mirror endpoint above never carries
// (Finish, Showroom1-3, Quantity per Carton, Warehouse Bins aren't synced
// columns — they only exist live in SAP). Fetched separately, keyed on sku,
// from the same rich endpoint the mobile app's product page already uses.
// BUG-021: these were only ever visible on Mobile, never on Web.
export type ProductSapDetail = {
  supplierName: string | null
  countryOfOrigin: string | null
  finish: string | null
  quantityPerCarton: number | null
  latestWarehouseInventoryPrice: number | null
  warehouseBins: string[]
  showroom1: string | null
  showroom2: string | null
  showroom3: string | null
}

async function fetchProductSapDetail(sku: string): Promise<ProductSapDetail> {
  const res = await apiFetch<{
    SupplierName?: string | null
    CountryOfOrigin?: string | null
    actualFinish?: string | null
    Finish?: string | null
    QuantityPerCarton?: number | null
    latestWarehouseTInventoryPrice?: number | null
    warehouseTBinsAvailableNow?: string[] | null
    Showroom1?: string | null
    Showroom2?: string | null
    Showroom3?: string | null
  }>(`${API_ENDPOINTS.PRODUCT_SAP_DETAIL}/${sku}`, { method: "GET" })

  return {
    supplierName: res.SupplierName ?? null,
    countryOfOrigin: res.CountryOfOrigin ?? null,
    finish: res.actualFinish ?? res.Finish ?? null,
    quantityPerCarton: res.QuantityPerCarton ?? null,
    latestWarehouseInventoryPrice: res.latestWarehouseTInventoryPrice ?? null,
    warehouseBins: res.warehouseTBinsAvailableNow ?? [],
    showroom1: res.Showroom1 ?? null,
    showroom2: res.Showroom2 ?? null,
    showroom3: res.Showroom3 ?? null,
  }
}

export type TelegramImage = {
  url: string
  caption: string | null
  telegramDate: string | null
  category: string | null
}

async function fetchTelegramImages(sku: string): Promise<TelegramImage[]> {
  const res = await apiFetch<{ sku: string; images: TelegramImage[] }>(
    `${API_ENDPOINTS.PRODUCT_SAP_DETAIL}/${sku}/telegram-images`,
    { method: "GET" },
  )
  return res.images ?? []
}

async function createProductFromSap(input: CreateProductFromSapInput): Promise<Product> {
  const res = await apiFetch<{ success: true; product: ProductRow }>(API_ENDPOINTS.PRODUCTS_FROM_SAP, {
    method: "POST",
    body: JSON.stringify(input),
  })
  return mapProductRow(res.product)
}

async function refreshProductFromSap(input: RefreshProductFromSapInput): Promise<Product> {
  const res = await apiFetch<{ success: true; product: ProductRow }>(API_ENDPOINTS.PRODUCTS_REFRESH_FROM_SAP, {
    method: "POST",
    body: JSON.stringify(input),
  })
  return mapProductRow(res.product)
}

async function updateProduct(input: UpdateProductInput): Promise<Product> {
  const { id, ...rest } = input
  const res = await apiFetch<{ success: true; product: ProductRow }>(`${API_ENDPOINTS.PRODUCTS}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(rest),
  })
  return mapProductRow(res.product)
}

async function deleteProduct(id: string): Promise<void> {
  await apiFetch<void>(`${API_ENDPOINTS.PRODUCTS}/${id}`, { method: "DELETE" })
}

async function previewProductFromSap(sku: string): Promise<SapProductPreview> {
  const res = await apiFetch<{ success: true; product: SapProductPreview }>(
    `${API_ENDPOINTS.PRODUCTS_SAP_PREVIEW}?sku=${encodeURIComponent(sku)}`,
    { method: "GET" },
  )
  return res.product
}

async function searchSapProducts(q: string): Promise<SapProductPreview[]> {
  const res = await apiFetch<{ success: true; products: SapProductPreview[] }>(
    `${API_ENDPOINTS.PRODUCTS_SAP_SEARCH}?q=${encodeURIComponent(q)}`,
    { method: "GET" },
  )
  return res.products ?? []
}

export function useProductsListQuery(params: ProductsListParams) {
  return useQuery({
    queryKey: [...productsQueryKeys.listPage(params.page, params.pageSize, params.search), params.categoryId ?? "all"],
    queryFn: () => fetchProductsPage(params),
  })
}

export function useProductsQuery() {
  return useQuery({
    queryKey: productsQueryKeys.listPage(DEFAULT_ALL_PRODUCTS_PAGE, DEFAULT_ALL_PRODUCTS_PAGE_SIZE, ""),
    queryFn: fetchAllProducts,
  })
}

export function useProductByIdQuery(id: string | null) {
  return useQuery({
    queryKey: id ? productsQueryKeys.byId(id) : ["products", "byId", "null"],
    queryFn: () => fetchProductById(id!),
    enabled: Boolean(id),
  })
}

export function useProductSapDetailQuery(sku: string | null) {
  return useQuery({
    queryKey: ["products", "sapDetail", sku ?? "null"],
    queryFn: () => fetchProductSapDetail(sku!),
    enabled: Boolean(sku),
  })
}

export function useTelegramImagesQuery(sku: string | null) {
  return useQuery({
    queryKey: ["products", "telegramImages", sku ?? "null"],
    queryFn: () => fetchTelegramImages(sku!),
    enabled: Boolean(sku),
  })
}

export function useCreateProductFromSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProductFromSap,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: productsQueryKeys.list })
    },
  })
}

export function useRefreshProductFromSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: refreshProductFromSap,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productsQueryKeys.list }),
        qc.invalidateQueries({ queryKey: productsQueryKeys.byId(variables.id) }),
      ])
    },
  })
}

export function useUpdateProductMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateProduct,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productsQueryKeys.list }),
        qc.invalidateQueries({ queryKey: productsQueryKeys.byId(variables.id) }),
      ])
    },
  })
}

export function useDeleteProductMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteProduct,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: productsQueryKeys.list })
    },
  })
}

export function usePreviewProductFromSapMutation() {
  return useMutation({
    mutationFn: previewProductFromSap,
  })
}

export function useSapProductsSearchQuery(q: string) {
  return useQuery({
    queryKey: ["products", "sap-search", q],
    queryFn: () => searchSapProducts(q),
    enabled: q.trim().length > 0,
  })
}

