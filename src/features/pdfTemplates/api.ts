import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, type DownloadProgress } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { pdfTemplatesQueryKeys } from "./queryKeys"
import type {
  CreatePdfTemplateInput,
  PdfTemplate,
  UpdatePdfTemplateInput,
} from "./types"

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function fetchPdfTemplates(): Promise<PdfTemplate[]> {
  const res = await apiFetch<{ templates: PdfTemplate[] }>(API_ENDPOINTS.PDF_TEMPLATES)
  return res.templates
}

export async function fetchPdfTemplate(id: string): Promise<PdfTemplate> {
  const res = await apiFetch<{ template: PdfTemplate }>(`${API_ENDPOINTS.PDF_TEMPLATES}/${id}`)
  return res.template
}

export async function createPdfTemplate(data: CreatePdfTemplateInput): Promise<PdfTemplate> {
  const res = await apiFetch<{ template: PdfTemplate }>(API_ENDPOINTS.PDF_TEMPLATES, {
    method: "POST",
    body: JSON.stringify(data),
  })
  return res.template
}

export async function updatePdfTemplate(id: string, data: UpdatePdfTemplateInput): Promise<PdfTemplate> {
  const res = await apiFetch<{ template: PdfTemplate }>(`${API_ENDPOINTS.PDF_TEMPLATES}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
  return res.template
}

export async function deletePdfTemplate(id: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PDF_TEMPLATES}/${id}`, { method: "DELETE" })
}

export async function createPdfTemplateFromPdf(file: File): Promise<PdfTemplate> {
  const form = new FormData()
  form.append("pdf", file)
  const res = await apiFetch<{ template: PdfTemplate }>(API_ENDPOINTS.PDF_TEMPLATES_FROM_PDF, {
    method: "POST",
    body: form,
  })
  return res.template
}

// ── PDF master (uploaded PDFs, edited in the browser) ─────────────────────────

export async function createPdfMasterTemplate(file: File): Promise<PdfTemplate> {
  const form = new FormData()
  form.append("pdf", file)
  const res = await apiFetch<{ template: PdfTemplate }>(API_ENDPOINTS.PDF_MASTER_TEMPLATES, {
    method: "POST",
    body: form,
  })
  return res.template
}

/**
 * The template's ORIGINAL PDF bytes, for the PDFium browser-side editor.
 *
 * Deliberately not a direct fetch of template.source_pdf_url: R2 serves
 * those objects without CORS headers, so the browser blocks a cross-origin
 * read before it even starts. Going through the API — which does have CORS
 * configured — is what makes browser-side editing work, and it also puts
 * the file behind a login rather than leaving it readable by anyone with
 * the link.
 */
export async function fetchPdfMasterTemplateSource(
  templateId: string,
  onDownloadProgress?: (progress: DownloadProgress) => void,
): Promise<ArrayBuffer> {
  return apiFetch<ArrayBuffer>(`${API_ENDPOINTS.PDF_MASTER_TEMPLATES}/${templateId}/source`, {
    responseType: "arraybuffer",
    onDownloadProgress,
  })
}

// ── React Query hooks ─────────────────────────────────────────────────────────

export function usePdfTemplatesQuery() {
  return useQuery({ queryKey: pdfTemplatesQueryKeys.list(), queryFn: fetchPdfTemplates })
}

export function usePdfTemplateQuery(id: string) {
  return useQuery({
    queryKey: pdfTemplatesQueryKeys.byId(id),
    queryFn: () => fetchPdfTemplate(id),
    enabled: !!id,
  })
}

export function useCreatePdfTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPdfTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfTemplatesQueryKeys.all }),
  })
}

export function useUpdatePdfTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePdfTemplateInput }) =>
      updatePdfTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfTemplatesQueryKeys.all }),
  })
}

export function useDeletePdfTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deletePdfTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfTemplatesQueryKeys.all }),
  })
}

export function useCreatePdfTemplateFromPdfMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPdfTemplateFromPdf,
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfTemplatesQueryKeys.all }),
  })
}

export function useCreatePdfMasterTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPdfMasterTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: pdfTemplatesQueryKeys.all }),
  })
}
