export const productImagesQueryKeys = {
  all: ["productImages"] as const,
  bySku: (sku: string) => [...productImagesQueryKeys.all, sku] as const,
} as const
