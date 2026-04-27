export interface Category {
  id: string
  sapId: string
  name: string
  iconUrl?: string | null
  sortOrder: number
  isHidden: boolean
  productCount: number
}

export interface UpdateCategoryIconInput {
  sapId: string
  hasIcon: boolean
  file: File
}

export interface CreateCategoryInput {
  name: string
  sapId: string
}

export interface UpdateCategoryInput {
  sapId: string
  name: string
}

