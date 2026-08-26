export const catalogProductsQueryKeys = {
  all: ["catalogProducts"] as const,
  search: (term: string) => ["catalogProducts", "search", term] as const,
} as const
