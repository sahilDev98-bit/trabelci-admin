import type { UserRole } from "@/types/auth"

export type { UserRole } from "@/types/auth"

export const USER_ROLES = {
  ADMIN: "ADMIN",
  MERCHANT: "MERCHANT",
  EMPLOYEE: "EMPLOYEE",
} as const

export const normalizeRole = (rawRole: string | null | undefined): UserRole | null => {
  const value = String(rawRole ?? "").trim().toUpperCase()
  if (value === USER_ROLES.ADMIN || value === "SUPER_ADMIN") return USER_ROLES.ADMIN
  if (value === USER_ROLES.MERCHANT) return USER_ROLES.MERCHANT
  if (
    value === USER_ROLES.EMPLOYEE ||
    value === "AGENT" ||
    value === "SHOWROOM_AGENT" ||
    value === "WAREHOUSE_STAFF"
  ) {
    return USER_ROLES.EMPLOYEE
  }
  return null
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  MERCHANT: "Merchant",
  EMPLOYEE: "Employee",
}

export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  ADMIN: "bg-red-500/15 text-red-700 dark:text-red-400",
  MERCHANT: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  EMPLOYEE: "bg-green-500/15 text-green-700 dark:text-green-400",
}
