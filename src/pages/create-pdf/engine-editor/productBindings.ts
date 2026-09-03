/**
 * Which product each position on a page is showing — Point 7 of the brief.
 *
 * A product SLOT says "this box holds an SKU". A BINDING says "the second
 * position on page 4 is showing 100201305, and here is exactly what we wrote
 * into each of its boxes".
 *
 * Both are needed and neither replaces the other. Without slots, a refresh
 * would not know which box to put the price in. Without bindings, it would
 * not know whose price to fetch.
 *
 * ── Linked, or manually overridden ──
 *
 * The brief asks us to distinguish fields that are "linked to database" from
 * ones "manually overridden in this catalog". Rather than making somebody tick
 * a box per field — which nobody would keep up to date — this remembers what
 * it WROTE. On a later refresh:
 *
 *   the box still says what we wrote   -> nobody has touched it, safe to update
 *   the box says something else        -> a person changed it, leave it alone
 *
 * That is the client's two categories exactly, derived rather than declared,
 * so it cannot fall out of step with reality.
 */

export interface ProductBinding {
  pageIndex: number
  /** Which position on the page, counted from 0 — an eight-product page has
   * eight independent bindings. */
  productIndex: number
  sku: string
  /**
   * What was written into each field, keyed by field id.
   *
   * For the photo this holds the image's URL rather than any text: it is the
   * only thing about a picture that can be compared cheaply, and it answers
   * the question that matters — has the product's photo changed since.
   */
  written: Record<string, string>
}

export type ProductBindingMap = ReadonlyMap<string, ProductBinding>

export const bindingKey = (pageIndex: number, productIndex: number): string =>
  `${pageIndex}:${productIndex}`

export function setBinding(
  bindings: ProductBindingMap, binding: ProductBinding,
): Map<string, ProductBinding> {
  const next = new Map(bindings)
  next.set(bindingKey(binding.pageIndex, binding.productIndex), binding)
  return next
}

export function bindingsOnPage(
  bindings: ProductBindingMap, pageIndex: number,
): ProductBinding[] {
  return [...bindings.values()]
    .filter((b) => b.pageIndex === pageIndex)
    .sort((a, b) => a.productIndex - b.productIndex)
}

/**
 * Move bindings up when a page is inserted before them.
 *
 * They are keyed by page NUMBER, and inserting a page shifts every number
 * above it. Without this, refreshing after inserting a cover would fetch page
 * 4's products and write them onto page 5.
 */
export function shiftBindingsForInsert(
  bindings: ProductBindingMap, insertedAt: number,
): Map<string, ProductBinding> {
  const next = new Map<string, ProductBinding>()
  for (const binding of bindings.values()) {
    const pageIndex = binding.pageIndex >= insertedAt ? binding.pageIndex + 1 : binding.pageIndex
    next.set(bindingKey(pageIndex, binding.productIndex), { ...binding, pageIndex })
  }
  return next
}

/** Drop bindings for pages that no longer exist, so a page taking a freed
 * number cannot inherit somebody else's products. */
export function pruneBindings(
  bindings: ProductBindingMap, pageCount: number,
): Map<string, ProductBinding> {
  const next = new Map<string, ProductBinding>()
  for (const binding of bindings.values()) {
    if (binding.pageIndex < pageCount) {
      next.set(bindingKey(binding.pageIndex, binding.productIndex), binding)
    }
  }
  return next
}

/**
 * What a refresh should do with one field.
 *
 * The whole of Point 7 turns on this, so it is a pure function with a name
 * for every outcome rather than a chain of conditions buried in a loop.
 */
export type RefreshVerdict =
  /** The database has something new and nobody has touched the box. */
  | "update"
  /** The box already says what the database says. */
  | "unchanged"
  /** Somebody edited this box by hand. Their words win. */
  | "overridden"
  /** The product has no value for this field, so there is nothing to write.
   * The box keeps whatever the design put there. */
  | "nothing-fresh"

export interface RefreshCandidate {
  /** What the box says right now. */
  current: string
  /** What we wrote into it when it was filled, if we ever did. */
  written: string | undefined
  /** What the database says today. */
  fresh: string | null
}

export function verdictFor({ current, written, fresh }: RefreshCandidate): RefreshVerdict {
  // Nothing to write beats everything else: a product with no series recorded
  // must never blank a box the design filled deliberately.
  if (fresh === null || fresh === "") return "nothing-fresh"

  // Never filled by us — so whatever is in the box is the design's own text
  // or somebody's typing, and not ours to replace.
  if (written === undefined) return "overridden"

  // Changed since we wrote it. A person did that, and a refresh that
  // overwrote it would silently undo their work.
  if (current !== written) return "overridden"

  return current === fresh ? "unchanged" : "update"
}

/** A field a refresh would actually change, for showing before it happens. */
export interface PlannedChange {
  pageIndex: number
  productIndex: number
  sku: string
  fieldId: string
  kind: "text" | "image" | "vector"
  /** Where the box is on the page, so the change can be applied without
   * searching for it again. */
  slotIndex: number
  from: string
  to: string
}

export interface RefreshPlan {
  changes: PlannedChange[]
  /** Counted rather than listed: the reassuring number is "how much of my own
   * work is safe", not which fields exactly. */
  overridden: number
  unchanged: number
  /** SKUs that are on a page but no longer in the catalogue at all. Named,
   * because a product that has been deleted is something to know about. */
  missingSkus: string[]
  /** How many products the pages hold altogether. */
  products: number
}

export const emptyRefreshPlan = (): RefreshPlan =>
  ({ changes: [], overridden: 0, unchanged: 0, missingSkus: [], products: 0 })
