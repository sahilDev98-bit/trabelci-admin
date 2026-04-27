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
}

export interface UpdateBusinessPartnerInput {
  name: string
  email: string
}
