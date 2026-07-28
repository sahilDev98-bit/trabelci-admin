export type PdfTemplateType = "html" | "pdf_master"

export interface PdfTemplate {
  id: string
  name: string
  description: string | null
  html_content: string | null
  template_type: PdfTemplateType
  source_pdf_url: string | null
  preview_image_url: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreatePdfTemplateInput {
  name: string
  description?: string
  html_content: string
}

export interface UpdatePdfTemplateInput {
  name?: string
  description?: string
  html_content?: string
}

// ─── PDF master (in-place editing) ────────────────────────────────────────────

export interface PdfHotspotBase {
  /** Namespaced as `${editorPage.clientId}:${originalId}` — unique per editor
   * page *instance*, so a duplicated page's hotspots don't collide with the
   * page it was duplicated from (see EditorPage). */
  id: string
  /** The plain hotspot id from the one-time analysis, before namespacing —
   * this is the id the server's own session metadata actually knows about. */
  originalId: string
  /** The ORIGINAL pristine document's page number this hotspot belongs to.
   * Stable regardless of how pages get reordered/duplicated/removed in the
   * editor — it's a reference into the analysis result, not display order. */
  page: number
  /** [x0, y0, x1, y1] in PDF points, top-left origin */
  bbox: [number, number, number, number]
}

export interface PdfTextHotspot extends PdfHotspotBase {
  type: "text"
  text: string
  font: string
  size: number
  color: number
  rtl: boolean
}

export interface PdfImageHotspot extends PdfHotspotBase {
  type: "image"
}

export type PdfHotspot = PdfTextHotspot | PdfImageHotspot

export interface PdfSessionPage {
  page: number
  width: number
  height: number
}

/**
 * One page as currently arranged in the editor — distinct from
 * PdfSessionPage (the one-time analysis result). Pages can be duplicated or
 * removed after "Use Template" without re-running analysis, so this is what
 * actually drives display order/composition; PdfSessionPage stays the fixed
 * source of truth for "what page N of the original document looks like."
 */
export interface EditorPage {
  /** Stable client-generated id — keys canvases/page-states/hotspot
   * namespacing. Never derived from array position, since that shifts
   * whenever a page is added/removed/reordered. */
  clientId: string
  /** Which page of the ORIGINAL pristine document this displays. The same
   * originalPage can appear in more than one EditorPage (duplicates). */
  originalPage: number
  width: number
  height: number
}

export interface PdfSession {
  session_id: string
  templateId: string
  templateName: string
  page_count: number
  pages: PdfSessionPage[]
  hotspots: PdfHotspot[]
}

/** Immediate response from starting a session — analysis runs as a background
 * job (can take minutes for a large catalog), so this returns right away with
 * a jobId instead of the full session. Poll fetchPdfMasterSessionJobStatus
 * with it until status is "done". */
export interface PdfSessionJobStart {
  jobId: string
  templateId: string
  templateName: string
}

export type PdfSessionJobResult = Omit<PdfSession, "templateId" | "templateName">

export type PdfSessionJobStatus =
  | { status: "pending" }
  | { status: "done"; result: PdfSessionJobResult }
  | { status: "failed"; error: string }
