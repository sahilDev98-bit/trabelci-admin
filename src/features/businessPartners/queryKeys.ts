export const businessPartnersQueryKeys = {
  all: ["businessPartners"] as const,
  detail: (id: string) => ["businessPartners", id] as const,
  users: (id: string) => ["businessPartners", id, "users"] as const,
  sapSyncSuggestions: ["businessPartners", "sap-sync-suggestions"] as const,
} as const
