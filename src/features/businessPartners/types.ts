export interface BusinessPartner {
  id: string
  name: string
  email?: string | null
  cardCode?: string | null
  cardName?: string | null
  cardType?: string | null
  isActive: boolean
  priceMultiplier: number
  sapSyncStatus?: string | null
  syncedAt?: string | null
  createdBy?: string | null
  createdAt?: string | null
  skuDefaultCountry?: string | null
  skuDefaultDisplayNameEn?: string | null
  skuDefaultSupplierSku?: string | null
}

export interface BPUser {
  userId: string
  email: string
  displayName: string
  role: string
  parentUserId: string | null
  createdAt: string | null
}

export interface CreateBusinessPartnerInput {
  name: string
  email: string
  card_code?: string
  card_name?: string
}

export interface UpdateBusinessPartnerInput {
  name: string
  email: string
  sku_default_country?: string | null
  sku_default_display_name_en?: string | null
  sku_default_supplier_sku?: string | null
}

export interface SapBpLookupResult {
  CardCode: string
  CardName: string
}
