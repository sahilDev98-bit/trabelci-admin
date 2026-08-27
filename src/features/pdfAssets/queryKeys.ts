export const pdfAssetsQueryKeys = {
  all: ["pdfAssets"] as const,
  list: (filters: { category?: string | null; supplier?: string | null; search?: string }) =>
    ["pdfAssets", "list", filters] as const,
} as const
