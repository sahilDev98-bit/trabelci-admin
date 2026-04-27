import type { UserRole } from "@/types/auth"

export interface UserPreferences {
  notifications?: boolean
  useBiometric?: boolean
}

export interface UserMetadata {
  loginCount?: number
  lastLogin?: string | null
  legacyRole?: string
}

export interface AdminUser {
  uid: string
  email: string
  display_name: string
  role: UserRole
  business_partner_id?: string | null
  parent_user_id?: string | null
  card_code?: string | null
  card_name?: string | null
  card_type?: string | null
  created_at?: string | null
  updated_at?: string | null
  metadata?: UserMetadata | null
  preferences?: UserPreferences | null
}

export interface CreateUserInput {
  email: string
  password: string
  displayName: string
  role: UserRole
  businessPartnerId?: string
  parentUserId?: string
}

export interface UpdateUserInput {
  uid: string
  displayName?: string
  role?: UserRole
  password?: string
  preferences?: UserPreferences
  businessPartnerId?: string
  parentUserId?: string
}
