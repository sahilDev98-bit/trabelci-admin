export const businessPartnersQueryKeys = {
  all: ["businessPartners"] as const,
  detail: (id: string) => ["businessPartners", id] as const,
  users: (id: string) => ["businessPartners", id, "users"] as const,
} as const
