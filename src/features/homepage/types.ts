export interface CarouselItemProduct {
  id: string
  sku: string
  name: string
  coverUrl: string | null
}

export interface CarouselItem {
  id: string
  productId: string
  sortOrder: number
  product: CarouselItemProduct
}

export interface CategoryPin {
  id: string
  categoryId: string
  productId: string
  sortOrder: number
  product: CarouselItemProduct
}

export interface HomepageConfig {
  carousel: CarouselItem[]
  categoryPins: Record<string, CategoryPin[]>
}
