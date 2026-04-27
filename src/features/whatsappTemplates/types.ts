export interface WhatsAppTemplate {
  id: number
  businessPartnerId: number | null
  templateEn: string
  templateHe: string
  isDefault: boolean
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  businessPartner?: {
    id: number
    name: string
  } | null
}

export interface WhatsAppTemplatePayload {
  template_en: string
  template_he: string
}
