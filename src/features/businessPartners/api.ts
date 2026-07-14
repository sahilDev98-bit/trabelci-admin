import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { businessPartnersQueryKeys } from "./queryKeys"
import type {
  CreateBusinessPartnerInput,
  UpdateBusinessPartnerInput,
  BusinessPartner,
  BPUser,
  SapBpLookupResult,
  RefreshFromSapResponse,
} from "./types"

type BusinessPartnerRow = {
  id: number
  name: string
  email: string | null
  card_code: string | null
  card_name: string | null
  card_type: string | null
  is_active: boolean
  price_multiplier: number | null
  sap_sync_status: string | null
  synced_at: string | null
  created_by: string | null
  created_at: string | null
  sku_default_country: string | null
  sku_default_display_name_en: string | null
  sku_default_supplier_sku: string | null
}

type UserProfileRow = {
  user_id: string
  email: string
  display_name: string
  role: string
  parent_user_id: string | null
  created_at: string | null
}

const mapUserRow = (row: UserProfileRow): BPUser => ({
  userId: row.user_id,
  email: row.email,
  displayName: row.display_name,
  role: row.role,
  parentUserId: row.parent_user_id,
  createdAt: row.created_at,
})

const mapBusinessPartnerRow = (row: BusinessPartnerRow): BusinessPartner => ({
  id: String(row.id),
  name: row.name,
  email: row.email,
  cardCode: row.card_code,
  cardName: row.card_name,
  cardType: row.card_type,
  isActive: row.is_active,
  priceMultiplier: row.price_multiplier ?? 1.0,
  sapSyncStatus: row.sap_sync_status,
  syncedAt: row.synced_at,
  createdBy: row.created_by,
  createdAt: row.created_at,
  skuDefaultCountry: row.sku_default_country,
  skuDefaultDisplayNameEn: row.sku_default_display_name_en,
  skuDefaultSupplierSku: row.sku_default_supplier_sku,
})

async function fetchBusinessPartners(): Promise<BusinessPartner[]> {
  const res = await apiFetch<{ success: true; businessPartners: BusinessPartnerRow[] }>(API_ENDPOINTS.BUSINESS_PARTNERS, {
    method: "GET",
  })
  return (res.businessPartners ?? []).map(mapBusinessPartnerRow)
}

async function createBusinessPartner(input: CreateBusinessPartnerInput): Promise<void> {
  await apiFetch(API_ENDPOINTS.BUSINESS_PARTNERS, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function lookupSapBp(cardCode: string): Promise<SapBpLookupResult> {
  const params = new URLSearchParams({ cardCode })
  const res = await apiFetch<{ success: true; sapBusinessPartner: SapBpLookupResult }>(
    `${API_ENDPOINTS.BUSINESS_PARTNERS}/sap-lookup?${params}`,
    { method: "GET" },
  )
  return res.sapBusinessPartner
}

type RefreshFromSapResponseRaw = {
  refreshedCount: number
  failedCount: number
  failed: { id: number; reason: string }[]
}

async function bulkRefreshBusinessPartnersFromSap(): Promise<RefreshFromSapResponse> {
  const res = await apiFetch<{ success: true } & RefreshFromSapResponseRaw>(
    `${API_ENDPOINTS.BUSINESS_PARTNERS}/refresh-from-sap`,
    { method: "POST" },
  )
  return {
    refreshedCount: res.refreshedCount,
    failedCount: res.failedCount,
    failed: (res.failed ?? []).map((f) => ({ id: String(f.id), reason: f.reason })),
  }
}

export function useBulkRefreshBusinessPartnersFromSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkRefreshBusinessPartnersFromSap,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

async function refreshBusinessPartnerFromSap(id: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}/refresh-from-sap`, {
    method: "POST",
  })
}

export function useRefreshBusinessPartnerFromSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: refreshBusinessPartnerFromSap,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

async function linkBusinessPartnerToSap({ id, cardCode }: { id: string; cardCode: string }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}/link-sap`, {
    method: "POST",
    body: JSON.stringify({ cardCode }),
  })
}

export function useLinkBusinessPartnerToSapMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: linkBusinessPartnerToSap,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

async function fetchBusinessPartner(id: string): Promise<BusinessPartner> {
  const res = await apiFetch<{ success: true; businessPartner: BusinessPartnerRow }>(
    `${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}`,
    { method: "GET" },
  )
  return mapBusinessPartnerRow(res.businessPartner)
}

async function fetchBusinessPartnerUsers(bpId: string): Promise<BPUser[]> {
  const res = await apiFetch<{ success: true; users: UserProfileRow[] }>(
    `${API_ENDPOINTS.BUSINESS_PARTNERS}/${bpId}/users`,
    { method: "GET" },
  )
  return (res.users ?? []).map(mapUserRow)
}

export function useBusinessPartnersQuery() {
  return useQuery({
    queryKey: businessPartnersQueryKeys.all,
    queryFn: fetchBusinessPartners,
  })
}

export function useBusinessPartnerQuery(id: string | null) {
  return useQuery({
    queryKey: id ? businessPartnersQueryKeys.detail(id) : businessPartnersQueryKeys.all,
    queryFn: () => fetchBusinessPartner(id!),
    enabled: Boolean(id),
  })
}

export function useBusinessPartnerUsersQuery(bpId: string | null) {
  return useQuery({
    queryKey: bpId ? businessPartnersQueryKeys.users(bpId) : businessPartnersQueryKeys.all,
    queryFn: () => fetchBusinessPartnerUsers(bpId!),
    enabled: Boolean(bpId),
  })
}

export function useCreateBusinessPartnerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createBusinessPartner,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

async function updateBusinessPartner({ id, ...input }: UpdateBusinessPartnerInput & { id: string }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

async function deleteBusinessPartner(id: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}`, {
    method: "DELETE",
  })
}

async function toggleBusinessPartnerActive({ id, isActive }: { id: string; isActive: boolean }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}/active`, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  })
}

export function useUpdateBusinessPartnerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateBusinessPartner,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

export function useDeleteBusinessPartnerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteBusinessPartner,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

export function useToggleBusinessPartnerActiveMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: toggleBusinessPartnerActive,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}

async function updateBusinessPartnerMultiplier({ id, priceMultiplier }: { id: string; priceMultiplier: number }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNERS}/${id}/price-multiplier`, {
    method: "PATCH",
    body: JSON.stringify({ priceMultiplier }),
  })
}

export function useUpdateBusinessPartnerMultiplierMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateBusinessPartnerMultiplier,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: businessPartnersQueryKeys.all })
    },
  })
}
