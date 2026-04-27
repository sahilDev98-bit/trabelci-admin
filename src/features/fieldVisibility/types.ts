export interface FieldDefinition {
  key: string
  label: string
  group: "basic" | "pricing" | "stock" | "location" | "attributes"
}

export interface FieldVisibilityConfig {
  id: string
  businessPartnerId: string | null
  userId: string | null
  visibleFields: string[]
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface UserFieldOverride {
  userId: string
  displayName: string
  email: string
  role: string
  hasOverride: boolean
  visibleFields: string[] | null
}

export interface BPUsersFieldVisibilityResponse {
  bpConfig: FieldVisibilityConfig | null
  users: UserFieldOverride[]
}
