// Are the page sizes actually the sizes they claim to be?
//
// This is arithmetic with a right answer, so it is checked against the
// published figures rather than against itself. A4 is 210x297mm, which is
// 595x842 points; Letter is 8.5x11in, which is 612x792. Getting the
// millimetre-to-point conversion wrong produces pages that look plausible on
// screen and are the wrong size at the printer — the kind of fault nobody
// catches until a proof comes back.
import {
  PAGE_SIZE_PRESETS, matchPreset, orientationOf, resolvePageSize,
} from "./pageSizes"

export interface PageSizeTestResult {
  errors: string[]
  sizes: Record<string, string>
  landscapeA4: string
  matchedA4: string | null
  matchedA4Landscape: string | null
  matchedOddSize: string | null
  orientations: string[]
}

/** The published sizes, in points, from the standards themselves. */
const EXPECTED: Record<string, [number, number]> = {
  a4: [595, 842],
  a3: [842, 1191],
  a5: [420, 595],
  a2: [1191, 1684],
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  square: [595, 595],
}

export function runPageSizeSelfTest(): PageSizeTestResult {
  const out: PageSizeTestResult = {
    errors: [], sizes: {}, landscapeA4: "", matchedA4: null,
    matchedA4Landscape: null, matchedOddSize: null, orientations: [],
  }

  for (const preset of PAGE_SIZE_PRESETS) {
    out.sizes[preset.id] = `${preset.widthPts}x${preset.heightPts}`
    const expected = EXPECTED[preset.id]
    if (!expected) {
      out.errors.push(`${preset.id} has no published size to check against`)
      continue
    }
    // One point of tolerance: the standards themselves round differently in
    // different places, and a page box is written as an integer anyway.
    if (Math.abs(preset.widthPts - expected[0]) > 1
      || Math.abs(preset.heightPts - expected[1]) > 1) {
      out.errors.push(
        `${preset.label} is ${preset.widthPts}x${preset.heightPts} points,`
        + ` but ${preset.detail} is ${expected[0]}x${expected[1]}`)
    }
    // Every preset is stored PORTRAIT, so orientation can be a separate
    // choice instead of doubling the list.
    if (preset.widthPts > preset.heightPts) {
      out.errors.push(`${preset.label} is stored landscape; presets must be portrait`)
    }
  }

  // ── Orientation swaps, and only swaps ────────────────────────────────
  const a4 = PAGE_SIZE_PRESETS.find((p) => p.id === "a4")!
  const landscape = resolvePageSize(a4, "landscape")
  out.landscapeA4 = `${landscape.widthPts}x${landscape.heightPts}`
  if (landscape.widthPts !== a4.heightPts || landscape.heightPts !== a4.widthPts) {
    out.errors.push(`A4 landscape came out ${out.landscapeA4}, expected the portrait size swapped`)
  }
  const portrait = resolvePageSize(a4, "portrait")
  if (portrait.widthPts !== a4.widthPts || portrait.heightPts !== a4.heightPts) {
    out.errors.push("asking for portrait changed the portrait size")
  }

  // ── Recognising a document's own size ────────────────────────────────
  out.matchedA4 = matchPreset(595, 842)?.label ?? null
  if (out.matchedA4 !== "A4") {
    out.errors.push(`595x842 was recognised as ${out.matchedA4}, expected A4`)
  }
  // A landscape page is still A4 — the size is the pair of numbers, not their
  // order.
  out.matchedA4Landscape = matchPreset(842, 595)?.label ?? null
  if (out.matchedA4Landscape !== "A4") {
    out.errors.push(`842x595 was recognised as ${out.matchedA4Landscape}, expected A4`)
  }
  // The control: a size that is NOT a standard must not be claimed as one,
  // or "same as this page" would silently round a custom catalogue to A4.
  out.matchedOddSize = matchPreset(680, 822)?.label ?? null
  if (out.matchedOddSize !== null) {
    out.errors.push(
      `680x822 — a real catalogue's own size — was claimed to be ${out.matchedOddSize}`)
  }

  out.orientations = [
    orientationOf(595, 842), orientationOf(842, 595), orientationOf(500, 500),
  ]
  if (out.orientations.join(",") !== "portrait,landscape,portrait") {
    out.errors.push(`orientations read as ${out.orientations.join(",")}`)
  }

  return out
}

/**
 * Puts the add-page dialog on screen and leaves it there, for looking at.
 *
 * The checks above are blind to layout, and this dialog has a right-to-left
 * mirror image to get right like every other panel here.
 */
export async function showAddPageDialog(language: "en" | "he"): Promise<void> {
  const [{ createElement }, { createRoot }, i18n, { PdfAddPageDialog }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("@/i18n"),
    import("./PdfAddPageDialog"),
  ])
  await i18n.default.changeLanguage(language)

  const existing = document.getElementById("add-page-inspect")
  existing?.remove()
  const host = document.createElement("div")
  host.id = "add-page-inspect"
  document.body.appendChild(host)

  createRoot(host).render(createElement(PdfAddPageDialog, {
    open: true,
    // A real catalogue's own size — deliberately NOT a standard, so the
    // "same as this page" option has to describe it in millimetres rather
    // than claim it is A4.
    afterPage: { widthPts: 680, heightPts: 822 },
    afterPageNumber: 3,
    onCancel: () => {},
    onAdd: () => {},
  }))
  await new Promise((r) => setTimeout(r, 300))
}
