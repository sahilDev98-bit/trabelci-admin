export const fieldVisibilityKeys = {
  all: ["field-visibility"] as const,
  fields: ["field-visibility", "fields"] as const,
  config: (scope: string) => ["field-visibility", "config", scope] as const,
  bpUsers: (bpId: string) => ["field-visibility", "bp-users", bpId] as const,
} as const
