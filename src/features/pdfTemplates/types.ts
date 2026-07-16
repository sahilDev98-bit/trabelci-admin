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
  id: string
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
