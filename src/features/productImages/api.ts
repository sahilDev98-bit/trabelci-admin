import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { productImagesQueryKeys } from "./queryKeys"
import { productsQueryKeys } from "@/features/products/queryKeys"
import type { ProductImages } from "./types"

async function fetchProductImages(sku: string): Promise<ProductImages> {
  return apiFetch<ProductImages>(`${API_ENDPOINTS.PRODUCT_IMAGES}/${sku}`, {
    method: "GET",
  })
}

async function uploadCoverImage(sku: string, file: File): Promise<{ coverUrl: string }> {
  const formData = new FormData()
  formData.append("cover", file)
  return apiFetch<{ message: string; coverUrl: string }>(
    `${API_ENDPOINTS.PRODUCT_IMAGES}/${sku}/cover`,
    { method: "POST", body: formData },
  )
}

async function deleteCoverImage(sku: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PRODUCT_IMAGES}/${sku}/cover`, {
    method: "DELETE",
  })
}

async function uploadGalleryImage(sku: string, file: File): Promise<{ productUrls: string[] }> {
  const formData = new FormData()
  formData.append("image", file)
  return apiFetch<{ message: string; productUrls: string[] }>(
    `${API_ENDPOINTS.PRODUCT_IMAGES}/${sku}/images`,
    { method: "POST", body: formData },
  )
}

async function deleteGalleryImage(sku: string, index: number): Promise<{ productUrls: string[] }> {
  return apiFetch<{ message: string; productUrls: string[] }>(
    `${API_ENDPOINTS.PRODUCT_IMAGES}/${sku}/images/${index}`,
    { method: "DELETE" },
  )
}

export function useProductImagesQuery(sku: string | null) {
  return useQuery({
    queryKey: sku ? productImagesQueryKeys.bySku(sku) : productImagesQueryKeys.all,
    queryFn: () => fetchProductImages(sku!),
    enabled: Boolean(sku),
  })
}

export function useUploadCoverMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sku, file }: { sku: string; file: File }) => uploadCoverImage(sku, file),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productImagesQueryKeys.bySku(variables.sku) }),
        qc.invalidateQueries({ queryKey: productsQueryKeys.list }),
      ])
    },
  })
}

export function useDeleteCoverMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sku: string) => deleteCoverImage(sku),
    onSuccess: async (_data, sku) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: productImagesQueryKeys.bySku(sku) }),
        qc.invalidateQueries({ queryKey: productsQueryKeys.list }),
      ])
    },
  })
}

export function useUploadGalleryImageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sku, file }: { sku: string; file: File }) => uploadGalleryImage(sku, file),
    onSuccess: async (_data, variables) => {
      await qc.invalidateQueries({ queryKey: productImagesQueryKeys.bySku(variables.sku) })
    },
  })
}

export function useDeleteGalleryImageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sku, index }: { sku: string; index: number }) => deleteGalleryImage(sku, index),
    onSuccess: async (_data, variables) => {
      await qc.invalidateQueries({ queryKey: productImagesQueryKeys.bySku(variables.sku) })
    },
  })
}
