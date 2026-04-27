import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { normalizeRole } from "@/lib/roles"
import { usersQueryKeys } from "./queryKeys"
import type { AdminUser, CreateUserInput, UpdateUserInput } from "./types"
import type { UserMetadata, UserPreferences } from "./types"

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
  metadata: unknown
  preferences: unknown
}

const asRecordOrNull = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const mapMetadata = (value: unknown): UserMetadata | null => {
  const r = asRecordOrNull(value)
  if (!r) return null
  const loginCount = typeof r.loginCount === "number" ? r.loginCount : undefined
  const lastLogin = typeof r.lastLogin === "string" ? r.lastLogin : r.lastLogin === null ? null : undefined
  const legacyRole = typeof r.legacyRole === "string" ? r.legacyRole : undefined
  return { loginCount, lastLogin, legacyRole }
}

const mapPreferences = (value: unknown): UserPreferences | null => {
  const r = asRecordOrNull(value)
  if (!r) return null
  const notifications = typeof r.notifications === "boolean" ? r.notifications : undefined
  const useBiometric = typeof r.useBiometric === "boolean" ? r.useBiometric : undefined
  return { notifications, useBiometric }
}

const mapUserRow = (row: UserProfileRow): AdminUser => ({
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
  metadata: mapMetadata(row.metadata),
  preferences: mapPreferences(row.preferences),
})

async function fetchUsers(): Promise<AdminUser[]> {
  const res = await apiFetch<{ success: true; users: UserProfileRow[] }>(API_ENDPOINTS.USERS, {
    method: "GET",
  })
  return (res.users ?? []).map(mapUserRow)
}

async function fetchUserById(uid: string): Promise<AdminUser> {
  const res = await apiFetch<{ success: true; user: unknown }>(`${API_ENDPOINTS.USERS}/${uid}`, {
    method: "GET",
  })

  const u = asRecordOrNull(res.user) ?? {}
  const roleRaw = typeof u.role === "string" ? u.role : "EMPLOYEE"

  const businessPartnerIdRaw = (u.business_partner_id ?? (u as Record<string, unknown>).businessPartnerId) as number | string | null | undefined
  const parentUserIdRaw = (u.parent_user_id ??
    (u as Record<string, unknown>).parentUserId) as string | null | undefined

  return {
    uid: String(u.user_id ?? u.uid ?? uid),
    email: String(u.email ?? ""),
    display_name: String(u.display_name ?? u.display_name ?? u.email ?? ""),
    role: normalizeRole(roleRaw) ?? "EMPLOYEE",
    business_partner_id:
      typeof businessPartnerIdRaw === "number"
        ? String(businessPartnerIdRaw)
        : typeof businessPartnerIdRaw === "string" && businessPartnerIdRaw.trim()
          ? businessPartnerIdRaw
          : null,
    parent_user_id: typeof parentUserIdRaw === "string" && parentUserIdRaw.trim() ? parentUserIdRaw : null,
    card_code: typeof u.card_code === "string" ? u.card_code : typeof (u as Record<string, unknown>).card_code === "string" ? (u as Record<string, unknown>).card_code as string : null,
    card_name: typeof u.card_name === "string" ? u.card_name : typeof (u as Record<string, unknown>).card_name === "string" ? (u as Record<string, unknown>).card_name as string : null,
    card_type: typeof u.card_type === "string" ? u.card_type : typeof (u as Record<string, unknown>).card_type === "string" ? (u as Record<string, unknown>).card_type as string : null,
    created_at:
      typeof u.created_at === "string"
        ? u.created_at
        : typeof (u as Record<string, unknown>).createdAt === "string"
          ? ((u as Record<string, unknown>).createdAt as string)
          : null,
    updated_at:
      typeof u.updated_at === "string"
        ? u.updated_at
        : typeof (u as Record<string, unknown>).updatedAt === "string"
          ? ((u as Record<string, unknown>).updatedAt as string)
          : null,
    metadata: mapMetadata((u as Record<string, unknown>).metadata ?? null),
    preferences: mapPreferences((u as Record<string, unknown>).preferences ?? null),
  }
}

async function createUser(input: CreateUserInput): Promise<void> {
  await apiFetch(API_ENDPOINTS.USERS, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

async function updateUser(input: UpdateUserInput): Promise<void> {
  const { uid, ...rest } = input
  await apiFetch(`${API_ENDPOINTS.USERS}/${uid}`, {
    method: "PATCH",
    body: JSON.stringify(rest),
  })
}

async function deleteUser(uid: string): Promise<void> {
  await apiFetch(`${API_ENDPOINTS.USERS}/${uid}`, { method: "DELETE" })
}

export function useUsersQuery() {
  return useQuery({
    queryKey: usersQueryKeys.all,
    queryFn: fetchUsers,
  })
}

export function useUserByIdQuery(uid: string | null) {
  return useQuery({
    queryKey: uid ? usersQueryKeys.byId(uid) : ["users", "byId", "null"],
    queryFn: () => fetchUserById(uid!),
    enabled: Boolean(uid),
  })
}

export function useCreateUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}

export function useUpdateUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: updateUser,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: usersQueryKeys.all }),
        qc.invalidateQueries({ queryKey: usersQueryKeys.byId(variables.uid) }),
      ])
    },
  })
}

export function useDeleteUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: usersQueryKeys.all })
    },
  })
}

