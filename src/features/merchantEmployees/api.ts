import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { normalizeRole } from "@/lib/roles"
import type { CreateUserInput, AdminUser } from "@/features/users/types"
import { usersQueryKeys } from "@/features/users/queryKeys"

type MerchantEmployee = AdminUser

type UserProfileRow = {
  user_id: string
  email: string
  display_name: string
  role: string
  business_partner_id: number | null
  parent_user_id: string | null
  card_code: string | null
  card_name: string | null
  card_type: string | null
  created_at: string | null
  updated_at: string | null
  metadata: Record<string, unknown> | null
  preferences: Record<string, unknown> | null
}

function mapRow(row: UserProfileRow): MerchantEmployee {
  return {
    uid: row.user_id,
    email: row.email,
    display_name: row.display_name,
    role: normalizeRole(row.role) ?? "EMPLOYEE",
    business_partner_id: row.business_partner_id != null ? String(row.business_partner_id) : null,
    parent_user_id: row.parent_user_id,
    card_code: row.card_code,
    card_name: row.card_name,
    card_type: row.card_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: row.metadata as MerchantEmployee["metadata"],
    preferences: row.preferences as MerchantEmployee["preferences"],
  }
}

async function fetchMerchantEmployees(): Promise<MerchantEmployee[]> {
  const res = await apiFetch<{ success: true; users: UserProfileRow[] }>(API_ENDPOINTS.MERCHANT_EMPLOYEES, {
    method: "GET",
  })
  return (res.users ?? []).map(mapRow)
}

async function createMerchantEmployee(input: CreateUserInput): Promise<void> {
  await apiFetch(API_ENDPOINTS.MERCHANT_EMPLOYEES, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

async function updateMerchantEmployee(input: { uid: string; displayName?: string; email?: string; password?: string }): Promise<void> {
  const { uid, ...body } = input
  await apiFetch(`${API_ENDPOINTS.MERCHANT_EMPLOYEES}/${uid}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

async function deleteMerchantEmployee(uid: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.MERCHANT_EMPLOYEES}/${uid}`, {
    method: "DELETE",
  })
}

export function useMerchantEmployeesQuery() {
  return useQuery({
    queryKey: usersQueryKeys.all,
    queryFn: fetchMerchantEmployees,
  })
}

export function useCreateMerchantEmployeeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createMerchantEmployee,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}

export function useUpdateMerchantEmployeeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateMerchantEmployee,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}

export function useDeleteMerchantEmployeeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMerchantEmployee,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}
