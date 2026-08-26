import type { CatalogProduct } from "@/features/catalogProducts/types"

/**
 * Which product details can be dropped into a text box, and how each one is
 * turned into the string that actually lands on the page.
 *
 * A plain module with no React in it, because this is the part that has to be
 * RIGHT: the panel merely lists what this file says exists. Two properties are
 * deliberate and everything else follows from them.
 *
 *   - A field either has a value or it does not. `read` returns null rather
 *     than "" or "—", and the panel disables anything that reads null. There
 *     is no path by which picking a field writes an empty string, a dash, or
 *     the word "null" into a customer's catalogue.
 *
 *   - What the panel shows IS what gets inserted. Both come from this one
 *     function, so the preview cannot drift from the result — which is what
 *     makes the language fallbacks below safe: a fallback is always visible
 *     before it is committed.
 *
 * The field list is bounded by what /catalog/products actually returns. The
 * client's brief also asked for a barcode and free "technical information";
 * neither exists in the catalog or in the SKU metadata it merges in, so
 * neither is offered here. An option that silently never fills is worse than
 * an absent one.
 */

export type ProductFieldLanguage = "he" | "en"

export type ProductFieldGroup = "identity" | "specification" | "commercial"

export interface ProductFieldDef {
  id: string
  /** i18n key, with the English text kept alongside as the fallback. */
  labelKey: string
  labelFallback: string
  group: ProductFieldGroup
  /** The exact string to insert, or null when this product has nothing. */
  read: (product: CatalogProduct, language: ProductFieldLanguage) => string | null
}

/** First non-empty of the candidates. Used for both language fallback and for
 * fields the catalog and the SKU metadata can each supply. */
const firstOf = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed !== "") return trimmed
  }
  return null
}

/**
 * Picks the reading for the interface language, falling back to the other.
 *
 * The fallback is a deliberate choice. A Hebrew series name shown in an
 * English catalogue is not ideal — but the alternative is greying out a field
 * that demonstrably HAS a value, which reads as a broken feature. Because the
 * panel prints the value it is about to insert, whoever is building the page
 * sees the Hebrew and can decide for themselves.
 */
const localised = (
  language: ProductFieldLanguage,
  hebrew: string | null | undefined,
  english: string | null | undefined,
): string | null => (language === "he" ? firstOf(hebrew, english) : firstOf(english, hebrew))

/**
 * Money, to two decimals, with no currency symbol.
 *
 * Matches how prices are shown everywhere else in the admin. Inventing a "₪"
 * here would put a symbol into a printed catalogue that no other screen in the
 * product agrees with, and an export catalogue may not want one at all.
 */
const money = (value: number | null): string | null =>
  value == null ? null : value.toFixed(2)

/**
 * Counts, as plain digits.
 *
 * Not Intl-formatted on purpose: this string is going into a PDF, and a
 * locale-aware formatter under Hebrew can produce grouping marks — or, in some
 * environments, non-Latin digits — that then have to be rendered by the
 * bundled font. A stock figure is read the same way in every language.
 */
const count = (value: number | null): string | null =>
  value == null ? null : String(Math.round(value))

/** sku_metadata's quantity columns arrive as text as often as numbers. */
const rawCount = (value: number | string | null | undefined): string | null => {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null
  return firstOf(value)
}

