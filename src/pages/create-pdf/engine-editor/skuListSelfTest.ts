// Does a pasted SKU list survive being read?
//
// The client's requirement has one line that governs everything here:
// "Read the SKUs in the exact order provided." So order is checked first and
// hardest, and duplicates are checked because removing them silently would
// produce a catalogue with a hole in it that nobody could account for.
//
// The rest is about what people actually paste. A column out of Excel arrives
// with carriage returns and a header; a list out of an email is comma
// separated; a CSV export wraps values in quotes and puts an apostrophe in
// front of numeric codes to stop Excel eating the leading zero. All of it has
// to become the same list, and none of it may silently reorder anything.
import { chunkForPages, pagesNeeded, parseSkuList } from "./skuList"

export interface SkuListTestResult {
  errors: string[]
  pastedColumn: string[]
  commaSeparated: string[]
  csvWithQuotes: string[]
  headerDropped: string | null
  headerKeptWhenItIsASku: string[]
  duplicatesReported: { sku: string; count: number }[]
  duplicatesKeptInPlace: string[]
  ignoredJunk: number
  pageCounts: number[]
  lastPagePartial: string[][]
}

export function runSkuListSelfTest(): SkuListTestResult {
  const out: SkuListTestResult = {
    errors: [], pastedColumn: [], commaSeparated: [], csvWithQuotes: [],
    headerDropped: null, headerKeptWhenItIsASku: [], duplicatesReported: [],
    duplicatesKeptInPlace: [], ignoredJunk: 0, pageCounts: [], lastPagePartial: [],
  }

  // ── A column pasted out of Excel ─────────────────────────────────────
  // Windows line endings, a trailing tab per row, and a blank line at the
  // end — exactly what a spreadsheet gives you.
  const excel = parseSkuList("SKU\r\n100201305\t\r\n911120\t\r\n.4211121\t\r\n\r\n")
  out.pastedColumn = excel.skus
  out.headerDropped = excel.droppedHeader
  if (JSON.stringify(out.pastedColumn) !== JSON.stringify(["100201305", "911120", ".4211121"])) {
    out.errors.push(`a pasted Excel column came out as ${JSON.stringify(out.pastedColumn)}`)
  }
  if (out.headerDropped !== "SKU") {
    out.errors.push("the header row was not recognised and would have become a SKU")
  }

  // The control for the header rule: a product legitimately CALLED something
  // header-like must survive. It only applies to the first row, and only when
  // that row is not itself SKU-shaped.
  const looksLikeHeader = parseSkuList("CODE-1\n100201305")
  out.headerKeptWhenItIsASku = looksLikeHeader.skus
  if (looksLikeHeader.droppedHeader !== null || looksLikeHeader.skus.length !== 2) {
    out.errors.push(
      `"CODE-1" was treated as a header and dropped — a real SKU was thrown away`)
  }

  // ── Other shapes, same list ──────────────────────────────────────────
  out.commaSeparated = parseSkuList("100201305, 911120 , .4211121").skus
  if (JSON.stringify(out.commaSeparated) !== JSON.stringify(["100201305", "911120", ".4211121"])) {
    out.errors.push(`a comma-separated list came out as ${JSON.stringify(out.commaSeparated)}`)
  }

  // A CSV export: quoted values, and Excel's leading apostrophe that keeps a
  // numeric code from losing its leading zero.
  out.csvWithQuotes = parseSkuList('"100201305";"\'0091120";"ABC/1-2"').skus
  if (JSON.stringify(out.csvWithQuotes) !== JSON.stringify(["100201305", "0091120", "ABC/1-2"])) {
    out.errors.push(`a quoted CSV came out as ${JSON.stringify(out.csvWithQuotes)}`)
  }

  // ── Order and duplicates ─────────────────────────────────────────────
  // THE requirement. The order is the order given, and a repeat stays a
  // repeat — a catalogue may legitimately show the same tile twice, and
  // quietly removing the second would leave a page short with no explanation.
  const dup = parseSkuList("C\nA\nB\nA")
  out.duplicatesKeptInPlace = dup.skus
  out.duplicatesReported = dup.duplicates
  if (JSON.stringify(out.duplicatesKeptInPlace) !== JSON.stringify(["C", "A", "B", "A"])) {
    out.errors.push(
      `the list was reordered or de-duplicated: ${JSON.stringify(out.duplicatesKeptInPlace)}`
      + ' — expected ["C","A","B","A"] exactly')
  }
  if (dup.duplicates.length !== 1 || dup.duplicates[0].sku !== "A" || dup.duplicates[0].count !== 2) {
    out.errors.push(`duplicates reported as ${JSON.stringify(dup.duplicates)}`)
  }

  // ── Junk ─────────────────────────────────────────────────────────────
  // A pasted sentence must not become one enormous SKU. It is counted and
  // reported rather than silently swallowed.
  const junky = parseSkuList("100201305\nplease send these ones\n911120")
  out.ignoredJunk = junky.ignoredLines
  if (junky.skus.length !== 2 || junky.ignoredLines < 1) {
    out.errors.push(
      `a pasted sentence produced ${JSON.stringify(junky.skus)} with`
      + ` ${junky.ignoredLines} ignored — expected the two codes and the words ignored`)
  }
  // Nothing at all is not an error, it is an empty list.
  if (parseSkuList("   \n\n ").skus.length !== 0) {
    out.errors.push("blank input produced SKUs")
  }

  // ── How many pages ───────────────────────────────────────────────────
  // The client's own example: 40 SKUs into an 8-product template is 5 pages.
  out.pageCounts = [
    pagesNeeded(40, 8), pagesNeeded(39, 8), pagesNeeded(41, 8),
    pagesNeeded(8, 8), pagesNeeded(1, 8), pagesNeeded(0, 8),
  ]
  if (JSON.stringify(out.pageCounts) !== JSON.stringify([5, 5, 6, 1, 1, 0])) {
    out.errors.push(
      `page counts came out ${JSON.stringify(out.pageCounts)}, expected [5,5,6,1,1,0]`
      + " — 40 into 8 is the client's own worked example")
  }

  // A short last page is a page with empty tiles, not an error and not a
  // dropped product.
  const chunks = chunkForPages(["a", "b", "c", "d", "e"], 2)
  out.lastPagePartial = chunks
  if (JSON.stringify(chunks) !== JSON.stringify([["a", "b"], ["c", "d"], ["e"]])) {
    out.errors.push(`chunking five into pages of two gave ${JSON.stringify(chunks)}`)
  }
  // The control: nothing may be lost or repeated by the chunking.
  if (chunks.flat().join(",") !== "a,b,c,d,e") {
    out.errors.push("chunking changed the list")
  }

  return out
}

