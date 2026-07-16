import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { pdfTemplatesQueryKeys } from "./queryKeys"
import type {
  CreatePdfTemplateInput,
  PdfTemplate,
  UpdatePdfTemplateInput,
  PdfSessionJobStart,
  PdfSessionJobStatus,
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

export async function startPdfMasterSession(templateId: string): Promise<PdfSessionJobStart> {
  return apiFetch<PdfSessionJobStart>(`${API_ENDPOINTS.PDF_MASTER_TEMPLATES}/${templateId}/session`, {
    method: "POST",
  })
}

/** One-shot status check — meant to be called on an interval until status is "done"/"failed". */
export async function fetchPdfMasterSessionJobStatus(jobId: string): Promise<PdfSessionJobStatus> {
  return apiFetch<PdfSessionJobStatus>(`${API_ENDPOINTS.PDF_MASTER_JOBS}/${jobId}`, {
    method: "GET",
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

/** Full working-copy PDF bytes — used once, for the initial render of every page. */
export async function fetchPdfMasterSessionFile(sessionId: string): Promise<ArrayBuffer> {
  return apiFetch<ArrayBuffer>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/file`, {
    responseType: "arraybuffer",
  })
}

/** One page, sliced server-side into its own tiny PDF — used to refresh a
 * single page's canvas after an edit without re-downloading the whole
 * (possibly 20+ page) working document just to redraw the one page that changed. */
export async function fetchPdfMasterSessionPage(sessionId: string, pageNumber: number): Promise<ArrayBuffer> {
  return apiFetch<ArrayBuffer>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/page/${pageNumber}`, {
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
