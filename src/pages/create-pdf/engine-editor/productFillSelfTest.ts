// Does "fill this box from the catalogue" actually do what the panel says?
//
// Four claims are worth proving, and each one has a control that has to fail
// for the proof to mean anything.
//
//   1. What the panel SHOWS beside a field is exactly what it inserts. This is
//      the design's central promise — it is what makes the language fallbacks
//      safe to have — and it is precisely the thing reading the code cannot
//      settle, because the preview and the insertion come from the same
//      function and would agree with each other even if that function were
//      wrong. So a handful of values are also checked against literals.
//
//   2. A field with no value cannot be inserted. Not "inserts an empty
//      string" — cannot be clicked at all. The failure this guards against is
//      the word "null" printed in a customer's catalogue.
//
//   3. Hebrew takes the Hebrew reading and English the English one, for real
//      rather than by an accident of the fixture. The control: the two must
//      come out DIFFERENT, or a build that ignored language entirely would
//      pass.
//
//   4. With no text box selected the panel ADDS a new one rather than
//      refusing, and says so before the click. The control: the banner must
//      read differently in the two modes, or it is a fixed label reporting
//      nothing.
//
// The panel is mounted for real, with the app's real stylesheet, and driven by
// clicking it. Only the network is stubbed — and not by this file: the caller
// serves PRODUCT_FIXTURE from /catalog/products, the same way
// zoomCostSelfTest is handed a PDF to work on. See scripts/run-product-fill.
import { createElement, useState } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import i18n from "@/i18n"
import type { CatalogProduct } from "@/features/catalogProducts/types"
import { PdfProductPanel } from "./PdfProductPanel"

/**
 * What the caller must serve from /catalog/products.
 *
 * One product carrying every field, and one carrying almost none. The second
 * is not padding — it is the only thing that produces the "not set" case, and
 * a product with no sku_metadata row is common in the real catalogue.
 */
export const PRODUCT_FIXTURE = [
  {
    id: 1, sku: "911120", name: "Carnaby White", size: "60x120",
    unitPrice: 123.4, dealerPrice: 99, inventoryPrice: 80.5,
    onHand: 5, onOrder: 2, availableStock: 3, stockQuantity: 7,
    countryOfOrigin: "Italy", supplierName: "Row Supplier", coverUrl: null,
    skuMeta: {
      supplier: "ורמורה", supplier_name_en: "Varmora",
      supplier_code: "VAR", supplier_sku: "V-911",
      series: "כרנבי", series_en: "Carnaby",
      color: "לבן", color_en: "White",
      size: "60x120", finish: "R11", country_of_origin: "Italy",
      shade: "V2", qty_per_carton: "4", qty_per_pallet: 40,
    },
  },
  {
    id: 2, sku: "BARE-1", name: "Bare product", size: null,
    unitPrice: null, dealerPrice: null, inventoryPrice: null,
    onHand: null, onOrder: null, availableStock: null, stockQuantity: null,
    countryOfOrigin: null, supplierName: null, coverUrl: null, skuMeta: null,
  },
]