/**
 * Does the generate dialog send WHERE the pages should go?
 *
 * Step 4 of the bulk generator. The client prepares a cover and a final page
 * in advance, so what the product pages sit BETWEEN is the whole question —
 * and it used to be implicit, "wherever you were scrolled to". A page landing
 * in the wrong half of a forty-page catalogue is tedious to undo.
 *
 * Two things are checked: that the default follows the page you were on, and
 * that changing it actually reaches the generator rather than being shown and
 * ignored.
 */
export interface GenerateTargetResult {
  errors: string[]
  optionLabels: string[]
  defaultSelected: string
  sentAfterIndex: number | null
  sentSkuCount: number
}

export async function runGenerateTargetSelfTest(): Promise<GenerateTargetResult> {
  const [{ createElement }, { createRoot }, { PdfGenerateDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("./PdfGenerateDialog"),
  ])
  const out: GenerateTargetResult = {
    errors: [], optionLabels: [], defaultSelected: "", sentAfterIndex: null, sentSkuCount: 0,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const sent: { afterIndex: number | null; skus: number } = { afterIndex: null, skus: 0 }

  const box = { left: 10, bottom: 20, right: 110, top: 40 }
  try {
    root.render(createElement(PdfGenerateDialog, {
      open: true,
      templates: [{
        id: "1", name: "Two up", description: null, category: "grid", supplier: null,
        previewUrl: null, widthPts: 595, heightPts: 842, productCount: 2, createdAt: null,
        slots: [{ fieldId: "sku", kind: "text" as const, productIndex: 0, bbox: box }],
      }],
      templatesLoading: false,
      // A cover, two middle pages and a final page — the shape the client
      // describes preparing in advance.
      pages: [
        { index: 0, label: "Page 1 (the first page)" },
        { index: 1, label: "Page 2" },
        { index: 2, label: "Page 3" },
        { index: 3, label: "Page 4 (the end)" },
      ],
      // Opened while looking at page 3, so THAT is what it should offer.
      defaultAfterIndex: 2,
      onCheck: async () => ({ found: 4, missing: [] }),
      collections: [],
      collectionsLoading: false,
      onLoadCollectionSkus: async () => [],
      busy: false,
      progress: null,
      onGenerate: (_tpl: unknown, skus: string[], afterIndex: number) => {
        sent.afterIndex = afterIndex
        sent.skus = skus.length
      },
      onCancel: () => {},
    } as never))
    await new Promise((r) => setTimeout(r, 150))

    const select = document.querySelector<HTMLSelectElement>("[data-pdf-generate-after]")
    if (!select) {
      out.errors.push("there is no control for where the pages go")
      return out
    }
    out.optionLabels = Array.from(select.options).map((o) => o.textContent?.trim() ?? "")
    out.defaultSelected = select.value

    // The default must follow the page you were LOOKING AT. Defaulting to the
    // first page would drop forty pages straight after the cover.
    if (out.defaultSelected !== "2") {
      out.errors.push(
        `the position defaulted to ${out.defaultSelected}, expected 2 — the page in view`)
    }
    // The first and last are named, because that is what a cover and a final
    // page are; a bare number tells you nothing without going to look.
    if (!out.optionLabels[0].includes("first")) {
      out.errors.push(`the first page reads "${out.optionLabels[0]}" and is not called out`)
    }
    if (!out.optionLabels[3].includes("end")) {
      out.errors.push(`the last page reads "${out.optionLabels[3]}" and is not called out`)
    }

    // ── Choosing a different position must REACH the generator ────────
    const setValue = (el: HTMLElement, prototype: { prototype: object }, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set
      setter?.call(el, value)
    }
    setValue(select, window.HTMLSelectElement, "0")
    select.dispatchEvent(new Event("change", { bubbles: true }))

    const area = document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")!
    setValue(area, window.HTMLTextAreaElement, "A\nB\nC\nD")
    area.dispatchEvent(new Event("input", { bubbles: true }))

    const tpl = document.querySelector<HTMLSelectElement>("[data-pdf-generate-template]")!
    setValue(tpl, window.HTMLSelectElement, "1")
    tpl.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))

    document.querySelector<HTMLButtonElement>("[data-pdf-generate-run]")?.click()
    await new Promise((r) => setTimeout(r, 100))

    out.sentAfterIndex = sent.afterIndex
    out.sentSkuCount = sent.skus
    // THE check. Shown-and-ignored is the failure that looks like it works.
    if (out.sentAfterIndex !== 0) {
      out.errors.push(
        `the position was changed to page 1 but the generator was told`
        + ` ${out.sentAfterIndex} — the choice is displayed and ignored`)
    }
    if (out.sentSkuCount !== 4) {
      out.errors.push(`the generator was given ${out.sentSkuCount} SKUs, expected 4`)
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root.unmount()
    host.remove()
  }

  return out
}

