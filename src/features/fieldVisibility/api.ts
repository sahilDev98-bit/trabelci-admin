import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { fieldVisibilityKeys } from "./queryKeys"
import type {
  FieldDefinition,
  FieldVisibilityConfig,
  BPUsersFieldVisibilityResponse,
} from "./types"

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchAvailableFields(): Promise<FieldDefinition[]> {
  const res = await apiFetch<{
    success: true
    fields: FieldDefinition[]
  }>(API_ENDPOINTS.FIELD_VISIBILITY_FIELDS, { method: "GET" })

  return res.fields ?? []
}

async function fetchFieldVisibilityForBP(
  businessPartnerId: string,
): Promise<FieldVisibilityConfig | null> {
  const res = await apiFetch<{
    success: true
    config: FieldVisibilityConfig | null
  }>(`${API_ENDPOINTS.FIELD_VISIBILITY}?businessPartnerId=${businessPartnerId}`, {
    method: "GET",
  })

  return res.config
}

async function fetchFieldVisibilityForUser(
  userId: string,
): Promise<FieldVisibilityConfig | null> {
  const res = await apiFetch<{
    success: true
    config: FieldVisibilityConfig | null
  }>(`${API_ENDPOINTS.FIELD_VISIBILITY}?userId=${userId}`, { method: "GET" })

  return res.config
}

async function fetchBPUsersFieldVisibility(
  businessPartnerId: string,
): Promise<BPUsersFieldVisibilityResponse> {
  const res = await apiFetch<{
    success: true
    bpConfig: FieldVisibilityConfig | null
    users: BPUsersFieldVisibilityResponse["users"]
  }>(`${API_ENDPOINTS.FIELD_VISIBILITY_BP_USERS}/${businessPartnerId}/users`, {
    method: "GET",
  })

  return { bpConfig: res.bpConfig, users: res.users ?? [] }
}

async function updateFieldVisibility(input: {
  businessPartnerId?: number
  userId?: string
  visibleFields: string[]
  // The updatedAt of the config as last loaded by this client. The backend
  // rejects the save with a 409 if the row has since changed (optimistic
  // concurrency control — see BUG-029). Omit/null when creating a config for
  // a BP/user that doesn't have one yet.
  expectedUpdatedAt?: string | null
}): Promise<FieldVisibilityConfig> {
  const res = await apiFetch<{
    success: true
    config: FieldVisibilityConfig
  }>(API_ENDPOINTS.FIELD_VISIBILITY, {
    method: "PUT",
    body: JSON.stringify(input),
  })

  return res.config
}

async function deleteUserFieldVisibility(userId: string): Promise<void> {
  await apiFetch<{ success: true }>(
    `${API_ENDPOINTS.FIELD_VISIBILITY}/user/${userId}`,
    { method: "DELETE" },
  )
}

// ── Query hooks ──────────────────────────────────────────────────────────────

export function useAvailableFieldsQuery() {
  return useQuery({
    queryKey: fieldVisibilityKeys.fields,
    queryFn: fetchAvailableFields,
    staleTime: 0,
  })
}

export function useFieldVisibilityForBPQuery(businessPartnerId: string | null) {
  return useQuery({
    queryKey: businessPartnerId
      ? fieldVisibilityKeys.config(`bp:${businessPartnerId}`)
      : ["field-visibility", "config", "null"],
    queryFn: () => fetchFieldVisibilityForBP(businessPartnerId!),
    enabled: Boolean(businessPartnerId),
  })
}

export function useFieldVisibilityForUserQuery(userId: string | null) {
  return useQuery({
    queryKey: userId
      ? fieldVisibilityKeys.config(`user:${userId}`)
      : ["field-visibility", "config", "null"],
    queryFn: () => fetchFieldVisibilityForUser(userId!),
    enabled: Boolean(userId),
  })
}

export function useBPUsersFieldVisibilityQuery(businessPartnerId: string | null) {
  return useQuery({
    queryKey: businessPartnerId
      ? fieldVisibilityKeys.bpUsers(businessPartnerId)
      : ["field-visibility", "bp-users", "null"],
    queryFn: () => fetchBPUsersFieldVisibility(businessPartnerId!),
    enabled: Boolean(businessPartnerId),
  })
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

export function useUpdateFieldVisibilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateFieldVisibility,
    onSuccess: async (_data, variables) => {
      if (variables.businessPartnerId) {
        await qc.invalidateQueries({
          queryKey: fieldVisibilityKeys.config(`bp:${variables.businessPartnerId}`),
        })
        await qc.invalidateQueries({
          queryKey: fieldVisibilityKeys.bpUsers(String(variables.businessPartnerId)),
        })
      }
      if (variables.userId) {
        await qc.invalidateQueries({
          queryKey: fieldVisibilityKeys.config(`user:${variables.userId}`),
        })
      }
    },
  })
}

export function useDeleteUserFieldVisibilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteUserFieldVisibility,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: fieldVisibilityKeys.all })
    },
  })
}