export interface ProductFillTestResult {
  errors: string[]
  fieldsListed: number
  filledRows: number
  insertedCount: number
  /** Values read off the panel, so a failure report says what it saw. */
  englishValues: Record<string, string>
  hebrewValues: Record<string, string>
  emptyRowsOnBareProduct: number
  /** Control: clicking every valueless field must insert nothing. */
  insertsFromEmptyFields: number
  /** With nothing selected the panel adds instead of refusing. */
  rowsInAddMode: number
  rowsEnabledInAddMode: number
  appliedInAddMode: number
  /** The mode the panel announced, and the words it used — with the other
   * mode's words alongside, as the control that it is really reporting. */
  announcedMode: string
  announcedModeText: string
  replaceModeText: string
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls until a condition holds, so the test waits for the search debounce
 * and the request rather than guessing at a sleep. */
async function until(what: string, check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** React listens for `input` on its own value setter, so assigning `.value`
 * and firing an event is not enough — the native setter has to be called or
 * React sees no change and the panel never searches. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value")?.set
  setter?.call(input, text)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

interface Row {
  id: string
  empty: boolean
  disabled: boolean
  /** The text the panel is showing for this field. */
  shown: string
}

function readRows(): Row[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-product-field]"))
    .map((el) => ({
      id: el.dataset.productField ?? "",
      empty: el.dataset.productFieldEmpty === "true",
      disabled: el.disabled,
      // The second span holds the value; the first holds the label.
      shown: el.querySelectorAll("span")[1]?.textContent ?? "",
    }))
}

/**
 * Puts the panel on screen and leaves it there, for looking at rather than
 * asserting on.
 *
 * Exists because the checks below are blind to LAYOUT, and layout under
 * Hebrew is where this editor has gone wrong before — a border or an icon
 * pinned to the physical left stays on the left when everything around it
 * flips. The caller sets the document direction and takes a picture.
 */
let inspection: ReturnType<typeof harness> | null = null

export async function showProductPanel(language: "en" | "he"): Promise<void> {
  // Torn down first. Each harness owns its own host element, so calling this
  // twice without this line leaves the previous panel in the document, where
  // it sits on top and swallows the clicks meant for the new one.
  inspection?.teardown()
  inspection = harness()
  await inspection.mount("replace", language)
}

/** Shared mounting, used by both the self-test and the visual inspection so
 * the thing being looked at is the thing being measured. */
function harness() {
  let host: HTMLElement | null = null
  let root: ReturnType<typeof createRoot> | null = null
  const fills: string[] = []

  const mount = async (mode: "replace" | "add", language: "en" | "he") => {
    root?.unmount()
    host?.remove()
    await i18n.changeLanguage(language)
    host = document.createElement("div")
    host.style.cssText = "position:fixed;inset:0;display:flex;justify-content:flex-end;background:var(--muted,#f4f4f5)"
    document.body.appendChild(host)
    fills.length = 0
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    function Harness() {
      const [product, setProduct] = useState<CatalogProduct | null>(null)
      return createElement(PdfProductPanel, {
        product,
        onPickProduct: setProduct,
        mode,
        onApply: (value: string) => { fills.push(value) },
        onClose: () => {},
      })
    }

    root = createRoot(host)
    root.render(createElement(QueryClientProvider, { client }, createElement(Harness)))
    await until("the panel to mount", () => !!document.querySelector("[data-pdf-product-panel]"))
  }

  return { mount, fills, teardown: () => { root?.unmount(); host?.remove() } }
}

export async function runProductFillSelfTest(): Promise<ProductFillTestResult> {
  const out: ProductFillTestResult = {
    errors: [], fieldsListed: 0, filledRows: 0, insertedCount: 0,
    englishValues: {}, hebrewValues: {}, emptyRowsOnBareProduct: 0,
    insertsFromEmptyFields: 0,
    rowsInAddMode: 0, rowsEnabledInAddMode: 0, appliedInAddMode: 0,
    announcedMode: "", announcedModeText: "", replaceModeText: "",
  }

  // The same mounting the visual inspection uses, so what is measured here and
  // what is looked at there cannot drift apart.
  const { mount, fills, teardown } = harness()

  /** Search for a product and choose it, exactly as a user would. */
  const choose = async (sku: string) => {
    const input = document.querySelector<HTMLInputElement>("[data-pdf-product-panel] input")
    if (!input) throw new Error("the panel has no search box")
    typeInto(input, sku.slice(0, 4))
    await until(`the result for ${sku}`, () =>
      Array.from(document.querySelectorAll("[data-pdf-product-panel] li button"))
        .some((el) => el.textContent?.includes(sku)))
    const row = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-pdf-product-panel] li button"))
      .find((el) => el.textContent?.includes(sku))
    row?.click()
    await until("the field list", () => readRows().length > 0)
  }

  const clickField = async (id: string) => {
    document.querySelector<HTMLButtonElement>(`[data-product-field="${id}"]`)?.click()
    await wait(0)
  }

