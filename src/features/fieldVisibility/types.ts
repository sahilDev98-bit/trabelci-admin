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
  // Timestamp of the override row this was loaded from (null if the user has
  // no override yet). Round-tripped as expectedUpdatedAt on save so the
  // backend can detect a concurrent edit (optimistic concurrency control).
  updatedAt: string | null
}

export interface BPUsersFieldVisibilityResponse {
  bpConfig: FieldVisibilityConfig | null
  users: UserFieldOverride[]
}
