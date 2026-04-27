import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { bpAssignmentKeys } from "./queryKeys"
import type {
  BPAssignments,
  EffectiveProduct,
  GroupIdsPayload,
  ProductIdsPayload,
} from "./types"

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function fetchBPAssignments(bpId: string): Promise<BPAssignments> {
  const res = await apiFetch<{ success: true; assignments: BPAssignments }>(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments`, { method: "GET" })
  return res.assignments
}

async function assignGroups({ bpId, payload }: { bpId: string; payload: GroupIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/groups`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

async function removeGroups({ bpId, payload }: { bpId: string; payload: GroupIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/groups`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  })
}

async function assignProducts({ bpId, payload }: { bpId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/products`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

async function removeProducts({ bpId, payload }: { bpId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/products`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  })
}

async function excludeProducts({ bpId, payload }: { bpId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/exclusions`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

async function removeExclusions({ bpId, payload }: { bpId: string; payload: ProductIdsPayload }): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/assignments/exclusions`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  })
}

async function fetchEffectiveProducts(bpId: string): Promise<EffectiveProduct[]> {
  const res = await apiFetch<{ success: true; products: EffectiveProduct[] }>(`${API_ENDPOINTS.BUSINESS_PARTNER_ASSIGNMENTS}/${bpId}/effective-products`, { method: "GET" })
  return res.products ?? []
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

export function useBPAssignmentsQuery(bpId: string | null) {
  return useQuery({
    queryKey: bpId ? bpAssignmentKeys.assignments(bpId) : bpAssignmentKeys.all,
    queryFn: () => fetchBPAssignments(bpId!),
    enabled: Boolean(bpId),
  })
}

export function useEffectiveProductsQuery(bpId: string | null) {
  return useQuery({
    queryKey: bpId ? bpAssignmentKeys.effectiveProducts(bpId) : bpAssignmentKeys.all,
    queryFn: () => fetchEffectiveProducts(bpId!),
    enabled: Boolean(bpId),
  })
}

export function useAssignGroupsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GroupIdsPayload) => assignGroups({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}

export function useRemoveGroupsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: GroupIdsPayload) => removeGroups({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}

export function useAssignProductsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => assignProducts({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}

export function useRemoveProductsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => removeProducts({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}

export function useExcludeProductsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => excludeProducts({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}

export function useRemoveExclusionsMutation(bpId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: ProductIdsPayload) => removeExclusions({ bpId, payload }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.assignments(bpId) }),
        qc.invalidateQueries({ queryKey: bpAssignmentKeys.effectiveProducts(bpId) }),
      ])
    },
  })
}
