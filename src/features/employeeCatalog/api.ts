import { useQuery } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import type { Product } from "@/features/products/types"
import type { ProductGroup, GroupProduct } from "@/features/productGroups/types"

// ---------------------------------------------------------------------------
// Query keys (separate from admin to avoid cache collisions)
// ---------------------------------------------------------------------------

export const employeeCatalogKeys = {
  products: ["employee", "products"] as const,
  productGroups: ["employee", "productGroups"] as const,
  productGroupProducts: (groupId: string) => ["employee", "productGroups", groupId, "products"] as const,
} as const

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

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

const mapProductRow = (row: ProductRow): Product => ({
  id: String(row.id),
  sku: row.sku,
  name: row.name,
  size: row.size,
  unitPrice: row.unitPrice,
  dealerPrice: row.dealerPrice,
  stockQuantity: row.stockQuantity,
  onHand: row.onHand,
  onOrder: row.onOrder,
  isCommitted: row.isCommitted,
  availableStock: row.availableStock,
  stockSyncedAt: row.stockSyncedAt,
  sapSyncStatus: row.sapSyncStatus ?? "pending_sap_sync",
  coverUrl: row.coverUrl,
  images: Array.isArray(row.images) ? row.images.map(String) : [],
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export type EmployeeProductsListParams = {
  page: number
  pageSize: number
  search: string
}

export type EmployeeProductsListResult = {
  items: Product[]
  total: number
  page: number
  pageSize: number
}

async function fetchEmployeeProducts(params: EmployeeProductsListParams): Promise<EmployeeProductsListResult> {
  const query = new URLSearchParams()
  query.set("page", String(params.page))
  query.set("limit", String(params.pageSize))
  const search = params.search.trim()
  if (search) query.set("q", search)

  const res = await apiFetch<{
    success: true
    products: ProductRow[]
    total: number
    page: number
    limit: number
  }>(`${API_ENDPOINTS.EMPLOYEE_PRODUCTS}?${query.toString()}`, { method: "GET" })

  return {
    items: (res.products ?? []).map(mapProductRow),
    total: res.total ?? 0,
    page: res.page,
    pageSize: res.limit,
  }
}

async function fetchEmployeeProductGroups(): Promise<ProductGroup[]> {
  const res = await apiFetch<{ success: true; groups: ProductGroup[] }>(API_ENDPOINTS.EMPLOYEE_PRODUCT_GROUPS, { method: "GET" })
  return res.groups ?? []
}

async function fetchEmployeeGroupProducts(groupId: string): Promise<GroupProduct[]> {
  const res = await apiFetch<{ success: true; products: GroupProduct[] }>(
    `${API_ENDPOINTS.EMPLOYEE_PRODUCT_GROUPS}/${groupId}/products`,
    { method: "GET" },
  )
  return res.products ?? []
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

export function useEmployeeProductsQuery(params: EmployeeProductsListParams) {
  return useQuery({
    queryKey: [...employeeCatalogKeys.products, "list", params.page, params.pageSize, params.search],
    queryFn: () => fetchEmployeeProducts(params),
  })
}

export function useEmployeeProductGroupsQuery() {
  return useQuery({
    queryKey: employeeCatalogKeys.productGroups,
    queryFn: fetchEmployeeProductGroups,
  })
}

export function useEmployeeGroupProductsQuery(groupId: string | null) {
  return useQuery({
    queryKey: groupId ? employeeCatalogKeys.productGroupProducts(groupId) : [...employeeCatalogKeys.productGroups, "products"],
    queryFn: () => fetchEmployeeGroupProducts(groupId!),
    enabled: Boolean(groupId),
  })
}
