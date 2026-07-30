import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch, type DownloadProgress } from "@/lib/apiClient"
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

/** Full working-copy PDF bytes — used once, for the initial render of every
 * page. onDownloadProgress (optional) reports real bytes-received-vs-total
 * as this streams in, for callers driving a progress indicator off it. */
export async function fetchPdfMasterSessionFile(
  sessionId: string,
  onDownloadProgress?: (progress: DownloadProgress) => void,
): Promise<ArrayBuffer> {
  return apiFetch<ArrayBuffer>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/file`, {
    responseType: "arraybuffer",
    onDownloadProgress,
  })
}

// hotspotId is the client-namespaced id (unique per editor-page instance,
// see PdfHotspotBase) — used here purely to give each edit's uploaded file
// (if any) a unique form field name. originalHotspotId is the plain id from
// the one-time analysis, which is what the server actually looks up.
export type PdfMasterPendingEdit =
  | { hotspotId: string; originalHotspotId: string; type: "text"; value: string }
  | { hotspotId: string; originalHotspotId: string; type: "image"; file: File }
  | { hotspotId: string; originalHotspotId: string; type: "image"; remove: true }

/**
 * One page of the final document, in final display order. originalPage
 * references a page of the ORIGINAL pristine PDF — the same originalPage can
 * appear more than once (a duplicated page), each with its own edits.
 * Pages the user removed in the editor simply aren't included at all.
 */
export interface PdfMasterPagePlanEntry {
  originalPage: number
  edits: PdfMasterPendingEdit[]
}

/**
 * Build the final document from the current page plan and return it.
 * Called once, at Download time — editing (text/image changes, page
 * add/remove/duplicate) all happens entirely client-side up to this point,
 * so this is the only request that ever touches the session's document on
 * the server.
 */
export async function applyPdfMasterEditsAndExport(
  sessionId: string,
  pagePlan: PdfMasterPagePlanEntry[],
): Promise<Blob> {
  const form = new FormData()
  form.append(
    "page_plan",
    JSON.stringify(
      pagePlan.map((page) => ({
        original_page: page.originalPage,
        edits: page.edits.map((e) => ({
          edit_id: e.hotspotId,
          hotspot_id: e.originalHotspotId,
          type: e.type,
          ...(e.type === "text" ? { value: e.value } : {}),
          ...(e.type === "image" && "remove" in e ? { remove: true } : {}),
        })),
      })),
    ),
  )
  for (const page of pagePlan) {
    for (const e of page.edits) {
      if (e.type === "image" && !("remove" in e)) form.append(`image_${e.hotspotId}`, e.file)
    }
  }
  return apiFetch<Blob>(`${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/apply-edits`, {
    method: "POST",
    body: form,
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
