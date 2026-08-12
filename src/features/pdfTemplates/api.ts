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
  PdfSessionFont,
  PdfOverlay,
  PdfTextAlign,
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

/**
 * The document's own embedded typefaces, so the editor can preview and
 * measure text in the real face rather than a substitute. Deliberately a
 * separate call from the session file: it's optional enrichment, and the
 * editor stays fully usable (just with a generic preview face) if it fails.
 */
export async function fetchPdfMasterSessionFonts(
  sessionId: string,
): Promise<Record<string, PdfSessionFont>> {
  const res = await apiFetch<{ fonts?: Record<string, PdfSessionFont> }>(
    `${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/fonts`,
  )
  return res.fonts ?? {}
}

/**
 * The true visible shape of one image slot (base64 PNG, alpha = stencil), or
 * "" when it's a plain rectangle. Fetched on demand, for the one slot being
 * replaced, since the server finds the shape by rendering a probe.
 *
 * `hotspotId` is the PLAIN analysis id (not the client-namespaced one) —
 * that's what the server's session metadata knows about.
 */
export async function fetchPdfMasterHotspotMask(
  sessionId: string,
  hotspotId: string,
): Promise<string> {
  const res = await apiFetch<{ mask?: string }>(
    `${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/hotspot-mask/${encodeURIComponent(hotspotId)}`,
  )
  return res.mask ?? ""
}

/**
 * What sits behind one text slot once its text is removed: a base64 PNG plus
 * the rect it covers, in PDF points. Lets the browser restore the document's
 * true background before drawing replacement text, instead of painting a
 * sampled flat colour that shows as a grey rectangle over a photograph.
 *
 * `hotspotId` is the PLAIN analysis id, as the server's metadata knows it.
 */
export async function fetchPdfMasterCleanPatch(
  sessionId: string,
  hotspotId: string,
): Promise<{ patch: string; rect: number[] }> {
  const res = await apiFetch<{ patch?: string; rect?: number[] }>(
    `${API_ENDPOINTS.PDF_MASTER_SESSION}/${sessionId}/clean-patch/${encodeURIComponent(hotspotId)}`,
  )
  return { patch: res.patch ?? "", rect: res.rect ?? [] }
}

// hotspotId is the client-namespaced id (unique per editor-page instance,
// see PdfHotspotBase) — used here purely to give each edit's uploaded file
// (if any) a unique form field name. originalHotspotId is the plain id from
// the one-time analysis, which is what the server actually looks up.
//
// `lines`/`fontSize` on a text edit carry the EXACT layout the browser
// previewed — measured in the document's own embedded face, which the
// export now draws with too. Sending them means the final PDF reproduces
// what the user actually saw instead of being re-wrapped by a second,
// independent algorithm on the server. Both are optional; the server falls
// back to wrapping itself when they're absent.
export type PdfMasterPendingEdit =
  | {
      hotspotId: string
      originalHotspotId: string
      type: "text"
      value: string
      lines?: string[]
      fontSize?: number
      /**
       * The rest of the shared PdfTextRenderPlan (see types.ts), kept here
       * purely so the frontend doesn't throw away a decision it already
       * made. Deliberately NOT part of applyPdfMasterEditsAndExport's
       * network payload below — that function builds the request body from
       * an explicit field list, not a spread, so adding fields here cannot
       * change what's sent until that list is updated too. The backend
       * will be taught to accept these directly in a later phase; until
       * then, sending them would be pretending the current server
       * understands something it doesn't.
       */
      lineHeight?: number
      direction?: "ltr" | "rtl"
      align?: PdfTextAlign
      useFallbackFont?: boolean
    }
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
  /** Items the user ADDED on top of this page (free position/size/angle), as
   * opposed to edits, which replace something the PDF already contained. */
  overlays?: PdfOverlay[]
  /** Quarter turns to apply to this page in the output: 0 | 90 | 180 | 270.
   * Applied after this page's edits — rotation is a page attribute in PDF,
   * not a redraw, so edits keep the coordinates they were made in. */
  rotation?: number
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
  /** Files for image overlays, keyed by overlay id — sent alongside the plan
   * the same way replacement images are. */
  overlayFiles: Record<string, File> = {},
): Promise<Blob> {
  const form = new FormData()
  form.append(
    "page_plan",
    JSON.stringify(
      pagePlan.map((page) => ({
        original_page: page.originalPage,
        rotation: page.rotation ?? 0,
        // Geometry is already in PDF points, unrotated page space — the same
        // space hotspot bboxes use — so the server needs no conversion.
        overlays: (page.overlays ?? []).map((o) => ({
          id: o.id,
          type: o.type,
          rect: [o.x, o.y, o.x + o.width, o.y + o.height],
          rotation: o.rotation,
          ...(o.type === "text"
            ? {
                text: o.text,
                font_id: o.fontId,
                font_size: o.fontSize,
                color: o.color,
                bold: o.bold,
                italic: o.italic,
                align: o.align,
              }
            : {}),
        })),
        edits: page.edits.map((e) => ({
          edit_id: e.hotspotId,
          hotspot_id: e.originalHotspotId,
          type: e.type,
          ...(e.type === "text" ? { value: e.value, lines: e.lines, font_size: e.fontSize } : {}),
          ...(e.type === "image" && "remove" in e ? { remove: true } : {}),
        })),
      })),
    ),
  )
  for (const page of pagePlan) {
    for (const e of page.edits) {
      if (e.type === "image" && !("remove" in e)) form.append(`image_${e.hotspotId}`, e.file)
    }
    for (const o of page.overlays ?? []) {
      const file = overlayFiles[o.id]
      if (o.type === "image" && file) form.append(`overlay_${o.id}`, file)
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
