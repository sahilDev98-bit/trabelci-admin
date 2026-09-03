/**
 * Turning what somebody pastes into an ordered list of SKUs.
 *
 * The client's requirement has one line that decides the whole design:
 *
 *   "Read the SKUs in the exact order provided."
 *
 * So this preserves order absolutely, and it preserves DUPLICATES too. A
 * catalogue that shows the same tile in two sections is a real thing, and
 * silently removing the second one would produce a catalogue with a hole in
 * it that nobody could explain. Duplicates are reported so they can be seen,
 * never dropped.
 *
 * What arrives is genuinely messy: a column pasted out of Excel comes with
 * carriage returns and trailing tabs, a list from an email comes
 * comma-separated, a CSV export wraps values in quotes, and somewhere in
 * there is a header row saying "SKU". All of it has to become the same list.
 */

export interface ParsedSkuList {
  /** In the order given, duplicates included. */
  skus: string[]
  /** Values that appeared more than once, with how many times. Reported so
   * the user can see them; never removed on their guess. */
  duplicates: { sku: string; count: number }[]
  /** A first row that was words rather than a code — "SKU", "Item", "Code" —
   * dropped, and named so the drop is visible rather than mysterious. */
  droppedHeader: string | null
  /** How many lines had something on them that could not be read as a SKU. */
  ignoredLines: number
}

/**
 * Words a first row might use to label the column.
 *
 * Only ever applied to the FIRST row, and only when it is not itself a
 * plausible SKU. A product legitimately called "Code" would otherwise vanish
 * from the top of every list.
 */
const HEADER_WORDS = new Set([
  "sku", "skus", "code", "codes", "item", "items", "item code", "itemcode",
  "product", "products", "product code", "productcode", "article", "barcode",
  "מק\"ט", "מקט", "פריט", "קוד",
])

/**
 * Anything that separates one SKU from the next.
 *
 * Includes the tab and the semicolon because that is what a spreadsheet
 * column and a European CSV actually produce, and the vertical bar because
 * people paste from all sorts of places.
 */
const SEPARATORS = /[\r\n,;|\t]+/

/**
 * What a SKU may contain.
 *
 * Deliberately permissive — letters, digits, dot, dash, underscore, slash —
 * because these are supplier codes and the shapes vary wildly. What it
 * excludes is the thing that matters: spaces, so a pasted sentence does not
 * become one enormous SKU, and quotes, which a CSV puts around values.
 */
const SKU_SHAPE = /^[\w./-]+$/

/** Strips the quotes a CSV export wraps values in, and the whitespace a
 * spreadsheet leaves behind. */
const clean = (raw: string): string => {
  let value = raw.trim()
  if (value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim()
  }
  // Excel writes a leading apostrophe to keep a numeric code as text; it is
  // part of the spreadsheet, never part of the code.
  if (value.startsWith("'")) value = value.slice(1).trim()
  return value
}

export function parseSkuList(input: string): ParsedSkuList {
  const out: ParsedSkuList = { skus: [], duplicates: [], droppedHeader: null, ignoredLines: 0 }
  if (!input.trim()) return out

  const pieces = input.split(SEPARATORS).map(clean).filter((v) => v !== "")

  const counts = new Map<string, number>()
  for (let i = 0; i < pieces.length; i++) {
    const value = pieces[i]

    // A header, but only as the very first value and only when it is not
    // itself SKU-shaped. "SKU" is a word; "SKU100" is a product.
    if (i === 0 && HEADER_WORDS.has(value.toLowerCase())) {
      out.droppedHeader = value
      continue
    }

    if (!SKU_SHAPE.test(value)) {
      out.ignoredLines++
      continue
    }

    out.skus.push(value)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  for (const [sku, count] of counts) {
    if (count > 1) out.duplicates.push({ sku, count })
  }
  // Reported in the order they first appear, so the message reads in the same
  // order as the list the user is looking at.
  out.duplicates.sort((a, b) => out.skus.indexOf(a.sku) - out.skus.indexOf(b.sku))

  return out
}

/**
 * How many pages a list will make with a given template.
 *
 * The client's own example: forty SKUs into an eight-product template makes
 * five pages. A partial last page counts — thirty-nine SKUs still needs five
 * pages, with one tile left empty.
 */
export function pagesNeeded(skuCount: number, productsPerPage: number): number {
  if (skuCount <= 0 || productsPerPage <= 0) return 0
  return Math.ceil(skuCount / productsPerPage)
}

/** Splits the list into one group per page, in order. The last group may be
 * short, and that is not an error — it is a page with empty tiles. */
export function chunkForPages<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage <= 0) return []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += perPage) out.push(items.slice(i, i + perPage))
  return out
}

/**
 * Reading a SKU list out of an uploaded file.
 *
 * -- Why .xlsx is not read here --
 *
 * The client asked for "an Excel file", and the obvious way to read one is
 * SheetJS. Its npm package carries a HIGH severity prototype-pollution
 * advisory (GHSA-4r6h-8v6p-xvw6) with no fixed version published there -- the
 * project moved to its own distribution and abandoned the npm release. Adding
 * that to an admin application handling business data is not a decision to
 * make quietly, so it has not been made.
 *
 * What this does instead is read the formats that need no parser at all --
 * CSV, tab-separated, plain text -- which Excel produces with one "Save As".
 * A real .xlsx is DETECTED and refused with that instruction, rather than
 * being silently misread: an xlsx is a zip, so reading it as text produces
 * binary rubble that a permissive parser would happily turn into nonsense
 * SKUs.
 */
export type SkuFileOutcome =
  | { ok: true; text: string }
  | { ok: false; reason: "spreadsheet" | "unreadable" }

/** The first bytes of every .xlsx (and .docx, .pptx): a ZIP local header. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * Whether a string looks like binary rather than a list of codes.
 *
 * Counted with character codes rather than a regular expression: matching
 * control characters in a pattern is exactly what `no-control-regex` warns
 * about, and a loop says what it means without an escape hatch. Tab, newline
 * and carriage return are allowed through — those are the separators.
 */
function looksBinary(text: string): boolean {
  if (text.length === 0) return false
  let control = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isSeparator = code === 9 || code === 10 || code === 13
    if (!isSeparator && (code < 32 || code === 127)) control++
  }
  return control / text.length > 0.01
}

export async function readSkuFile(file: File): Promise<SkuFileOutcome> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (ZIP_MAGIC.every((byte, i) => head[i] === byte)) {
      return { ok: false, reason: "spreadsheet" }
    }
    // The old binary .xls format, equally unreadable as text.
    if (head[0] === 0xd0 && head[1] === 0xcf) return { ok: false, reason: "spreadsheet" }

    const text = await file.text()
    // A file that is largely unprintable is not a list of codes, whatever its
    // name says. Refusing beats filling the page with rubbish.
    if (looksBinary(text)) return { ok: false, reason: "unreadable" }
    return { ok: true, text }
  } catch {
    return { ok: false, reason: "unreadable" }
  }
}
