export const productsQueryKeys = {
  all: ["products"] as const,
  list: ["products", "list"] as const,
  listPage: (page: number, pageSize: number, search: string) =>
    ["products", "list", page, pageSize, search] as const,
  byId: (id: string) => ["products", "byId", id] as const,
} as const

