// Do all four page tools space their thumbnails the same?
//
// They did not. Copy and Reorder put a 14px drop strip between every pair of
// pages, and that strip WAS the spacing — the row itself only ever declared a
// vertical gap. Delete and Rotate render no strips, so their pages sat edge to
// edge and the same panel looked like two different panels.
//
// This is a layout question, so reading the CSS proves nothing: a class can be
// present and overridden, and a gap can come from somewhere other than the
// property that appears to set it. The component is therefore mounted for
// real, in the app's own stylesheet, and the distance between two thumbnails
// is MEASURED off their bounding boxes.
//
// The control matters as much as the check. "All four modes measure 14"
// would also be the answer if the measurement were reading a constant instead
// of the page, so the last case renders the same component with the fix
// forced off and must come back with the old jammed-together spacing.
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"

import { PdfPageOrganizer, type OrganizerPage } from "./PdfPageOrganizer"
import type { PdfOrganizerMode } from "./pdfEditorTypes"

export interface OrganizerGapTestResult {
  errors: string[]
  /** mode -> distance in px between page 1 and page 2. */
  gaps: Record<string, number>
  /** mode -> distance from the panel's content edge to the first page. */
  leading: Record<string, number>
  /** The same component with the gap forced off: the old behaviour. */
  controlGap: number
  rtlGap: number
}

const PAGES: OrganizerPage[] = [0, 1, 2].map((i) => ({
  key: `k${i}`,
  clientId: `p${i}`,
  sourceClientId: `p${i}`,
  rotation: 0,
}))

/** Mounts one mode, measures it, and takes it back down. */
async function measure(
  mode: PdfOrganizerMode,
  opts: { rtl?: boolean; forceGapOff?: boolean } = {},
): Promise<{ gap: number; leading: number }> {
  const host = document.createElement("div")
  host.id = "organizer-gap-probe"
  document.body.appendChild(host)
  const previousDir = document.documentElement.dir
  if (opts.rtl) document.documentElement.dir = "rtl"

  // The control: strip the spacing back off through the cascade, which is the
  // only way to reproduce the old layout without editing the component.
  let override: HTMLStyleElement | null = null
  if (opts.forceGapOff) {
    override = document.createElement("style")
    override.textContent =
      "[data-organizer-row]{column-gap:0!important;padding-inline-start:0!important}"
    document.head.appendChild(override)
  }

  let root: Root | null = null
  try {
    root = createRoot(host)
    root.render(createElement(PdfPageOrganizer, {
      mode,
      pages: PAGES,
      // No thumbnails on purpose: the box is a fixed size either way, and a
      // missing picture must not change where the pages sit.
      thumbnails: {},
      onApply: () => {},
      onCancel: () => {},
    }))
    // Two frames: one for React to paint, one for the layout to settle.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const pages = Array.from(
      document.querySelectorAll<HTMLElement>("[data-organizer-page]"))
    if (pages.length < 2) throw new Error(`${mode}: rendered ${pages.length} pages`)

    const row = document.querySelector<HTMLElement>("[data-organizer-row]")!
    const rtl = document.documentElement.dir === "rtl"
    const a = pages[0].getBoundingClientRect()
    const b = pages[1].getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()

    // In Hebrew the pages run the other way, so "the space between them" is
    // the same distance measured from the other side.
    return {
      gap: Math.round(rtl ? a.left - b.right : b.left - a.right),
      leading: Math.round(rtl ? rowRect.right - a.right : a.left - rowRect.left),
    }
  } finally {
    root?.unmount()
    host.remove()
    override?.remove()
    document.documentElement.dir = previousDir
  }
}

export async function runOrganizerGapSelfTest(): Promise<OrganizerGapTestResult> {
  const out: OrganizerGapTestResult = {
    errors: [], gaps: {}, leading: {}, controlGap: -1, rtlGap: -1,
  }

  const modes: PdfOrganizerMode[] = ["copy", "move", "rotate", "delete"]
  for (const mode of modes) {
    const { gap, leading } = await measure(mode)
    out.gaps[mode] = gap
    out.leading[mode] = leading
  }

  // The drag modes are the reference — they are what the user is pointing at
  // and asking the others to match.
  const reference = out.gaps.copy
  for (const mode of modes) {
    // A pixel of tolerance: the borders are drawn at fractional device
    // pixels and rounding can land either side.
    if (Math.abs(out.gaps[mode] - reference) > 1) {
      out.errors.push(
        `${mode} spaces its pages ${out.gaps[mode]}px apart, copy uses ${reference}px`)
    }
    if (Math.abs(out.leading[mode] - out.leading.copy) > 1) {
      out.errors.push(
        `${mode} starts its first page ${out.leading[mode]}px in, copy starts at`
        + ` ${out.leading.copy}px — the grid shifts when you switch tools`)
    }
  }
  // And the spacing has to be a real, visible distance. Four modes agreeing on
  // zero would satisfy the comparison above and be exactly the bug.
  if (reference < 10) {
    out.errors.push(`the pages are only ${reference}px apart — that is the jammed-together layout`)
  }

  // Hebrew: same distance, mirrored. Logical properties should handle this,
  // but "should" is why this line exists.
  const rtl = await measure("delete", { rtl: true })
  out.rtlGap = rtl.gap
  if (Math.abs(rtl.gap - reference) > 1) {
    out.errors.push(`in Hebrew the pages sit ${rtl.gap}px apart, expected ${reference}px`)
  }

  // ── The control ──────────────────────────────────────────────────────
  // With the spacing forced off, delete must fall back to the old layout. If
  // this still reports 14 the measurement is not reading the page at all and
  // every result above is worthless.
  const control = await measure("delete", { forceGapOff: true })
  out.controlGap = control.gap
  if (control.gap >= 10) {
    out.errors.push(
      `CONTROL FAILED: with the gap forced off, delete still measured ${control.gap}px`
      + " — the test is not measuring the real layout")
  }

  return out
}

/** Leaves one mode on screen to be looked at. */
export async function showOrganizer(mode: PdfOrganizerMode, language: "en" | "he"): Promise<void> {
  const i18n = (await import("@/i18n")).default
  await i18n.changeLanguage(language)

  document.getElementById("organizer-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "organizer-inspect"
  document.body.appendChild(host)
  createRoot(host).render(createElement(PdfPageOrganizer, {
    mode, pages: PAGES, thumbnails: {}, onApply: () => {}, onCancel: () => {},
  }))
  await new Promise((r) => setTimeout(r, 300))
}
