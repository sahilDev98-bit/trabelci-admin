export type Product = {
  id: string
  sku: string
  name: string
  size: string | null
  unitPrice: number | null
  dealerPrice: number | null
  stockQuantity: number | null
  onHand: number | null
  onOrder: number | null
  isCommitted: number | null
  availableStock: number | null
  stockSyncedAt: string | null
  sapSyncStatus: string
  coverUrl: string | null
  images: string[]
  createdAt: string | null
  updatedAt: string | null
}

export type CreateProductFromSapInput = {
  sku: string
}

export type RefreshProductFromSapInput = {
  id: string
}

export type UpdateProductInput = {
  id: string
  name?: string
  size?: string | null
  unitPrice?: number | null
  dealerPrice?: number | null
  stockQuantity?: number | null
}

export type SapProductPreview = {
  sku: string
  name: string
  size: string | null
  unitPrice: number | null
  dealerPrice: number | null
  stockQuantity: number | null
  categoryName: string | null
}

