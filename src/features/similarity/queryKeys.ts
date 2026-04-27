export const similarityQueryKeys = {
  all: ["similarity"] as const,
  globalStatus: ["similarity", "globalStatus"] as const,
  productStatus: (productId: string) => ["similarity", "productStatus", productId] as const,
  similarProducts: (productId: string) => ["similarity", "similarProducts", productId] as const,
} as const
