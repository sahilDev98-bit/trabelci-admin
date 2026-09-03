import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  GripVerticalIcon, ImageOffIcon, ImagePlusIcon, Loader2Icon, PackageSearchIcon,
  SearchIcon,
  SparklesIcon, XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MIN_SEARCH_LENGTH, useCatalogProductSearchQuery } from "@/features/catalogProducts/api"
import type { CatalogProduct } from "@/features/catalogProducts/types"
import {
  PRODUCT_FIELD_GROUPS, productDisplayName, resolveProductFields,
  toProductFieldLanguage, type ResolvedProductField,
} from "./productFields"
import { setProductDragData } from "./productDrag"

/**
 * The product side of the editor: find a product, then pour its details into
 * text boxes one at a time.
 *
 * The shape of the interaction is the client's requirement read literally —
 * "pick up the product details by simply writing the unique fields" — and one
 * decision drives the rest: the product is picked ONCE and stays picked. A
 * page of a catalogue is almost always about a single product, so making the
 * search a per-field step would mean re-finding the same SKU six times to fill
 * six boxes.
 *
 * Everything this panel offers is read from productFields.ts, including the
 * value shown beside each name. That is the same string the click inserts, so
 * what you see really is what lands on the page — there is no second code path
 * that could format it differently.
 *
 * This component holds no document state and performs no edits. It reports a
 * chosen field's VALUE upward and the editor decides what to do with it.
 */

/** How long the typing has to stop before a request goes out. Long enough that
 * a whole SKU typed at speed is one request rather than six; short enough that
 * it still feels like it answered as you finished. */
const SEARCH_DEBOUNCE_MS = 300

/** Panel width. Fixed rather than a fraction of the window: the page column
 * beside it is what should grow when the screen does. */
const PANEL_WIDTH_PX = 320

interface PdfProductPanelProps {
  product: CatalogProduct | null
  onPickProduct: (product: CatalogProduct | null) => void
  /**
   * What clicking a detail will do right now.
   *
   * "replace" when a text box is selected — the detail goes into that box.
   * "add" when nothing is — the detail arrives as a new text box on the page.
   * Which one is in force is stated above the list rather than left to be
   * discovered, because the same click doing two different things is only
   * acceptable if you can see which one you are about to get.
   */
  mode: "replace" | "add"
  onApply: (value: string) => void
  /** Places the whole product — photo plus its key details — on the page in
   * view. The click equivalent of dragging the card, and the only route
   * available from a keyboard. */
  onPlaceProduct: () => void
  /** How many boxes on the page in view are marked as holding this product's
   * details. Zero hides the fill button entirely — an action that can only
   * report "nothing to do" is not worth a button. */
  slotCountOnPage: number
  /** Pours the chosen product into every marked box at once. */
  onFillSlots: () => void
  /** How many products the page in view shows. Above one, the button has to
   * say WHICH position it fills — on an eight-product page "Fill 4 slots"
   * leaves you wondering which of the eight got them. */
  productsOnPage: number
  onClose: () => void
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return settled
}

