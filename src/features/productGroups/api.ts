import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { productGroupKeys } from "./queryKeys"
import type {
  ProductGroup,
  ProductGroupDetail,
  GroupProduct,
  CreateProductGroupPayload,
  UpdateProductGroupPayload,
  ProductIdsPayload,
} from "./types"

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function fetchProductGroups(): Promise<ProductGroup[]> {
  const res = await apiFetch<{ success: true; groups: ProductGroup[] }>(API_ENDPOINTS.PRODUCT_GROUPS, { method: "GET" })
  return res.groups ?? []
}

async function fetchProductGroup(id: string): Promise<ProductGroupDetail> {
  const res = await apiFetch<{ success: true; group: ProductGroupDetail }>(`${API_ENDPOINTS.PRODUCT_GROUPS}/${id}`, { method: "GET" })
  return res.group
}

async function createProductGroup(payload: CreateProductGroupPayload): Promise<ProductGroup> {
  const res = await apiFetch<{ success: true; group: ProductGroup }>(API_ENDPOINTS.PRODUCT_GROUPS, {
    method: "POST",
    body: JSON.stringify(payload),
  })
  return res.group
}

async function updateProductGroup({ id, payload }: { id: string; payload: UpdateProductGroupPayload }): Promise<ProductGroup> {
  const res = await apiFetch<{ success: true; group: ProductGroup }>(`${API_ENDPOINTS.PRODUCT_GROUPS}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
  return res.group
}

async function deleteProductGroup(id: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PRODUCT_GROUPS}/${id}`, { method: "DELETE" })
}

async function addProductsToGroup({ groupId, payload }: { groupId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PRODUCT_GROUPS}/${groupId}/products`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

async function removeProductsFromGroup({ groupId, payload }: { groupId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PRODUCT_GROUPS}/${groupId}/products`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  })
}

async function fetchGroupProducts(groupId: string): Promise<GroupProduct[]> {
  const res = await apiFetch<{ success: true; products: GroupProduct[] }>(`${API_ENDPOINTS.PRODUCT_GROUPS}/${groupId}/products`, { method: "GET" })
  return res.products ?? []
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

export function useProductGroupsQuery() {
  return useQuery({
    queryKey: productGroupKeys.list(),
    queryFn: fetchProductGroups,
  })
}

export function useProductGroupQuery(id: string | null) {
  return useQuery({
    queryKey: id ? productGroupKeys.detail(id) : productGroupKeys.details(),
    queryFn: () => fetchProductGroup(id!),
    enabled: Boolean(id),
  })
}

export function useGroupProductsQuery(groupId: string | null) {
  return useQuery({
    queryKey: groupId ? productGroupKeys.products(groupId) : [...productGroupKeys.all, "products"],
    queryFn: () => fetchGroupProducts(groupId!),
    enabled: Boolean(groupId),
  })
}

export function useCreateProductGroupMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProductGroup,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: productGroupKeys.all })
    },
  })
}

export function useUpdateProductGroupMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateProductGroup,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productGroupKeys.all }),
        qc.invalidateQueries({ queryKey: productGroupKeys.detail(variables.id) }),
      ])
    },
  })
}

export function useDeleteProductGroupMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteProductGroup,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: productGroupKeys.all })
    },
  })
}

export function useAddProductsToGroupMutation(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => addProductsToGroup({ groupId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productGroupKeys.detail(groupId) }),
        qc.invalidateQueries({ queryKey: productGroupKeys.products(groupId) }),
      ])
    },
  })
}

export function useRemoveProductsFromGroupMutation(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => removeProductsFromGroup({ groupId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productGroupKeys.detail(groupId) }),
        qc.invalidateQueries({ queryKey: productGroupKeys.products(groupId) }),
      ])
    },
  })
}
