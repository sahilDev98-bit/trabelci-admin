import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { categoriesQueryKeys } from "./queryKeys"
import type { Category, CreateCategoryInput, UpdateCategoryInput, UpdateCategoryIconInput } from "./types"

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

async function fetchCategories(): Promise<Category[]> {
  const data = await apiFetch<unknown[]>(API_ENDPOINTS.CATEGORIES, { method: "GET" })

  return data.map((c) => {
    const r = asRecord(c)
    const dbId = r.id ?? r.categoryId ?? r.code ?? r._id
    const sapId = r.sapId ?? r.sap_id ?? dbId
    const name = r.name ?? r.categoryName ?? "Unnamed"
    return {
      id: String(dbId),
      sapId: String(sapId),
      name: String(name),
      iconUrl: typeof r.iconUrl === "string" ? r.iconUrl : null,
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : 0,
      isHidden: typeof r.isHidden === "boolean" ? r.isHidden : false,
      productCount: typeof r.productCount === "number" ? r.productCount : 0,
    }
  })
}

async function updateCategoryIcon(input: UpdateCategoryIconInput): Promise<void> {
  const formData = new FormData()
  formData.append("icon", input.file)

  const method = input.hasIcon ? "PUT" : "POST"

  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/${input.sapId}/icon`, {
    method,
    body: formData,
  })
}

async function deleteCategoryIcon(sapId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/${sapId}/icon`, { method: "DELETE" })
}

async function toggleCategoryVisibility(input: { sapId: string; isHidden: boolean }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/${input.sapId}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isHidden: input.isHidden }),
  })
}

async function createCategory(input: CreateCategoryInput): Promise<void> {
  await apiFetch(API_ENDPOINTS.CATEGORIES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, sapId: input.sapId }),
  })
}

async function updateCategoryDetails(input: UpdateCategoryInput): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/${input.sapId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name }),
  })
}

async function deleteCategory(sapId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/${sapId}`, { method: "DELETE" })
}

async function reorderCategories(orderedSapIds: string[]): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.CATEGORIES}/reorder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedSapIds }),
  })
}

export function useCategoriesQuery() {
  return useQuery({
    queryKey: categoriesQueryKeys.all,
    queryFn: fetchCategories,
  })
}

export function useUpdateCategoryIconMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateCategoryIcon,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useDeleteCategoryIconMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCategoryIcon,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useToggleCategoryVisibilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: toggleCategoryVisibility,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useReorderCategoriesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: reorderCategories,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useCreateCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCategory,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useUpdateCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateCategoryDetails,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

export function useDeleteCategoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: categoriesQueryKeys.all })
    },
  })
}

