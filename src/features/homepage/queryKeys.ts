export const homepageQueryKeys = {
  all: ["homepage"] as const,
  config: ["homepage", "config"] as const,
  carousel: ["homepage", "carousel"] as const,
  categoryPins: (categoryId: string) => ["homepage", "categoryPins", categoryId] as const,
} as const
