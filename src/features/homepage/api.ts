import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { homepageQueryKeys } from "./queryKeys"
import type { CarouselItem, CategoryPin, HomepageConfig } from "./types"

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchHomepageConfig(): Promise<HomepageConfig> {
  const res = await apiFetch<{
    success: true
    carousel: CarouselItem[]
    categoryPins: Record<string, CategoryPin[]>
  }>(API_ENDPOINTS.HOMEPAGE_CONFIG, { method: "GET" })

  return {
    carousel: res.carousel ?? [],
    categoryPins: res.categoryPins ?? {},
  }
}

async function fetchCarousel(): Promise<CarouselItem[]> {
  const res = await apiFetch<{
    success: true
    carousel: CarouselItem[]
  }>(API_ENDPOINTS.HOMEPAGE_CAROUSEL, { method: "GET" })

  return res.carousel ?? []
}

async function updateCarousel(productIds: number[]): Promise<CarouselItem[]> {
  const res = await apiFetch<{
    success: true
    carousel: CarouselItem[]
  }>(API_ENDPOINTS.HOMEPAGE_CAROUSEL, {
    method: "PUT",
    body: JSON.stringify({ productIds }),
  })

  return res.carousel ?? []
}

async function fetchCategoryPins(categoryId: string): Promise<CategoryPin[]> {
  const res = await apiFetch<{
    success: true
    pins: CategoryPin[]
  }>(`${API_ENDPOINTS.HOMEPAGE_CATEGORY_PINS}/${categoryId}/pins`, { method: "GET" })

  return res.pins ?? []
}

async function updateCategoryPins(input: {
  categoryId: string
  productIds: number[]
}): Promise<CategoryPin[]> {
  const res = await apiFetch<{
    success: true
    pins: CategoryPin[]
  }>(`${API_ENDPOINTS.HOMEPAGE_CATEGORY_PINS}/${input.categoryId}/pins`, {
    method: "PUT",
    body: JSON.stringify({ productIds: input.productIds }),
  })

  return res.pins ?? []
}

// ── Query hooks ──────────────────────────────────────────────────────────────

export function useHomepageConfigQuery() {
  return useQuery({
    queryKey: homepageQueryKeys.config,
    queryFn: fetchHomepageConfig,
  })
}

export function useCarouselQuery() {
  return useQuery({
    queryKey: homepageQueryKeys.carousel,
    queryFn: fetchCarousel,
  })
}

export function useCategoryPinsQuery(categoryId: string | null) {
  return useQuery({
    queryKey: categoryId ? homepageQueryKeys.categoryPins(categoryId) : ["homepage", "categoryPins", "null"],
    queryFn: () => fetchCategoryPins(categoryId!),
    enabled: Boolean(categoryId),
  })
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useUpdateCarouselMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateCarousel,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: homepageQueryKeys.all })
    },
  })
}

export function useUpdateCategoryPinsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateCategoryPins,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: homepageQueryKeys.config }),
        qc.invalidateQueries({ queryKey: homepageQueryKeys.categoryPins(variables.categoryId) }),
      ])
    },
  })
}
