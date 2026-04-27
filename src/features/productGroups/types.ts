export interface ProductGroup {
  id: string
  name: string
  productCount: number
}

export interface ProductGroupDetail extends ProductGroup {
  products: GroupProduct[]
}

export interface GroupProduct {
  id: string
  sku: string
  name: string
  unitPrice: number | null
  dealerPrice: number | null
  coverUrl: string | null
}

export interface CreateProductGroupPayload {
  name: string
}

export interface UpdateProductGroupPayload {
  name?: string
}

export interface ProductIdsPayload {
  productIds: number[]
}
