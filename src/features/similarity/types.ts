export type RecomputeStatus = {
  isRunning: boolean
  startedAt: string | null
  completed: number
  total: number
  failed: number
}

export type CatalogEmbeddingStats = {
  totalProducts: number
  withEmbeddings: number
  withSimilarities: number
  lastFullRecompute: string | null
}

export type SimilarityGlobalStatus = {
  recompute: RecomputeStatus
  catalog: CatalogEmbeddingStats
}

export type AnalyzeAllResponse = {
  success: boolean
  message: string
  totalProducts: number
  totalChunks: number
  batchSize: number
  concurrency: number
}

export type SimilarProduct = {
  id: string
  sku: string
  name: string
  coverUrl: string | null
  unitPrice: number | null
  dealerPrice: number | null
  categoryId: number | null
  score: number
}