export const PRODUCT_FIELDS: readonly ProductFieldDef[] = [
  // ── Identity ───────────────────────────────────────────────────────────
  {
    id: "sku",
    labelKey: "pdfTemplates.productFieldSku",
    labelFallback: "SKU",
    group: "identity",
    read: (p) => firstOf(p.sku),
  },
  {
    id: "name",
    labelKey: "pdfTemplates.productFieldName",
    labelFallback: "Product name",
    group: "identity",
    read: (p) => firstOf(p.name),
  },
  {
    id: "supplier",
    labelKey: "pdfTemplates.productFieldSupplier",
    labelFallback: "Supplier",
    group: "identity",
    // The product row carries a supplier name too; the SKU metadata's is the
    // curated one, so it leads and the product row backs it up.
    read: (p, lang) => firstOf(
      localised(lang, p.skuMeta?.supplier, p.skuMeta?.supplier_name_en),
      p.supplierName,
    ),
  },
  {
    id: "supplierCode",
    labelKey: "pdfTemplates.productFieldSupplierCode",
    labelFallback: "Supplier code",
    group: "identity",
    read: (p) => firstOf(p.skuMeta?.supplier_code),
  },
  {
    id: "supplierSku",
    labelKey: "pdfTemplates.productFieldSupplierSku",
    labelFallback: "Supplier SKU",
    group: "identity",
    read: (p) => firstOf(p.skuMeta?.supplier_sku),
  },
  {
    id: "series",
    labelKey: "pdfTemplates.productFieldSeries",
    labelFallback: "Series",
    group: "identity",
    read: (p, lang) => localised(lang, p.skuMeta?.series, p.skuMeta?.series_en),
  },

  // ── Specification ──────────────────────────────────────────────────────
  {
    id: "size",
    labelKey: "pdfTemplates.productFieldSize",
    labelFallback: "Size",
    group: "specification",
    read: (p) => firstOf(p.size, p.skuMeta?.size),
  },
  {
    id: "finish",
    labelKey: "pdfTemplates.productFieldFinish",
    labelFallback: "Finish",
    group: "specification",
    read: (p) => firstOf(p.skuMeta?.finish),
  },
  {
    id: "color",
    labelKey: "pdfTemplates.productFieldColor",
    labelFallback: "Colour",
    group: "specification",
    read: (p, lang) => localised(lang, p.skuMeta?.color, p.skuMeta?.color_en),
  },
  {
    id: "shade",
    labelKey: "pdfTemplates.productFieldShade",
    labelFallback: "Shade",
    group: "specification",
    read: (p) => firstOf(p.skuMeta?.shade),
  },
  {
    id: "countryOfOrigin",
    labelKey: "pdfTemplates.productFieldCountry",
    labelFallback: "Country of origin",
    group: "specification",
    read: (p) => firstOf(p.countryOfOrigin, p.skuMeta?.country_of_origin),
  },

  // ── Commercial ─────────────────────────────────────────────────────────
  {
    id: "unitPrice",
    labelKey: "pdfTemplates.productFieldUnitPrice",
    labelFallback: "Unit price",
    group: "commercial",
    read: (p) => money(p.unitPrice),
  },
  {
    id: "dealerPrice",
    labelKey: "pdfTemplates.productFieldDealerPrice",
    labelFallback: "Dealer price",
    group: "commercial",
    read: (p) => money(p.dealerPrice),
  },
  {
    id: "inventoryPrice",
    labelKey: "pdfTemplates.productFieldInventoryPrice",
    labelFallback: "Inventory price",
    group: "commercial",
    read: (p) => money(p.inventoryPrice),
  },
  {
    id: "availableStock",
    labelKey: "pdfTemplates.productFieldAvailableStock",
    labelFallback: "Available stock",
    group: "commercial",
    read: (p) => count(p.availableStock ?? p.stockQuantity),
  },
  {
    id: "onHand",
    labelKey: "pdfTemplates.productFieldOnHand",
    labelFallback: "In stock (on hand)",
    group: "commercial",
    read: (p) => count(p.onHand),
  },
  {
    id: "onOrder",
    labelKey: "pdfTemplates.productFieldOnOrder",
    labelFallback: "On order",
    group: "commercial",
    read: (p) => count(p.onOrder),
  },
  {
    id: "qtyPerCarton",
    labelKey: "pdfTemplates.productFieldQtyPerCarton",
    labelFallback: "Qty per carton",
    group: "commercial",
    read: (p) => rawCount(p.skuMeta?.qty_per_carton),
  },
  {
    id: "qtyPerPallet",
    labelKey: "pdfTemplates.productFieldQtyPerPallet",
    labelFallback: "Qty per pallet",
    group: "commercial",
    read: (p) => rawCount(p.skuMeta?.qty_per_pallet),
  },
] as const

export const PRODUCT_FIELD_GROUPS: readonly {
  id: ProductFieldGroup
  labelKey: string
  labelFallback: string
}[] = [
  { id: "identity", labelKey: "pdfTemplates.productGroupIdentity", labelFallback: "Product" },
  { id: "specification", labelKey: "pdfTemplates.productGroupSpec", labelFallback: "Specification" },
  { id: "commercial", labelKey: "pdfTemplates.productGroupCommercial", labelFallback: "Price & stock" },
] as const

/** Every field with the value it would insert for this product, in one pass,
 * so the panel renders from a single snapshot rather than calling `read`
 * separately for the label, the preview and the click. */
export interface ResolvedProductField extends ProductFieldDef {
  value: string | null
}

export function resolveProductFields(
  product: CatalogProduct,
  language: ProductFieldLanguage,
): ResolvedProductField[] {
  return PRODUCT_FIELDS.map((field) => ({ ...field, value: field.read(product, language) }))
}

/** How a product is named in the search list. Falls back to the SKU, which is
 * always present — a nameless row must still be identifiable. */
export function productDisplayName(product: CatalogProduct): string {
  return firstOf(product.name) ?? product.sku
}

/** Narrows i18next's language string to the two readings this file knows
 * about. Anything that is not Hebrew is treated as English, which is what the
 * rest of the admin does. */
export function toProductFieldLanguage(language: string | undefined): ProductFieldLanguage {
  return language?.toLowerCase().startsWith("he") ? "he" : "en"
}
