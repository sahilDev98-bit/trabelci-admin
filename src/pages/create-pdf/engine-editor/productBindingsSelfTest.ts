// Does "Refresh from database" know what it is allowed to overwrite?
//
// This is the whole of Point 7, and it fails in two opposite directions, both
// bad:
//
//   Too eager  — a refresh silently undoes the wording somebody typed by
//                hand. They may never notice until it is printed.
//   Too timid  — a refresh reports "nothing to do" while the price on the
//                page is three months out of date.
//
// The rule is derived, not declared: we remember what we WROTE, and anything
// else in the box means a person has been there. So the tests are about that
// comparison, and about the page-number arithmetic that decides which
// products a refresh fetches at all.
import {
  bindingKey, bindingsOnPage, pruneBindings, setBinding, shiftBindingsForInsert,
  verdictFor, type ProductBindingMap, type RefreshVerdict,
} from "./productBindings"

export interface BindingsTestResult {
  errors: string[]
  verdicts: Record<string, RefreshVerdict>
  bindingsAfterInsert: string[]
  bindingsAfterPrune: string[]
  positionsOnPage: number[]
}

export function runProductBindingsSelfTest(): BindingsTestResult {
  const out: BindingsTestResult = {
    errors: [], verdicts: {}, bindingsAfterInsert: [],
    bindingsAfterPrune: [], positionsOnPage: [],
  }

  const check = (
    label: string, candidate: Parameters<typeof verdictFor>[0], expected: RefreshVerdict,
  ) => {
    const got = verdictFor(candidate)
    out.verdicts[label] = got
    if (got !== expected) out.errors.push(`${label}: got "${got}", expected "${expected}"`)
  }

  // ── The price moved ──────────────────────────────────────────────────
  // The reason the feature exists.
  check("price changed in the database",
    { current: "129.50", written: "129.50", fresh: "134.00" }, "update")

  // Nothing has changed — a refresh must not report work it did not do.
  check("nothing has changed",
    { current: "129.50", written: "129.50", fresh: "129.50" }, "unchanged")

  // ── Somebody edited the box ──────────────────────────────────────────
  // THE one that matters. The box no longer says what we wrote, so a person
  // changed it, and their words win over the database's.
  check("a person edited the text",
    { current: "Special offer 99.00", written: "129.50", fresh: "134.00" }, "overridden")

  // Even when their edit happens to match the database — still theirs, and
  // still nothing to do.
  check("their edit already matches the database",
    { current: "134.00", written: "129.50", fresh: "134.00" }, "overridden")

  // A box we never filled is the design's own text. Refreshing it would put
  // a price where the designer wrote "From only".
  check("a box we never filled",
    { current: "From only", written: undefined, fresh: "134.00" }, "overridden")

  // ── The product has nothing to say ───────────────────────────────────
  // A product with no series recorded must never BLANK a box the design
  // filled deliberately.
  check("the product has no value for this field",
    { current: "Carnaby", written: "Carnaby", fresh: null }, "nothing-fresh")
  check("the database value is an empty string",
    { current: "Carnaby", written: "Carnaby", fresh: "" }, "nothing-fresh")

  // "Nothing fresh" outranks "overridden": there is no write to make either
  // way, and calling it an override would inflate the count of work somebody
  // is being told was protected.
  check("nothing fresh, and edited too",
    { current: "My own words", written: "Carnaby", fresh: null }, "nothing-fresh")

  // ── Page numbers ─────────────────────────────────────────────────────
  // Bindings are keyed by page number, and inserting a page shifts every
  // number above it. Getting this wrong fetches page 4's products and writes
  // them onto page 5 — plausible-looking, entirely wrong.
  let bindings: ProductBindingMap = new Map()
  bindings = setBinding(bindings, {
    pageIndex: 0, productIndex: 0, sku: "COVER-ADJACENT", written: {},
  })
  bindings = setBinding(bindings, {
    pageIndex: 2, productIndex: 0, sku: "A", written: {},
  })
  bindings = setBinding(bindings, {
    pageIndex: 2, productIndex: 1, sku: "B", written: {},
  })

  const shifted = shiftBindingsForInsert(bindings, 1)
  out.bindingsAfterInsert = [...shifted.values()]
    .map((b) => `${b.sku}@${b.pageIndex}`).sort()
  // Page 0 is before the insertion and must NOT move; pages 2 become 3.
  if (JSON.stringify(out.bindingsAfterInsert)
    !== JSON.stringify(["A@3", "B@3", "COVER-ADJACENT@0"])) {
    out.errors.push(
      `after inserting a page at 1 the bindings read ${JSON.stringify(out.bindingsAfterInsert)}`
      + ' — expected ["A@3","B@3","COVER-ADJACENT@0"]')
  }
  // And the keys must have moved with them, or a lookup by page finds nothing.
  if (!shifted.has(bindingKey(3, 1))) {
    out.errors.push("a shifted binding kept its old key, so it can never be found again")
  }

  // Both positions on the page survive the shift — an eight-product page must
  // not lose seven of them.
  out.positionsOnPage = bindingsOnPage(shifted, 3).map((b) => b.productIndex)
  if (JSON.stringify(out.positionsOnPage) !== JSON.stringify([0, 1])) {
    out.errors.push(`page 3 holds positions ${JSON.stringify(out.positionsOnPage)}, expected [0,1]`)
  }

  // ── A deleted page ───────────────────────────────────────────────────
  const pruned = pruneBindings(shifted, 3)
  out.bindingsAfterPrune = [...pruned.values()].map((b) => `${b.sku}@${b.pageIndex}`).sort()
  if (out.bindingsAfterPrune.join(",") !== "COVER-ADJACENT@0") {
    out.errors.push(
      `pruning to 3 pages left ${JSON.stringify(out.bindingsAfterPrune)} —`
      + " bindings for pages that no longer exist would be inherited")
  }

  return out
}

/** Puts the refresh dialog on screen with a realistic plan, for looking at. */
export async function showRefreshDialog(
  language: "en" | "he", shape: "changes" | "uptodate" | "nothing" = "changes",
): Promise<void> {
  const [{ createElement }, { createRoot }, i18n, { PdfRefreshDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("@/i18n"),
    import("./PdfRefreshDialog"),
  ])
  await i18n.default.changeLanguage(language)

  document.getElementById("refresh-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "refresh-inspect"
  document.body.appendChild(host)

  const change = (fieldId: string, from: string, to: string, kind: "text" | "image" = "text") => ({
    pageIndex: 2, productIndex: 0, sku: "100201305", fieldId, kind,
    slotIndex: 1, from, to,
  })

  const plans = {
    changes: {
      changes: [
        change("unitPrice", "129.50", "134.00"),
        change("dealerPrice", "99.00", "104.00"),
        change("size", "60x120", "60x120 R"),
        change("photo", "", "", "image"),
      ],
      overridden: 3, unchanged: 18, missingSkus: ["OLD-SKU-1"], products: 12,
    },
    uptodate: { changes: [], overridden: 2, unchanged: 40, missingSkus: [], products: 12 },
    nothing: { changes: [], overridden: 0, unchanged: 0, missingSkus: [], products: 0 },
  }

  createRoot(host).render(createElement(PdfRefreshDialog, {
    open: true,
    plan: plans[shape],
    busy: false,
    onApply: () => {},
    onCancel: () => {},
  } as never))
  await new Promise((r) => setTimeout(r, 250))
}
