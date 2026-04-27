export type UserRole = "ADMIN" | "MERCHANT" | "EMPLOYEE"

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  role: UserRole
}

