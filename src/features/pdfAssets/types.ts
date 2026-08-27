/**
 * The shared library of artwork the Create PDF editor draws on: company and
 * supplier logos, technical and certification icons, badges, backgrounds,
 * frames and decorative elements.
 *
 * Kept on the server rather than on whoever's laptop made the last catalogue,
 * which is the whole point — everyone reaches the same shelf and there is one
 * current version of each logo.
 */

/** Free text in the database so a new kind needs no migration, but only these
 * are offered — a typo must not create a category nobody will look in. */
export const ASSET_CATEGORIES = ["logo", "icon", "badge", "background", "other"] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]

export interface PdfAsset {
  id: string
  name: string
  category: AssetCategory
  /** Which supplier or brand this belongs to; null for company-wide artwork. */
  supplier: string | null
  /** R2 public URL. Fine for an <img> thumbnail, but NOT fetchable from the
   * browser — R2 serves these without CORS headers. Placing an asset in a
   * document goes through the API instead (see assetFileUrl). */
  fileUrl: string
  mimeType: string
  /** Pixel size as uploaded, so a dropped asset keeps its aspect ratio
   * without having to be downloaded and decoded first. */
  widthPx: number | null
  heightPx: number | null
  fileSize: number | null
  createdAt: string | null
}

export interface CreatePdfAssetInput {
  file: File
  name: string
  category: AssetCategory
  supplier?: string | null
  widthPx?: number | null
  heightPx?: number | null
}

export interface UpdatePdfAssetInput {
  id: string
  name?: string
  category?: AssetCategory
  supplier?: string | null
}
