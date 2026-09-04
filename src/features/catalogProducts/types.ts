/**
 * A product as the CATALOG endpoint returns it.
 *
 * Deliberately its own type rather than a reuse of features/products' Product.
 * That one models the admin product table — the row you edit — and is mapped
 * from a different endpoint with different fields. This one models what
 * /catalog/products actually hands back, which is the product row PLUS a
 * `skuMeta` block the controller merges in server-side (see
 * enrichWithSkuMetadata in the API's catalogController). Sharing one type
 * would mean one of the two lying about what it contains.
 */

/**
 * The SKU metadata the catalog endpoint merges into every product it can.
 *
 * snake_case because these come straight off the `sku_metadata` table and are
 * NOT re-mapped by the API — renaming them here would only hide where they
 * came from.
 *
 * Every field is nullable, and the block itself is absent for any SKU with no
 * metadata row. That is a real and common state, not an error: it is why the
 * editor greys these fields out rather than inserting an empty string.
 */
export interface CatalogSkuMeta {
  supplier: string | null
  supplier_code: string | null
  supplier_sku: string | null
  supplier_name_en: string | null
  series: string | null
  series_en: string | null
  color: string | null
  color_en: string | null
  size: string | null
  finish: string | null
  country_of_origin: string | null
  shade: string | null
  qty_per_carton: number | string | null
  qty_per_pallet: number | string | null
}

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  size: string | null
  unitPrice: number | null
  dealerPrice: number | null
  inventoryPrice: number | null
  stockQuantity: number | null
  onHand: number | null
  onOrder: number | null
  availableStock: number | null
  countryOfOrigin: string | null
  supplierName: string | null
  coverUrl: string | null
  /** Absent when this SKU has no row in sku_metadata. */
  skuMeta: CatalogSkuMeta | null
}

/**
 * A collection of products — a `series` in SKU Management.
 *
 * The unit the catalogue brief means by "an entire collection". Identified by
 * series AND supplier together, because a series name is not unique on its
 * own: two suppliers may each sell a "Marble", and merging them would build
 * one catalogue out of two unrelated ranges.
 */
export interface CatalogCollection {
  /** Server-built identity for the (supplier, series) pair. Safe as a React
   * key and as a select value, where the two fields separately would not be. */
  key: string
  series: string
  /** The English name, when SKU Management has one recorded. */
  seriesEn: string | null
  /** Null for a collection whose supplier has not been filled in. */
  supplier: string | null
  skuCount: number
}
