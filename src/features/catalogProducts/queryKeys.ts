export const catalogProductsQueryKeys = {
  all: ["catalogProducts"] as const,
  search: (term: string) => ["catalogProducts", "search", term] as const,
  collections: () => ["catalogProducts", "collections"] as const,
} as const
