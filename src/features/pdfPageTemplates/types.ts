import type { PdfRect } from "@/lib/pdf-engine"

/**
 * A reusable PAGE design — Point 5 of the client's brief.
 *
 * A page laid out once, in which certain boxes are marked as holding a
 * product's photo, name, SKU, size or price. Any product can then be poured
 * into it, so one design serves a hundred products.
 */

/** One box on the template page that holds a product detail. */
export interface PdfTemplateSlot {
  /** A PRODUCT_FIELDS id, or "photo". */
  fieldId: string
  kind: "text" | "image" | "vector"
  /** Which product on the page this belongs to. Always 0 today — one product
   * per page — and present because the brief asks for two-, four- and
   * six-product pages, which is the only thing that will tell them apart. */
  productIndex: number
  /** In the saved page's own PDF coordinates, so it stays correct however the
   * page is later placed. */
  bbox: PdfRect
}

export interface PdfPageTemplate {
  id: string
  name: string
  description: string | null
  category: string
  supplier: string | null
  /** Shown in the library list. Points straight at R2, which needs no CORS
   * to DISPLAY — only reading bytes does. */
  previewUrl: string | null
  widthPts: number
  heightPts: number
  slots: PdfTemplateSlot[]
  /** How many distinct products the page holds. */
  productCount: number
  createdAt: string | null
}