  try {
    // ── 1. What is shown is what is inserted ────────────────────────────
    await mount("replace", "en")
    await choose("911120")
    const rows = readRows()
    out.fieldsListed = rows.length
    const filled = rows.filter((r) => !r.empty)
    out.filledRows = filled.length
    out.englishValues = Object.fromEntries(rows.map((r) => [r.id, r.shown]))

    for (const row of filled) await clickField(row.id)
    out.insertedCount = fills.length

    if (fills.length !== filled.length) {
      out.errors.push(`clicked ${filled.length} fields but ${fills.length} inserted`)
    }
    filled.forEach((row, i) => {
      if (fills[i] !== row.shown) {
        out.errors.push(`${row.id}: shows "${row.shown}" but inserted "${fills[i]}"`)
      }
    })
    const junk = fills.filter((v) =>
      !v || v.trim() === "" || v === "null" || v === "undefined" || v === "—")
    if (junk.length) out.errors.push(`inserted junk: ${JSON.stringify(junk)}`)

    // Checked against literals as well, because the comparison above only
    // proves the preview and the insertion AGREE — they would agree just as
    // happily on a wrong value.
    const wantEnglish: Record<string, string> = {
      sku: "911120", name: "Carnaby White", size: "60x120", finish: "R11",
      shade: "V2", countryOfOrigin: "Italy",
      unitPrice: "123.40", dealerPrice: "99.00", inventoryPrice: "80.50",
      availableStock: "3", onHand: "5", onOrder: "2",
      series: "Carnaby", color: "White", supplier: "Varmora",
      supplierCode: "VAR", supplierSku: "V-911",
      qtyPerCarton: "4", qtyPerPallet: "40",
    }
    for (const [id, want] of Object.entries(wantEnglish)) {
      if (out.englishValues[id] !== want) {
        out.errors.push(`${id}: expected "${want}", got "${out.englishValues[id]}"`)
      }
    }
    if (filled.length < Object.keys(wantEnglish).length) {
      out.errors.push(
        `only ${filled.length} fields had a value; the fixture fills ${Object.keys(wantEnglish).length}`)
    }

    // ── 2. A valueless field cannot be inserted ─────────────────────────
    await choose("BARE-1")
    const bare = readRows()
    const empties = bare.filter((r) => r.empty)
    out.emptyRowsOnBareProduct = empties.length
    if (empties.length < 10) {
      out.errors.push(
        `only ${empties.length} fields came out empty for a product with no metadata`
        + " — too few for this to be exercising the empty case")
    }
    if (bare.some((r) => r.empty && !r.disabled)) {
      out.errors.push("a field with no value was still clickable")
    }
    fills.length = 0
    for (const row of empties) await clickField(row.id)
    out.insertsFromEmptyFields = fills.length
    if (fills.length !== 0) {
      out.errors.push(`${fills.length} valueless fields inserted something`)
    }

    // ── 3. Hebrew takes the Hebrew reading ──────────────────────────────
    await mount("replace", "he")
    await choose("911120")
    out.hebrewValues = Object.fromEntries(readRows().map((r) => [r.id, r.shown]))
    const wantHebrew: Record<string, string> = {
      series: "כרנבי", color: "לבן", supplier: "ורמורה",
      // Not language-specific. If these moved, `localised` is being applied
      // to fields that have only one reading.
      sku: "911120", size: "60x120", unitPrice: "123.40",
    }
    for (const [id, want] of Object.entries(wantHebrew)) {
      if (out.hebrewValues[id] !== want) {
        out.errors.push(`Hebrew ${id}: expected "${want}", got "${out.hebrewValues[id]}"`)
      }
    }
    // The control. Without this, an implementation that ignored language
    // entirely would sail through the three checks above.
    for (const id of ["series", "color", "supplier"]) {
      if (out.hebrewValues[id] === out.englishValues[id]) {
        out.errors.push(
          `${id} reads the same in both languages ("${out.hebrewValues[id]}")`
          + " — the language check proves nothing")
      }
    }

    // ── 4. With no box selected the panel ADDS instead of refusing ──────
    //
    // This replaced an earlier check that asserted the opposite — that
    // nothing may happen with nothing selected. That was the behaviour, and
    // it was wrong: it left the panel dead until you had clicked a box, with
    // no way to put a detail on a page that had no box for it yet. The panel
    // now does both jobs and says which one is in force, so what is measured
    // here is that the second job works and is announced.
    await mount("add", "en")
    await choose("911120")
    const addRows = readRows()
    out.rowsInAddMode = addRows.length
    out.rowsEnabledInAddMode = addRows.filter((r) => !r.disabled).length
    for (const row of addRows.filter((r) => !r.empty)) await clickField(row.id)
    out.appliedInAddMode = fills.length

    const withValue = addRows.filter((r) => !r.empty).length
    if (fills.length !== withValue) {
      out.errors.push(
        `add mode: clicked ${withValue} fields with a value but ${fills.length} were applied`)
    }
    // Still exactly the value shown — the mode changes what the editor DOES
    // with the string, never the string itself.
    addRows.filter((r) => !r.empty).forEach((row, i) => {
      if (fills[i] !== row.shown) {
        out.errors.push(`add mode: ${row.id} shows "${row.shown}" but applied "${fills[i]}"`)
      }
    })
    // A valueless field is still refused — that guard was never about the
    // selection, and must not have been lost along with the old check.
    if (addRows.some((r) => r.empty && !r.disabled)) {
      out.errors.push("add mode: a field with no value was clickable")
    }

    // The mode has to be VISIBLE, or one click doing two different jobs is a
    // trap. Read from the banner the panel actually renders.
    const banner = document.querySelector<HTMLElement>("[data-product-mode]")
    out.announcedMode = banner?.dataset.productMode ?? "(none)"
    out.announcedModeText = banner?.textContent?.trim() ?? ""
    if (out.announcedMode !== "add") {
      out.errors.push(`add mode is not announced: banner says "${out.announcedMode}"`)
    }
    if (!out.announcedModeText) {
      out.errors.push("the mode banner rendered no text")
    }

    // The control: the banner must say something DIFFERENT in replace mode,
    // or it is a fixed label that would read the same however the panel
    // behaved, and the check above would prove nothing.
    await mount("replace", "en")
    await choose("911120")
    const replaceBanner = document.querySelector<HTMLElement>("[data-product-mode]")
    out.replaceModeText = replaceBanner?.textContent?.trim() ?? ""
    if (replaceBanner?.dataset.productMode !== "replace") {
      out.errors.push("replace mode is not announced")
    }
    if (out.replaceModeText === out.announcedModeText) {
      out.errors.push(
        "the banner reads identically in both modes — it is not reporting the mode")
    }

    return out
  } catch (err) {
    out.errors.push(err instanceof Error ? err.message : String(err))
    return out
  } finally {
    teardown()
  }
}
