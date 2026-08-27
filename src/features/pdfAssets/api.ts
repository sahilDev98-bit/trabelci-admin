import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { buildAdminApiUrl } from "@/config/api"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { pdfAssetsQueryKeys } from "./queryKeys"
import {
  ASSET_CATEGORIES,
  type AssetCategory,
  type CreatePdfAssetInput,
  type PdfAsset,
  type UpdatePdfAssetInput,
} from "./types"

type RawAsset = Record<string, unknown>

const asString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const asCategory = (value: unknown): AssetCategory => {
  const candidate = asString(value)?.toLowerCase()
  return (ASSET_CATEGORIES as readonly string[]).includes(candidate ?? "")
    ? (candidate as AssetCategory)
    : "other"
}

const mapAsset = (row: unknown): PdfAsset | null => {
  if (!row || typeof row !== "object") return null
  const r = row as RawAsset
  const id = asString(r.id)
  const fileUrl = asString(r.file_url)
  // Both are what make an asset usable at all — a row missing either would
  // render as a broken tile nobody could place.
  if (!id || !fileUrl) return null
  return {
    id,
    name: asString(r.name) ?? "Untitled",
    category: asCategory(r.category),
    supplier: asString(r.supplier),
    fileUrl,
    mimeType: asString(r.mime_type) ?? "image/png",
    widthPx: asNumber(r.width_px),
    heightPx: asNumber(r.height_px),
    fileSize: asNumber(r.file_size),
    createdAt: asString(r.created_at),
  }
}

export interface PdfAssetFilters {
  category?: AssetCategory | null
  supplier?: string | null
  search?: string
}

export async function fetchPdfAssets(filters: PdfAssetFilters = {}): Promise<PdfAsset[]> {
  const query = new URLSearchParams()
  if (filters.category) query.set("category", filters.category)
  if (filters.supplier) query.set("supplier", filters.supplier)
  const term = filters.search?.trim()
  if (term) query.set("q", term)

  const suffix = query.toString() ? `?${query.toString()}` : ""
  const res = await apiFetch<{ assets?: unknown }>(`${API_ENDPOINTS.PDF_ASSETS}${suffix}`)
  const rows = Array.isArray(res.assets) ? res.assets : []
  return rows.map(mapAsset).filter((a): a is PdfAsset => a !== null)
}

export function usePdfAssetsQuery(filters: PdfAssetFilters = {}) {
  return useQuery({
    queryKey: pdfAssetsQueryKeys.list({
      category: filters.category ?? null,
      supplier: filters.supplier ?? null,
      search: filters.search?.trim() ?? "",
    }),
    queryFn: () => fetchPdfAssets(filters),
    // A shared library changes rarely, and the editor asks for it every time
    // the panel opens.
    staleTime: 5 * 60_000,
  })
}

export function useCreatePdfAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePdfAssetInput): Promise<PdfAsset> => {
      const form = new FormData()
      form.append("file", input.file)
      form.append("name", input.name)
      form.append("category", input.category)
      if (input.supplier) form.append("supplier", input.supplier)
      // Measured in the browser, which has already decoded the image to show
      // a preview. Sending it saves the API from needing an image library,
      // and it is only used to keep the aspect ratio when the asset is later
      // dropped on a page.
      if (input.widthPx) form.append("widthPx", String(Math.round(input.widthPx)))
      if (input.heightPx) form.append("heightPx", String(Math.round(input.heightPx)))

      const res = await apiFetch<{ asset: unknown }>(API_ENDPOINTS.PDF_ASSETS, {
        method: "POST",
        body: form,
      })
      const asset = mapAsset(res.asset)
      if (!asset) throw new Error("The server did not return the saved asset")
      return asset
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pdfAssetsQueryKeys.all })
    },
  })
}

export function useUpdatePdfAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdatePdfAssetInput) => {
      await apiFetch(`${API_ENDPOINTS.PDF_ASSETS}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pdfAssetsQueryKeys.all })
    },
  })
}

export function useDeletePdfAssetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`${API_ENDPOINTS.PDF_ASSETS}/${id}`, { method: "DELETE" })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pdfAssetsQueryKeys.all })
    },
  })
}

/**
 * Where to fetch an asset's actual BYTES from, for embedding into a document.
 *
 * Not the R2 URL, deliberately. R2 serves these objects without CORS headers,
 * so a browser fetch of fileUrl is blocked — the same reason template PDFs are
 * proxied. Thumbnails do not use this: an <img> pointed at fileUrl needs no
 * CORS and no round trip through the API.
 */
export function assetFileUrl(id: string): string {
  return buildAdminApiUrl(`${API_ENDPOINTS.PDF_ASSETS}/${id}/file`)
}

/**
 * The asset as a File, ready to hand to the PDF engine.
 *
 * Takes an ID rather than the whole asset, because a drop only carries an id —
 * the drag payload cannot hold an object. Goes through apiFetch so the request
 * carries the Supabase token the proxy endpoint requires.
 *
 * The type comes from the RESPONSE rather than from the row we may not have:
 * the proxy sets Content-Type from what was stored, so it is the same answer
 * from a more direct source.
 */
export async function fetchPdfAssetFile(id: string): Promise<File> {
  const blob = await apiFetch<Blob>(`${API_ENDPOINTS.PDF_ASSETS}/${id}/file`, {
    responseType: "blob",
  })
  const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png"
  const extension = type === "image/jpeg" ? "jpg" : "png"
  return new File([blob], `asset-${id}.${extension}`, { type })
}
