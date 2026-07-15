import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { pdfTemplatesQueryKeys } from "./queryKeys"
import type {
  CreatePdfTemplateInput,
  PdfTemplate,
  UpdatePdfTemplateInput,
  PdfSession,
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

// ── PDF master (in-place editing) ──────────────────────────────────────────────

export async function createPdfMasterTemplate(file: File): Promise<PdfTemplate> {
  const form = new FormData()
  form.append("pdf", file)
  const res = await apiFetch<{ template: PdfTemplate }>(API_ENDPOINTS.PDF_MASTER_TEMPLATES, {
    method: "POST",
    body: form,
  })
  return res.template
}

export async function startPdfMasterSession(templateId: string): Promise<PdfSession> {
  return apiFetch<PdfSession>(`${API_ENDPOINTS.PDF_MASTER_TEMPLATES}/${templateId}/session`, {
    method: "POST",
  })
}

export async function editPdfMasterText(
  sessionId: string,
  hotspotId: string,
  newText: string,
): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/edit-text`, {
    method: "POST",
    body: JSON.stringify({ hotspotId, newText }),
  })
}

export async function editPdfMasterImage(
  sessionId: string,
  hotspotId: string,
  file: File,
): Promise<void> {
  const form = new FormData()
  form.append("hotspotId", hotspotId)
  form.append("image", file)
  await apiFetch(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/edit-image`, {
    method: "POST",
    body: form,
  })
}

/** Working-copy PDF bytes — used to (re)render pages in the browser after each edit. */
export async function fetchPdfMasterSessionFile(sessionId: string): Promise<ArrayBuffer> {
  return apiFetch<ArrayBuffer>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/file`, {
    responseType: "arraybuffer",
  })
}

export async function exportPdfMasterSession(sessionId: string): Promise<Blob> {
  return apiFetch<Blob>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/export`, {
    responseType: "blob",
  })
}

export async function closePdfMasterSession(sessionId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}`, { method: "DELETE" })
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
