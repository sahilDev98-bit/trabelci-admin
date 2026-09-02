import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { pdfPageTemplatesQueryKeys } from "./queryKeys"
import type { PdfPageTemplate, PdfTemplateSlot } from "./types"

/**
 * Reusable page designs — Point 5 of the client's brief.
 *
 * A template is a one-page PDF plus the knowledge of which boxes on it hold a
 * product's details. Saving one sends both together, as a single multipart
 * request: a row pointing at a page that failed to upload would list in the
 * library and fail when anyone tried to use it.
 */

type RawTemplate = Record<string, unknown>

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

/** Slots decide where a product's SKU is written onto a page, so a row with a
 * malformed one is dropped rather than trusted. The API validates too; this
 * is the second half of the same rule, because a response is still data
 * arriving over a network. */
const mapSlots = (value: unknown): PdfTemplateSlot[] => {
  if (!Array.isArray(value)) return []
  const out: PdfTemplateSlot[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as RawTemplate
    const fieldId = asString(r.fieldId)
    const kind = asString(r.kind)
    const bbox = r.bbox as Record<string, unknown> | undefined
    if (!fieldId || (kind !== "text" && kind !== "image" && kind !== "vector")) continue
    const left = asNumber(bbox?.left)
    const bottom = asNumber(bbox?.bottom)
    const right = asNumber(bbox?.right)
    const top = asNumber(bbox?.top)
    if (left === null || bottom === null || right === null || top === null) continue
    out.push({
      fieldId,
      kind,
      productIndex: asNumber(r.productIndex) ?? 0,
      bbox: { left, bottom, right, top },
    })
  }
  return out
}

const mapTemplate = (row: unknown): PdfPageTemplate | null => {
  if (!row || typeof row !== "object") return null
  const r = row as RawTemplate
  const id = asString(r.id)
  const widthPts = asNumber(r.width_pts)
  const heightPts = asNumber(r.height_pts)
  // Without an id there is nothing to fetch, and without a size the page
  // cannot be placed. A row missing either is not usable as a template.
  if (!id || !widthPts || !heightPts) return null
  return {
    id,
    name: asString(r.name) ?? "Untitled",
    description: asString(r.description),
    category: asString(r.category) ?? "other",
    supplier: asString(r.supplier),
    previewUrl: asString(r.preview_url),
    widthPts,
    heightPts,
    slots: mapSlots(r.slots),
    productCount: asNumber(r.product_count) ?? 0,
    createdAt: asString(r.created_at),
  }
}

export async function listPdfPageTemplates(filters: {
  category?: string | null; supplier?: string | null
} = {}): Promise<PdfPageTemplate[]> {
  const query = new URLSearchParams()
  if (filters.category) query.set("category", filters.category)
  if (filters.supplier) query.set("supplier", filters.supplier)
  const suffix = query.toString() ? `?${query.toString()}` : ""

  const res = await apiFetch<{ templates?: unknown }>(
    `${API_ENDPOINTS.PDF_PAGE_TEMPLATES}${suffix}`)
  const rows = Array.isArray(res.templates) ? res.templates : []
  return rows.map(mapTemplate).filter((t): t is PdfPageTemplate => t !== null)
}

export function usePdfPageTemplatesQuery(filters: {
  category?: string | null; supplier?: string | null
} = {}) {
  return useQuery({
    queryKey: pdfPageTemplatesQueryKeys.list(filters),
    queryFn: () => listPdfPageTemplates(filters),
    // A template library changes only when someone saves one, which
    // invalidates this anyway.
    staleTime: 5 * 60_000,
  })
}

export interface SavePageTemplateInput {
  name: string
  description?: string
  category?: string
  supplier?: string
  /** The page, as its own single-page PDF. */
  pageBytes: ArrayBuffer
  /** A small picture of it for the library list. Optional: a missing preview
   * costs a thumbnail, and is not worth failing the save for. */
  preview?: Blob | null
  widthPts: number
  heightPts: number
  slots: PdfTemplateSlot[]
}

export function useSavePageTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SavePageTemplateInput): Promise<PdfPageTemplate> => {
      const form = new FormData()
      form.append("page", new Blob([input.pageBytes], { type: "application/pdf" }), "page.pdf")
      if (input.preview) form.append("preview", input.preview, "preview.png")
      form.append("name", input.name)
      if (input.description) form.append("description", input.description)
      if (input.category) form.append("category", input.category)
      if (input.supplier) form.append("supplier", input.supplier)
      form.append("widthPts", String(input.widthPts))
      form.append("heightPts", String(input.heightPts))
      // As a JSON string: this is a multipart form carrying files, and there
      // is no other way to send structured data alongside them.
      form.append("slots", JSON.stringify(input.slots))

      const res = await apiFetch<{ template: unknown }>(
        API_ENDPOINTS.PDF_PAGE_TEMPLATES, { method: "POST", body: form })
      const template = mapTemplate(res.template)
      if (!template) throw new Error("The server did not return the saved template")
      return template
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pdfPageTemplatesQueryKeys.all })
    },
  })
}

/**
 * A template's page as bytes, ready to insert into a document.
 *
 * Through our API rather than straight at R2: those objects are served
 * without CORS headers, so the browser can neither fetch nor open one
 * directly — the same reason library assets are proxied.
 */
export async function fetchPageTemplateFile(id: string): Promise<ArrayBuffer> {
  const blob = await apiFetch<Blob>(
    `${API_ENDPOINTS.PDF_PAGE_TEMPLATES}/${encodeURIComponent(id)}/file`,
    { responseType: "blob" },
  )
  return blob.arrayBuffer()
}

export function useDeletePageTemplateMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`${API_ENDPOINTS.PDF_PAGE_TEMPLATES}/${encodeURIComponent(id)}`,
        { method: "DELETE" })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pdfPageTemplatesQueryKeys.all })
    },
  })
}
