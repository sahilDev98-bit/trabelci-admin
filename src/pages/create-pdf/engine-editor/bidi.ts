/**
 * Keeping codes readable when they sit inside Hebrew text.
 *
 * This editor shows a lot of SKUs, supplier names and counts, and they get
 * assembled into sentences and labels. A SKU is a CODE — it reads
 * left-to-right whatever language surrounds it — but the browser lays out a
 * mixed line as one bidirectional paragraph, and neutral characters (a
 * leading dot, a comma, a separator) end up wherever that algorithm puts
 * them rather than where they were written.
 *
 * Two faults found in this module, both from real data:
 *
 *   ".4211121"                 shown as  "4211121."
 *   "LONDON — <supplier> · 4"  shown as  "LONDON — 4 · <supplier>"
 *
 * Neither corrupts anything. The value is intact, the lookup succeeds, the
 * generated page is correct. Only the reader is misled — which is what makes
 * this class of bug survive review, and why it is worth a named helper rather
 * than being fixed ad hoc each time somebody notices.
 *
 * -- When to use which tool --
 *
 * Prefer `dir="ltr"` or `unicode-bidi: plaintext` on an ELEMENT where there
 * is one (see PdfEngineViewportBar's page counter and PdfProductPanel's value
 * column). Reach for `isolate` only when there is no element to style: text
 * interpolated into a translated sentence, or the contents of an `<option>`,
 * which renders its text and nothing else.
 */

/**
 * Wraps text so the bidi algorithm cannot reorder it against its neighbours.
 *
 * U+2068 FIRST STRONG ISOLATE takes its direction from the run itself, and
 * U+2069 closes it — `<bdi>` expressed as characters. Written as escapes
 * because both are invisible: literal ones cannot be seen in a diff and can
 * be deleted by accident without leaving a trace.
 */
export const isolate = (text: string): string => `\u2068${text}\u2069`
