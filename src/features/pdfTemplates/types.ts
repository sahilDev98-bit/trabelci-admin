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
