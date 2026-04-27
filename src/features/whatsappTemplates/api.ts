import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { whatsappTemplateQueryKeys } from "./queryKeys"
import type { WhatsAppTemplate, WhatsAppTemplatePayload } from "./types"

// ── Row mapping (Supabase snake_case → camelCase) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): WhatsAppTemplate {
  return {
    id: row.id,
    businessPartnerId: row.business_partner_id ?? null,
    templateEn: row.template_en,
    templateHe: row.template_he,
    isDefault: row.is_default,
    createdBy: row.created_by,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessPartner: row.business_partner ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRowOrNull(row: any): WhatsAppTemplate | null {
  return row ? mapRow(row) : null
}

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchTemplates(): Promise<WhatsAppTemplate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiFetch<{ success: true; templates: any[] }>(
    API_ENDPOINTS.WHATSAPP_TEMPLATES, { method: "GET" },
  )

  return (res.templates ?? []).map(mapRow)
}

async function fetchDefaultTemplate(): Promise<WhatsAppTemplate | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiFetch<{ success: true; template: any }>(
    API_ENDPOINTS.WHATSAPP_TEMPLATE_DEFAULT, { method: "GET" },
  )

  return mapRowOrNull(res.template)
}

async function fetchMerchantTemplate(bpId: string): Promise<WhatsAppTemplate | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiFetch<{ success: true; template: any }>(
    `${API_ENDPOINTS.WHATSAPP_TEMPLATES}/${bpId}`, { method: "GET" },
  )

  return mapRowOrNull(res.template)
}

async function upsertDefaultTemplate(payload: WhatsAppTemplatePayload): Promise<WhatsAppTemplate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiFetch<{ success: true; template: any }>(
    API_ENDPOINTS.WHATSAPP_TEMPLATE_DEFAULT, {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  )

  return mapRow(res.template)
}

async function upsertMerchantTemplate(input: {
  bpId: string
  payload: WhatsAppTemplatePayload
}): Promise<WhatsAppTemplate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await apiFetch<{ success: true; template: any }>(
    `${API_ENDPOINTS.WHATSAPP_TEMPLATES}/${input.bpId}`, {
      method: "PUT",
      body: JSON.stringify(input.payload),
    },
  )

  return mapRow(res.template)
}

async function deleteMerchantTemplate(bpId: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.WHATSAPP_TEMPLATES}/${bpId}`, {
    method: "DELETE",
  })
}

// ── Query hooks ──────────────────────────────────────────────────────────────

export function useWhatsappTemplatesListQuery() {
  return useQuery({
    queryKey: whatsappTemplateQueryKeys.list(),
    queryFn: fetchTemplates,
  })
}

export function useWhatsappDefaultTemplateQuery() {
  return useQuery({
    queryKey: whatsappTemplateQueryKeys.default(),
    queryFn: fetchDefaultTemplate,
  })
}

export function useWhatsappMerchantTemplateQuery(bpId: string | null) {
  return useQuery({
    queryKey: bpId ? whatsappTemplateQueryKeys.byBp(bpId) : ["whatsappTemplates", "bp", "null"],
    queryFn: () => fetchMerchantTemplate(bpId!),
    enabled: Boolean(bpId),
  })
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useUpsertDefaultTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertDefaultTemplate,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: whatsappTemplateQueryKeys.all })
    },
  })
}

export function useUpsertMerchantTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: upsertMerchantTemplate,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: whatsappTemplateQueryKeys.all })
    },
  })
}

export function useDeleteMerchantTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMerchantTemplate,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: whatsappTemplateQueryKeys.all })
    },
  })
}