/**
 * "Or an entire collection" — the brief's alternative to naming every product.
 *
 * Three things can go wrong here, and only one of them is obvious:
 *
 *   1. Adding a collection REPLACES a list somebody already built. Obvious
 *      once it happens, and destructive — there is no undo in a dialog.
 *   2. Only the series name is sent, not the supplier. Invisible: it works
 *      perfectly until two suppliers both sell a "Marble", and then it
 *      quietly builds a catalogue out of two unrelated ranges. This is the
 *      one worth a test, because nothing about the screen would look wrong.
 *   3. A failed load leaves the user believing products were added.
 */
export interface CollectionPickerResult {
  errors: string[]
  optionLabels: string[]
  /** What the loader was actually asked for — the identity question. */
  requested: { series: string; supplier: string | null } | null
  textBefore: string
  textAfter: string
  note: string
  textAfterFailure: string
}

export async function runCollectionPickerSelfTest(): Promise<CollectionPickerResult> {
  const [{ createElement }, { createRoot }, { PdfGenerateDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("./PdfGenerateDialog"),
  ])
  const out: CollectionPickerResult = {
    errors: [], optionLabels: [], requested: null,
    textBefore: "", textAfter: "", note: "", textAfterFailure: "",
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  // TWO suppliers with the SAME series name. If a collection is identified by
  // its name alone these are indistinguishable, and the test below proves
  // which one was asked for.
  const collections = [
    { key: "Alpha Marble", series: "Marble", seriesEn: "Marble", supplier: "Alpha", skuCount: 3 },
    { key: "Beta Marble", series: "Marble", seriesEn: "Marble", supplier: "Beta", skuCount: 2 },
  ]

  const asked: { series: string; supplier: string | null }[] = []
  // Fails on the SECOND call, so one run covers both the success and the
  // failure without rebuilding the dialog.
  let failNext = false

  const setValue = (el: HTMLElement, prototype: { prototype: object }, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set
    setter?.call(el, value)
  }

  try {
    root.render(createElement(PdfGenerateDialog, {
      open: true,
      templates: [],
      templatesLoading: false,
      pages: [{ index: 0, label: "Page 1" }],
      defaultAfterIndex: 0,
      onCheck: async () => ({ found: 0, missing: [] }),
      collections,
      collectionsLoading: false,
      onLoadCollectionSkus: async (c: { series: string; supplier: string | null }) => {
        asked.push({ series: c.series, supplier: c.supplier })
        if (failNext) return null
        return ["BETA-1", "BETA-2"]
      },
      busy: false,
      progress: null,
      onGenerate: () => {},
      onCancel: () => {},
    } as never))
    await new Promise((r) => setTimeout(r, 150))

    const picker = document.querySelector<HTMLSelectElement>("[data-pdf-generate-collection]")
    const area = document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")
    if (!picker || !area) {
      out.errors.push("the collection picker is not on the screen")
      return out
    }
    out.optionLabels = Array.from(picker.options).map((o) => o.textContent?.trim() ?? "")

    // The size belongs in the label: the brief's whole framing is "50 / 100 /
    // 500 products", so a name with no number cannot answer the question the
    // user is actually asking.
    if (!out.optionLabels.some((label) => label.includes("3 products"))) {
      out.errors.push(
        `no option says how big the collection is — labels were ${JSON.stringify(out.optionLabels)}`)
    }

    // ── A list is already in progress ─────────────────────────────────
    setValue(area, window.HTMLTextAreaElement, "MINE-1\nMINE-2")
    area.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
    out.textBefore = area.value

    // Pick the SECOND "Marble" — same name as the first, different supplier.
    setValue(picker, window.HTMLSelectElement, "Beta Marble")
    picker.dispatchEvent(new Event("change", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))

    document.querySelector<HTMLButtonElement>("[data-pdf-generate-collection-add]")?.click()
    await new Promise((r) => setTimeout(r, 200))

    out.requested = asked[0] ?? null
    out.textAfter =
      document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")?.value ?? ""
    out.note =
      document.querySelector("[data-pdf-generate-collection-note]")?.textContent?.trim() ?? ""

    // THE identity check. Asking for "Marble" with no supplier would fetch
    // Alpha's range, or both, and the screen would look identical.
    if (out.requested?.supplier !== "Beta") {
      out.errors.push(
        `picked Beta's Marble but the loader was asked for supplier`
        + ` ${JSON.stringify(out.requested?.supplier ?? null)} — two suppliers'`
        + " collections are being treated as one")
    }

    // THE destructive check. A list somebody pasted must survive.
    if (!out.textAfter.includes("MINE-1") || !out.textAfter.includes("MINE-2")) {
      out.errors.push(
        `the existing list was destroyed — the box now reads ${JSON.stringify(out.textAfter)}`)
    }
    if (!out.textAfter.includes("BETA-1") || !out.textAfter.includes("BETA-2")) {
      out.errors.push(
        `the collection's SKUs were not added — the box reads ${JSON.stringify(out.textAfter)}`)
    }
    // Appended, not prepended: the order somebody typed is the order they meant.
    if (out.textAfter.indexOf("MINE-1") > out.textAfter.indexOf("BETA-1")) {
      out.errors.push("the collection was added ABOVE the existing list, reordering it")
    }
    if (!out.note.includes("2")) {
      out.errors.push(`adding a collection said "${out.note}", which does not report what it did`)
    }

    // ── And when the load fails ───────────────────────────────────────
    failNext = true
    document.querySelector<HTMLButtonElement>("[data-pdf-generate-collection-add]")?.click()
    await new Promise((r) => setTimeout(r, 200))
    out.textAfterFailure =
      document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")?.value ?? ""

    if (out.textAfterFailure !== out.textAfter) {
      out.errors.push("a failed load still changed the list")
    }
    const failNote =
      document.querySelector("[data-pdf-generate-collection-note]")?.textContent?.trim() ?? ""
    if (failNote === out.note || failNote === "") {
      out.errors.push(`a failed load still reads "${failNote}" — it looks like it worked`)
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root.unmount()
    host.remove()
  }

  return out
}

/**
 * Does a collection's label survive a Hebrew supplier name?
 *
 * Reported from a real catalogue: a collection showed as
 *
 *   LONDON — **4 · עד products
 *
 * where the count had jumped out of its own phrase and landed beside the
 * supplier. Nothing was missing and nothing was wrong in the database — the
 * label is assembled from a Latin name, a Hebrew supplier and a count, and
 * the browser lays all three out as one bidirectional paragraph. That is why
 * it survived being looked at: it reads as damaged data rather than as a
 * rendering fault.
 *
 * The test measures WHERE each part lands rather than what the string
 * contains, because the string was always right. And it re-measures with the
 * isolate characters stripped out — if that control does not fail, the
 * measurement is not sensitive to the bug and proves nothing.
 */
export interface CollectionLabelBidiResult {
  errors: string[]
  optionText: string
  positions: Record<string, number | null>
  strippedPositions: Record<string, number | null>
}

export async function runCollectionLabelBidiSelfTest(): Promise<CollectionLabelBidiResult> {
  const [{ createElement }, { createRoot }, { PdfGenerateDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("./PdfGenerateDialog"),
  ])
  const out: CollectionLabelBidiResult = {
    errors: [], optionText: "", positions: {}, strippedPositions: {},
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  /** Left edge of a substring as actually laid out, or null if absent. */
  const xOf = (node: Text, text: string, needle: string): number | null => {
    const i = text.indexOf(needle)
    if (i < 0) return null
    const range = document.createRange()
    range.setStart(node, i)
    range.setEnd(node, i + needle.length)
    return Math.round(range.getBoundingClientRect().left)
  }

  /** Renders a string the way the dropdown would and reports where the parts
   *  land. LTR because that is the English interface the fault was seen in —
   *  a Hebrew supplier is enough on its own, the UI need not be Hebrew. */
  const layout = (text: string): Record<string, number | null> => {
    const span = document.createElement("span")
    span.dir = "ltr"
    span.style.cssText = "position:fixed;top:0;left:0;font:16px sans-serif;white-space:pre"
    span.textContent = text
    document.body.appendChild(span)
    const node = span.firstChild as Text
    const at = {
      name: xOf(node, text, "LONDON"),
      supplier: xOf(node, text, "עד"),
      count: xOf(node, text, "4"),
      unit: xOf(node, text, "products"),
    }
    span.remove()
    return at
  }

  try {
    root.render(createElement(PdfGenerateDialog, {
      open: true,
      templates: [],
      templatesLoading: false,
      pages: [{ index: 0, label: "Page 1" }],
      defaultAfterIndex: 0,
      onCheck: async () => ({ found: 0, missing: [] }),
      // The reported shape: Latin collection name, Hebrew supplier, a count.
      collections: [{
        key: "k", series: "LONDON", seriesEn: "LONDON", supplier: "עד", skuCount: 4,
      }],
      collectionsLoading: false,
      onLoadCollectionSkus: async () => [],
      busy: false,
      progress: null,
      onGenerate: () => {},
      onCancel: () => {},
    } as never))
    await new Promise((r) => setTimeout(r, 150))

    const picker = document.querySelector<HTMLSelectElement>("[data-pdf-generate-collection]")
    if (!picker || picker.options.length < 2) {
      out.errors.push("the collection option is not on the screen")
      return out
    }
    // The REAL string the component builds, not one retyped by the test.
    out.optionText = picker.options[1].textContent ?? ""
    out.positions = layout(out.optionText)

    const { name, supplier, count, unit } = out.positions
    if (name === null || supplier === null || count === null || unit === null) {
      out.errors.push(`a part of the label is missing: ${JSON.stringify(out.positions)}`)
      return out
    }

    // Logical order is name, supplier, count, unit. On screen it must run the
    // same way, or the label says something the data does not.
    if (!(name < supplier && supplier < count && count < unit)) {
      out.errors.push(
        `the label is laid out in the wrong order — name ${name}, supplier ${supplier},`
        + ` count ${count}, unit ${unit}. The count has moved out of its own phrase.`)
    }

    // ── The control ───────────────────────────────────────────────────
    // Same string, isolate characters removed. This is the broken version,
    // and it MUST fail the check above — otherwise the measurement is blind
    // and the passing result above means nothing.
    const stripped = out.optionText.replace(/[⁨⁩]/g, "")
    out.strippedPositions = layout(stripped)
    const s = out.strippedPositions
    if (s.name === null || s.supplier === null || s.count === null || s.unit === null) {
      out.errors.push("the control string lost a part, so it cannot prove anything")
    } else if (s.name < s.supplier && s.supplier < s.count && s.count < s.unit) {
      out.errors.push(
        "the control PASSED without the isolate characters — this test cannot"
        + " detect the fault it exists for, so the result above is meaningless")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root.unmount()
    host.remove()
  }

  return out
}

/**
 * Does a SKU still read as itself under Hebrew?
 *
 * ".4211121" is a real SKU in this catalogue. In the Hebrew interface the SKU
 * box inherited the page's right-to-left direction and showed it as
 * "4211121." — the leading dot is a neutral character, and the bidi algorithm
 * moved it to the far end.
 *
 * The value was never altered: it uploaded, looked up and generated
 * correctly. Only the person reading the box was misled, which is why this
 * needs measuring rather than inspecting.
 *
 * Two things are checked. That the box is pinned to left-to-right, and — the
 * control — that the same string in a right-to-left box really does come out
 * reordered. Without the second, the first proves only that an attribute was
 * set, not that setting it mattered.
 */
export interface SkuDirectionResult {
  errors: string[]
  textareaDirection: string
  ltrDotAtStart: boolean
  rtlDotAtStart: boolean
}

export async function runSkuDirectionSelfTest(): Promise<SkuDirectionResult> {
  const [{ createElement }, { createRoot }, i18n, { PdfGenerateDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("@/i18n"),
    import("./PdfGenerateDialog"),
  ])
  const out: SkuDirectionResult = {
    errors: [], textareaDirection: "", ltrDotAtStart: false, rtlDotAtStart: false,
  }
  const previousLanguage = i18n.default.language

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  /** Is the dot drawn to the LEFT of the digits, as written? */
  const dotComesFirst = (dir: "ltr" | "rtl"): boolean => {
    const sku = ".4211121"
    const span = document.createElement("span")
    span.dir = dir
    span.style.cssText = "position:fixed;top:0;left:0;font:16px monospace;white-space:pre"
    span.textContent = sku
    document.body.appendChild(span)
    const node = span.firstChild as Text
    const at = (from: number, to: number) => {
      const r = document.createRange()
      r.setStart(node, from)
      r.setEnd(node, to)
      return r.getBoundingClientRect().left
    }
    const dot = at(0, 1)
    const digits = at(1, sku.length)
    span.remove()
    return dot < digits
  }

  try {
    // Hebrew, because that is the only situation in which this goes wrong.
    await i18n.default.changeLanguage("he")

    root.render(createElement(PdfGenerateDialog, {
      open: true,
      templates: [],
      templatesLoading: false,
      pages: [{ index: 0, label: "1" }],
      defaultAfterIndex: 0,
      onCheck: async () => ({ found: 0, missing: [] }),
      collections: [],
      collectionsLoading: false,
      onLoadCollectionSkus: async () => [],
      busy: false,
      progress: null,
      onGenerate: () => {},
      onCancel: () => {},
    } as never))
    await new Promise((r) => setTimeout(r, 150))

    const area = document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")
    if (!area) {
      out.errors.push("the SKU box is not on the screen")
      return out
    }
    out.textareaDirection = getComputedStyle(area).direction
    if (out.textareaDirection !== "ltr") {
      out.errors.push(
        `under Hebrew the SKU box computes to direction:${out.textareaDirection} —`
        + ' a SKU beginning with a dot will be shown with the dot at the far end')
    }

    out.ltrDotAtStart = dotComesFirst("ltr")
    out.rtlDotAtStart = dotComesFirst("rtl")

    if (!out.ltrDotAtStart) {
      out.errors.push("even left-to-right draws the dot after the digits — the measurement is wrong")
    }
    // THE control. If right-to-left ALSO keeps the dot first then this bug
    // cannot be reproduced here, and the check above is not evidence of
    // anything.
    if (out.rtlDotAtStart) {
      out.errors.push(
        "right-to-left kept the dot in place, so the fault this test exists for"
        + " does not reproduce and the result above proves nothing")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root.unmount()
    host.remove()
    await i18n.default.changeLanguage(previousLanguage)
  }

  return out
}

/** Puts the generate dialog on screen, with a list already typed in. */
export async function showGenerateDialog(
  language: "en" | "he", withSkus = true,
): Promise<void> {
  const [{ createElement }, { createRoot }, i18n, { PdfGenerateDialog }] = await Promise.all([
    import("react"), import("react-dom/client"), import("@/i18n"),
    import("./PdfGenerateDialog"),
  ])
  await i18n.default.changeLanguage(language)

  document.getElementById("generate-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "generate-inspect"
  document.body.appendChild(host)

  const box = { left: 10, bottom: 20, right: 110, top: 40 }
  createRoot(host).render(createElement(PdfGenerateDialog, {
    open: true,
    templates: [{
      id: "1", name: "Eight products, grid", description: null,
      category: "grid", supplier: "Varmora", previewUrl: null,
      widthPts: 595, heightPts: 842, productCount: 8, createdAt: null,
      slots: [{ fieldId: "sku", kind: "text" as const, productIndex: 0, bbox: box }],
    }],
    templatesLoading: false,
    pages: [
      { index: 0, label: "Page 1 (the first page)" },
      { index: 1, label: "Page 2 (the end)" },
    ],
    defaultAfterIndex: 0,
    onCheck: async () => ({ found: 38, missing: ["BAD-1", "BAD-2"] }),
    collections: [
      { key: "Varmora Carnaby", series: "קרנבי", seriesEn: "Carnaby", supplier: "Varmora", skuCount: 48 },
      { key: "Varmora Concrete", series: "בטון", seriesEn: "Concrete Look", supplier: "Varmora", skuCount: 12 },
      { key: " Marble", series: "שיש", seriesEn: "Marble", supplier: null, skuCount: 7 },
    ],
    collectionsLoading: false,
    onLoadCollectionSkus: async () => ["A-1", "A-2", "A-3"],
    busy: false,
    progress: null,
    onGenerate: () => {},
    canRefresh: false,
    onRefreshFromDatabase: () => {},
    onCancel: () => {},
  } as never))
  await new Promise((r) => setTimeout(r, 200))

  if (withSkus) {
    const area = document.querySelector<HTMLTextAreaElement>("[data-pdf-generate-skus]")
    const select = document.querySelector<HTMLSelectElement>("[data-pdf-generate-template]")
    if (select) {
      select.value = "1"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    }
    if (area) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(area, Array.from({ length: 40 }, (_, i) => `10020${1300 + i}`).join("\n"))
      area.dispatchEvent(new Event("input", { bubbles: true }))
    }
    await new Promise((r) => setTimeout(r, 200))
    document.querySelector<HTMLButtonElement>("[data-pdf-generate-check]")?.click()
    await new Promise((r) => setTimeout(r, 300))
  }
}
