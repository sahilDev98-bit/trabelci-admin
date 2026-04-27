export const productGroupKeys = {
  all: ["productGroups"] as const,
  lists: () => [...productGroupKeys.all, "list"] as const,
  list: () => [...productGroupKeys.lists()] as const,
  details: () => [...productGroupKeys.all, "detail"] as const,
  detail: (id: string) => [...productGroupKeys.details(), id] as const,
  products: (id: string) => [...productGroupKeys.all, "products", id] as const,
} as const
