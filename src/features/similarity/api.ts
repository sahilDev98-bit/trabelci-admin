import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { similarityQueryKeys } from "./queryKeys"
import type { AnalyzeAllResponse, SimilarProduct, SimilarityGlobalStatus } from "./types"

async function fetchSimilarityGlobalStatus(): Promise<SimilarityGlobalStatus> {
  const res = await apiFetch<{ success: true } & SimilarityGlobalStatus>(
    API_ENDPOINTS.SIMILARITY_STATUS,
    { method: "GET" },
  )
  return {
    recompute: res.recompute,
    catalog: res.catalog,
  }
}

async function fetchSimilarProducts(productId: string): Promise<SimilarProduct[]> {
  const res = await apiFetch<{ success: true; similarProducts: SimilarProduct[] }>(
    `${API_ENDPOINTS.CATALOG_PRODUCTS}/${productId}/similar`,
    { method: "GET" },
  )
  return res.similarProducts ?? []
}

async function analyzeSingleProduct(productId: string): Promise<void> {
  await apiFetch<{ success: true }>(
    `${API_ENDPOINTS.PRODUCTS}/${productId}/analyze-similarity`,
    { method: "POST" },
  )
}

async function analyzeAllProducts(): Promise<AnalyzeAllResponse> {
  const res = await apiFetch<AnalyzeAllResponse>(
    API_ENDPOINTS.SIMILARITY_ANALYZE_ALL,
    { method: "POST" },
  )
  return res
}

export function useSimilarityGlobalStatusQuery(options?: {
  refetchInterval?: number | false
}) {
  return useQuery({
    queryKey: similarityQueryKeys.globalStatus,
    queryFn: fetchSimilarityGlobalStatus,
    refetchInterval: options?.refetchInterval,
  })
}

export function useSimilarProductsQuery(productId: string | null) {
  return useQuery({
    queryKey: productId ? similarityQueryKeys.similarProducts(productId) : similarityQueryKeys.all,
    queryFn: () => fetchSimilarProducts(productId!),
    enabled: Boolean(productId),
  })
}

export function useAnalyzeSingleProductMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: analyzeSingleProduct,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: similarityQueryKeys.all })
    },
  })
}

export function useAnalyzeAllProductsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: analyzeAllProducts,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: similarityQueryKeys.globalStatus })
    },
  })
}
