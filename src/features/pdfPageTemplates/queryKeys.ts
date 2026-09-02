export const pdfPageTemplatesQueryKeys = {
  all: ["pdfPageTemplates"] as const,
  list: (filters: { category?: string | null; supplier?: string | null }) =>
    ["pdfPageTemplates", "list", filters] as const,
} as const
