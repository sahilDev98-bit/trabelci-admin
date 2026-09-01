import type { CatalogProduct } from "@/features/catalogProducts/types"

/**
 * Dragging a product out of the product panel and onto a page.
 *
 * Deliberately the same shape as assetDrag.ts, and for the same hard-won
 * reasons: a custom MIME type rather than "text/plain", because a browser will
 * not let a page READ drag data during dragover — only the list of TYPES —
 * so without one the page cannot decide whether to light up as a drop target
 * until the drop has already happened.
 *
 * What travels is the whole product, not an id. The alternative — carrying an
 * id and re-fetching on drop — would put a network round trip between letting
 * go and seeing anything, and would fail outright if the search results had
 * moved on. The product is a small object and the panel already holds it.
 */

export const PRODUCT_DRAG_MIME = "application/x-trabelci-pdf-product"

/** Attach a product to a drag that is starting. */
export function setProductDragData(dataTransfer: DataTransfer, product: CatalogProduct): void {
  dataTransfer.setData(PRODUCT_DRAG_MIME, JSON.stringify(product))
  // A legible plain-text copy as well, so dragging a product into a text field
  // or another application does something harmless and recognisable rather
  // than dumping JSON.
  dataTransfer.setData("text/plain", [product.sku, product.name].filter(Boolean).join(" "))
  dataTransfer.effectAllowed = "copy"
}

/**
 * Whether a drag in flight is carrying a product.
 *
 * Reads the TYPE LIST, not the data, because that is all the browser exposes
 * while the pointer is still moving.
 */
export function dragCarriesProduct(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types ?? []).includes(PRODUCT_DRAG_MIME)
}

/**
 * The product from a completed drop, or null.
 *
 * Parsed defensively: this string came off a DataTransfer, which anything on
 * the machine can write to. A drop that cannot be read must do nothing at all
 * rather than throw inside a drop handler, where the error would be invisible.
 */
export function productFromDrag(dataTransfer: DataTransfer | null): CatalogProduct | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(PRODUCT_DRAG_MIME)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const candidate = parsed as Partial<CatalogProduct>
    // id and sku are what every downstream step needs — the id to fetch the
    // photo, the sku to identify what was placed. Anything without both is not
    // a product this editor can use.
    if (typeof candidate.id !== "string" || typeof candidate.sku !== "string") return null
    return candidate as CatalogProduct
  } catch {
    return null
  }
}
