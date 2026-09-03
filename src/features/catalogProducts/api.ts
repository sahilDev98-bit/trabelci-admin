import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"
import { catalogProductsQueryKeys } from "./queryKeys"
import type { CatalogProduct, CatalogSkuMeta } from "./types"

/**
 * Product lookup against the CATALOG endpoint.
 *
 * /catalog/products is the one the client chose as the source for catalogue
 * data. For an admin it resolves merchantContext to null, which means no
 * visibility filtering and no field hiding — the whole product, exactly as
 * stored. It also merges the SKU metadata block in server-side, which is why
 * Series, Colour and Finish are reachable here without going anywhere near
 * the SKU Management screens.
 */

/** The API's own ceiling (`Math.min(100, ...)` in listVisibleProducts). Asking
 * for more is silently truncated, so ask for exactly what is allowed. */
const SEARCH_LIMIT = 50

/**
 * Below this a search is not run at all.
 *
 * One or two characters match most of the catalogue, so the request is both
 * slow and useless — fifty arbitrary rows tell you nothing about which product
 * you meant. Two is enough to be a real prefix of an SKU.
 */
export const MIN_SEARCH_LENGTH = 2

/** Rows arrive as JSON of unknown shape; nothing below trusts a field it has
 * not checked. A catalogue row with an unexpected null must not blank the
 * panel. */
type RawRecord = Record<string, unknown>

const asString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const mapSkuMeta = (value: unknown): CatalogSkuMeta | null => {
  if (!value || typeof value !== "object") return null
  const row = value as RawRecord
  return {
    supplier: asString(row.supplier),
    supplier_code: asString(row.supplier_code),
    supplier_sku: asString(row.supplier_sku),
    supplier_name_en: asString(row.supplier_name_en),
    series: asString(row.series),
    series_en: asString(row.series_en),
    color: asString(row.color),
    color_en: asString(row.color_en),
    size: asString(row.size),
    finish: asString(row.finish),
    country_of_origin: asString(row.country_of_origin),
    shade: asString(row.shade),
    qty_per_carton: asString(row.qty_per_carton),
    qty_per_pallet: asString(row.qty_per_pallet),
  }
}

const mapProduct = (value: unknown): CatalogProduct | null => {
  if (!value || typeof value !== "object") return null
  const row = value as RawRecord
  const sku = asString(row.sku)
  // A row with no SKU cannot be told apart from any other in the result list,
  // and every field binding is described to the user by its SKU. Dropping it
  // is better than offering a product nobody can identify.
  if (!sku) return null
  return {
    id: String(row.id ?? sku),
    sku,
    name: asString(row.name) ?? "",
    size: asString(row.size),
    unitPrice: asNumber(row.unitPrice),
    dealerPrice: asNumber(row.dealerPrice),
    inventoryPrice: asNumber(row.inventoryPrice),
    stockQuantity: asNumber(row.stockQuantity),
    onHand: asNumber(row.onHand),
    onOrder: asNumber(row.onOrder),
    availableStock: asNumber(row.availableStock),
    countryOfOrigin: asString(row.countryOfOrigin),
    supplierName: asString(row.supplierName),
    coverUrl: asString(row.coverUrl),
    skuMeta: mapSkuMeta(row.skuMeta),
  }
}

export async function searchCatalogProducts(term: string): Promise<CatalogProduct[]> {
  const query = new URLSearchParams({ q: term, limit: String(SEARCH_LIMIT) })
  const response = await apiFetch<{ products?: unknown }>(
    `${API_ENDPOINTS.CATALOG_PRODUCTS}?${query.toString()}`,
  )
  const rows = Array.isArray(response.products) ? response.products : []
  return rows
    .map(mapProduct)
    .filter((product): product is CatalogProduct => product !== null)
}

/** One requested SKU and what it resolved to. */
export interface SkuLookupEntry {
  sku: string
  product: CatalogProduct | null
}

/**
 * Look up many SKUs at once, IN THE ORDER GIVEN.
 *
 * For the bulk catalogue generator. The order is the requirement — "read the
 * SKUs in the exact order provided" — so the answer is one entry per
 * requested SKU in that sequence, repeats included, misses included.
 *
 * One request rather than one per SKU: a forty-product catalogue would
 * otherwise be forty round trips, and a four-hundred-product one unusable.
 */
export async function lookupProductsBySkus(
  skus: readonly string[],
): Promise<{ results: SkuLookupEntry[]; missing: string[] }> {
  if (skus.length === 0) return { results: [], missing: [] }

  const res = await apiFetch<{ results?: unknown; missing?: unknown }>(
    `${API_ENDPOINTS.CATALOG_PRODUCTS}/by-skus`,
    { method: "POST", body: JSON.stringify({ skus }) },
  )

  const rows = Array.isArray(res.results) ? res.results : []
  const results: SkuLookupEntry[] = rows.map((row) => {
    const r = (row ?? {}) as RawRecord
    return {
      sku: asString(r.sku) ?? "",
      // Mapped through the same function the search uses, so a product from
      // a list and a product from a search cannot differ in shape.
      product: r.product ? mapProduct(r.product) : null,
    }
  }).filter((entry) => entry.sku !== "")

  const missing = Array.isArray(res.missing)
    ? res.missing.map((m) => asString(m)).filter((m): m is string => m !== null)
    : []

  return { results, missing }
}

/**
 * A product's cover photo as a File, ready to embed.
 *
 * Goes through OUR API rather than straight at the image's own URL, and that
 * is not a preference — it was measured. R2 serves product images without CORS
 * headers, so from the admin's origin a fetch of `coverUrl` fails outright
 * while the same fetch against a permissive host succeeds. The browser will
 * still happily DISPLAY the image, which is why the panel's thumbnail points
 * an <img> straight at coverUrl and needs none of this; embedding needs the
 * bytes, and only the server can get them.
 *
 * There is no client-side way around it: drawing a cross-origin image to a
 * canvas taints the canvas and reading it back throws.
 */
export async function fetchProductCoverFile(product: CatalogProduct): Promise<File> {
  const blob = await apiFetch<Blob>(
    `${API_ENDPOINTS.CATALOG_PRODUCTS}/${encodeURIComponent(product.id)}/image`,
    { responseType: "blob" },
  )
  const type = blob.type === "image/png" ? "image/png" : "image/jpeg"
  const extension = type === "image/png" ? "png" : "jpg"
  // Named after the SKU so the file is recognisable if it is ever inspected.
  return new File([blob], `product-${product.sku}.${extension}`, { type })
}

/**
 * Search results for the editor's product panel.
 *
 * `keepPreviousData` on purpose: the caller debounces keystrokes, so without
 * it the list would empty and refill on every settled keystroke, and the row
 * someone was reaching for would jump out from under the cursor.
 */
export function useCatalogProductSearchQuery(term: string) {
  const trimmed = term.trim()
  return useQuery({
    queryKey: catalogProductsQueryKeys.search(trimmed),
    queryFn: () => searchCatalogProducts(trimmed),
    enabled: trimmed.length >= MIN_SEARCH_LENGTH,
    placeholderData: keepPreviousData,
    // A catalogue does not change during one editing session, and the same
    // few SKUs get looked up repeatedly while filling a page.
    staleTime: 5 * 60_000,
  })
}