export function PdfProductPanel({
  product, onPickProduct, mode, onApply, onPlaceProduct,
  slotCountOnPage, onFillSlots, productsOnPage, onClose,
}: PdfProductPanelProps) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS)
  const searchRef = useRef<HTMLInputElement>(null)

  const query = useCatalogProductSearchQuery(debouncedSearch)
  const language = toProductFieldLanguage(i18n.language)

  const fields = useMemo(
    () => (product ? resolveProductFields(product, language) : []),
    [product, language],
  )

  useEffect(() => { searchRef.current?.focus() }, [])

  const trimmed = search.trim()
  const isSearching = trimmed.length >= MIN_SEARCH_LENGTH
  // The debounced term is what the results actually describe. Comparing
  // against it keeps the spinner up during the pause after a keystroke, so
  // the panel never shows the previous product's results as though they were
  // an answer to what is currently typed.
  const settling = isSearching && trimmed !== debouncedSearch.trim()
  const results = query.data ?? []

  const pick = (chosen: CatalogProduct) => {
    onPickProduct(chosen)
    // Cleared so the field list takes the space back. The chosen product is
    // named in the card above it, so nothing is lost by emptying the box.
    setSearch("")
  }

  return (
    <aside
      data-pdf-product-panel
      // border-s, not border-l: in Hebrew the panel sits on the other side and
      // the border has to move with it.
      className="flex w-80 shrink-0 flex-col border-s bg-background"
      style={{ width: PANEL_WIDTH_PX }}
      aria-label={t("pdfTemplates.productPanelTitle", "Product details")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <PackageSearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          {t("pdfTemplates.productPanelTitle", "Product details")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          onClick={onClose}
          aria-label={t("pdfTemplates.productPanelClose", "Close product panel")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* ── Find a product ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b p-3">
        <div className="relative">
          {/* start-3, not left-3, so the icon follows the text direction. */}
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9"
            placeholder={t(
              "pdfTemplates.productSearchPlaceholder",
              "Search SKU, name or supplier",
            )}
            aria-label={t("pdfTemplates.productSearchLabel", "Search products")}
          />
        </div>
        {trimmed.length > 0 && !isSearching && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("pdfTemplates.productSearchTooShort", "Type at least 2 characters.")}
          </p>
        )}
      </div>

      {/* ── Results, while searching ───────────────────────────────────── */}
      {isSearching && (
        <div className="themed-scrollbar max-h-64 shrink-0 overflow-y-auto border-b">
          {(query.isFetching || settling) && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              {t("pdfTemplates.productSearching", "Searching…")}
            </p>
          )}
          {query.isError && !query.isFetching && (
            <p className="px-3 py-3 text-xs text-destructive">
              {t("pdfTemplates.productSearchFailed", "Could not load products. Check your connection and try again.")}
            </p>
          )}
          {!query.isFetching && !settling && !query.isError && results.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {t("pdfTemplates.productSearchEmpty", "No products match that search.")}
            </p>
          )}
          <ul>
            {results.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => pick(row)}
                  className="w-full px-3 py-2 text-start hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="block truncate text-sm">{productDisplayName(row)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[row.sku, row.skuMeta?.supplier ?? row.supplierName]
                      .filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── The chosen product, and its fields ─────────────────────────── */}
      {!product && !isSearching && (
        <p className="p-3 text-xs text-muted-foreground">
          {t(
            "pdfTemplates.productPanelEmpty",
            "Find a product above. Its details can then be dropped into any text box on the page.",
          )}
        </p>
      )}

      {product && (
        <>
          {/* The chosen product, as a card you can pick up.
              Draggable as a whole rather than by a separate handle: the card
              IS the product, and a handle would be one more thing to find.

              It LOOKS draggable, and that was not free. The first version
              relied on the cursor turning into a grab hand — which you only
              discover after already hovering over the right thing — plus a
              line of text below calling it "the card". Neither told anyone
              which part of the panel to pick up, and it was reported as not
              being there at all. So: a grip, a dashed edge, and a background
              that lifts on hover. The click alternative below it matters as
              much — dragging is not available from a keyboard. */}
          <div
            data-pdf-product-card
            draggable
            onDragStart={(e) => setProductDragData(e.dataTransfer, product)}
            className="m-3 mb-0 flex shrink-0 cursor-grab items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2 transition hover:border-primary hover:bg-muted/70 active:cursor-grabbing"
            title={t("pdfTemplates.productDragHint", "Drag onto the page to place this product")}
          >
            <GripVerticalIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            {product.coverUrl ? (
              // Straight at the image's own URL. Displaying needs no CORS —
              // only reading the bytes does, which is what the API proxy is
              // for when the photo is actually placed.
              <img
                src={product.coverUrl}
                alt=""
                draggable={false}
                className="size-10 shrink-0 rounded border object-cover"
              />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted">
                <ImageOffIcon className="size-4 text-muted-foreground" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{productDisplayName(product)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[product.sku, product.skuMeta?.supplier ?? product.supplierName]
                  .filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          {/* ── Filling the page's product slots ──
              Shown only when this page HAS slots. It is the one action that
              needs no positioning at all: the page was laid out already, and
              this pours a product into it. Placed above "Place product on
              page" because on a page with slots it is almost always the one
              that is wanted. */}
          {slotCountOnPage > 0 && (
            <div className="shrink-0 border-b px-3 py-2">
              <Button
                type="button"
                size="sm"
                className="w-full gap-1.5"
                data-pdf-fill-slots
                onClick={onFillSlots}
              >
                <SparklesIcon className="size-3.5" />
                {productsOnPage > 1
                  ? t("pdfTemplates.productFillFirst", "Fill product 1 ({{count}} slots)", {
                    count: slotCountOnPage,
                  })
                  : t("pdfTemplates.productFillSlots", "Fill {{count}} slots on this page", {
                    count: slotCountOnPage,
                  })}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {productsOnPage > 1
                  ? t(
                    "pdfTemplates.productFillFirstHint",
                    "This page holds {{count}} products. Drop a product onto a photo to fill that position instead.",
                    { count: productsOnPage },
                  )
                  : t(
                    "pdfTemplates.productFillSlotsHint",
                    "Puts this product into every box marked as holding a product detail.",
                  )}
              </p>
            </div>
          )}

          <div className="shrink-0 border-b px-3 py-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              data-pdf-place-product
              onClick={onPlaceProduct}
              title={t(
                "pdfTemplates.productPlaceHint",
                "Adds the photo and the main details to the page as one block",
              )}
            >
              <ImagePlusIcon className="size-3.5" />
              {t("pdfTemplates.productPlace", "Place product on page")}
            </Button>
            {/* What dragging will do — which is not one answer.
                On a page with product slots a drop SWAPS the page's product;
                on a page without, it places a block. One sentence covering
                both would be half wrong in both cases, and this text was
                already stale: it still described the old behaviour after
                swapping was added. */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {slotCountOnPage > 0
                ? t(
                  "pdfTemplates.productDragExplainSwap",
                  "Or drag the card above onto the page — it will swap this page's product, leaving the layout as it is.",
                )
                : t(
                  "pdfTemplates.productDragExplain",
                  "Or drag the card above onto the page. Drop it on a picture to use that picture's place for this product's photo.",
                )}
            </p>
          </div>

          {/* Which of the two actions a click will perform, said plainly and
              always — not only in the awkward case. Before this the panel
              simply refused to work with nothing selected, which read as
              broken; now both states do something and the banner says what. */}
          <p
            data-product-mode={mode}
            className="shrink-0 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          >
            {mode === "replace"
              ? t("pdfTemplates.productModeReplace", "Puts the detail into the selected text box.")
              : t("pdfTemplates.productModeAdd", "Adds the detail as a new text box. Select a box first to fill it instead.")}
          </p>

          <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            {PRODUCT_FIELD_GROUPS.map((group) => {
              const groupFields = fields.filter((f) => f.group === group.id)
              if (groupFields.length === 0) return null
              return (
                <section key={group.id} className="mb-4 last:mb-0">
                  <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(group.labelKey, group.labelFallback)}
                  </h3>
                  <ul className="space-y-0.5">
                    {groupFields.map((field) => (
                      <li key={field.id}>
                        <FieldRow
                          field={field}
                          mode={mode}
                          onApply={() => { if (field.value) onApply(field.value) }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}

/**
 * One detail, with the exact text it would insert.
 *
 * Now disabled for exactly ONE reason — this product has nothing for this
 * field — and the tooltip says so. It used to also be disabled whenever no
 * text box was selected; that case now adds a new box instead, so there is
 * nothing left to refuse.
 */
function FieldRow({
  field, mode, onApply,
}: {
  field: ResolvedProductField
  mode: "replace" | "add"
  onApply: () => void
}) {
  const { t } = useTranslation()
  const hasValue = field.value !== null
  const disabled = !hasValue
  const label = t(field.labelKey, field.labelFallback)

  return (
    <button
      type="button"
      onClick={onApply}
      disabled={disabled}
      data-product-field={field.id}
      data-product-field-empty={hasValue ? undefined : "true"}
      title={hasValue
        ? (mode === "replace"
          ? t("pdfTemplates.productFieldInsert", "Put this into the selected text box")
          : t("pdfTemplates.productFieldAdd", "Add this to the page as a new text box"))
        : t("pdfTemplates.productFieldMissing", "This product has no value for this detail.")}
      className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-start enabled:hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{label}</span>
      {/* Two elements, because ORDER and ALIGNMENT have to be decided by
          different things.

          Order is per value: one can be Hebrew while the interface is English,
          or a Latin size like 60x120 while the interface is Hebrew. That is
          what unicode-bidi:plaintext on the inner span settles.

          Alignment must NOT be per value, or the column goes ragged — under
          Hebrew the Latin values sat against one edge and the Hebrew ones
          against the other. It belongs to the panel. So the outer div keeps
          the panel's own direction and does the aligning, and the inner span
          only decides how its own characters run. dir="auto" cannot do this:
          it sets both at once, from the value. */}
      <div className="min-w-0 flex-1 truncate text-start text-sm">
        <span style={{ unicodeBidi: "plaintext" }}>
          {hasValue
            ? field.value
            : <span className="italic text-muted-foreground">
              {t("pdfTemplates.productFieldNoValue", "not set")}
            </span>}
        </span>
      </div>
    </button>
  )
}
