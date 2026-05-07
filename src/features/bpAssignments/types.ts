export interface BPAssignments {
  groups: AssignedGroup[]
  products: AssignedProduct[]
  exclusions: ExcludedProduct[]
}

export interface AssignedGroup {
  id: number
  group_id: number
  group_name?: string | null
  assigned_by: string | null
  starts_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface AssignedProduct {
  id: number
  product_id: number
  product_name?: string | null
  product_sku?: string | null
  assigned_by: string | null
  starts_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface ExcludedProduct {
  id: number
  product_id: number
  product_name?: string | null
  product_sku?: string | null
  excluded_by: string | null
  starts_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface GroupIdsPayload {
  groupIds: number[]
  startsAt?: string
  expiresAt?: string
}

export interface ProductIdsPayload {
  productIds: number[]
  startsAt?: string
  expiresAt?: string
}

export interface EffectiveProduct {
  id: string
  sku: string
  name: string
  size: string | null
  unitPrice: number | null
  dealerPrice: number | null
  stockQuantity: number | null
  coverUrl: string | null
  images: string[]
}

export interface EffectiveProductsPage {
  products: EffectiveProduct[]
  total: number
  page: number
  limit: number
}
