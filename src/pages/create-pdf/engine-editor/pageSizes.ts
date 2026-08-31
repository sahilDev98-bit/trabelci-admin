/**
 * The page sizes a new blank page can be given.
 *
 * A PDF measures pages in POINTS, where 72 points is one inch. Every size
 * below is that arithmetic done once, so nothing downstream has to remember
 * it:
 *
 *   millimetres -> points   mm / 25.4 * 72
 *   inches      -> points   in * 72
 *
 * The list is the ISO A series plus the North American sizes, which between
 * them cover essentially every catalogue anyone prints. It deliberately does
 * NOT include the dozens of obscure formats a specification lists: an option
 * nobody chooses is a row of noise in front of everyone who is looking for A4.
 */

export interface PageSizePreset {
  id: string
  /** Shown as-is; a paper size's name is the same in every language. */
  label: string
  /** PORTRAIT dimensions in points. Landscape swaps them at the point of use,
   * so a size and an orientation stay separate choices rather than doubling
   * the list. */
  widthPts: number
  heightPts: number
  /** For the second line of the option — the size in the units people
   * actually quote it in. */
  detail: string
}

const mm = (n: number) => (n / 25.4) * 72
const inch = (n: number) => n * 72

/** Rounded to whole points. A page's box is written into the file, and a
 * fractional height serves nobody while making every readout ugly. */
const r = (n: number) => Math.round(n)

export const PAGE_SIZE_PRESETS: readonly PageSizePreset[] = [
  { id: "a4", label: "A4", widthPts: r(mm(210)), heightPts: r(mm(297)), detail: "210 × 297 mm" },
  { id: "a3", label: "A3", widthPts: r(mm(297)), heightPts: r(mm(420)), detail: "297 × 420 mm" },
  { id: "a5", label: "A5", widthPts: r(mm(148)), heightPts: r(mm(210)), detail: "148 × 210 mm" },
  { id: "a2", label: "A2", widthPts: r(mm(420)), heightPts: r(mm(594)), detail: "420 × 594 mm" },
  { id: "letter", label: "Letter", widthPts: r(inch(8.5)), heightPts: r(inch(11)), detail: "8.5 × 11 in" },
  { id: "legal", label: "Legal", widthPts: r(inch(8.5)), heightPts: r(inch(14)), detail: "8.5 × 14 in" },
  { id: "tabloid", label: "Tabloid", widthPts: r(inch(11)), heightPts: r(inch(17)), detail: "11 × 17 in" },
  // Square is not a paper standard, but it is what a great many product
  // catalogues and social sheets are set in, and it cannot be reached by
  // choosing an orientation of anything else.
  { id: "square", label: "Square", widthPts: r(mm(210)), heightPts: r(mm(210)), detail: "210 × 210 mm" },
] as const

export type PageOrientation = "portrait" | "landscape"

/** A preset plus an orientation, as the page will actually be made. */
export function resolvePageSize(
  preset: PageSizePreset, orientation: PageOrientation,
): { widthPts: number; heightPts: number } {
  return orientation === "landscape"
    ? { widthPts: preset.heightPts, heightPts: preset.widthPts }
    : { widthPts: preset.widthPts, heightPts: preset.heightPts }
}

/** Which way round a page is. A square counts as portrait, because it has to
 * count as something and nothing about it is landscape. */
export function orientationOf(widthPts: number, heightPts: number): PageOrientation {
  return widthPts > heightPts ? "landscape" : "portrait"
}

/**
 * The preset a given size corresponds to, if any.
 *
 * Used to preselect "the same as the page you are on", which is the commonest
 * answer by far — a catalogue is nearly always one size throughout. Matched
 * with a tolerance because a real document's boxes are rarely exact: A4 in the
 * wild is 595x842 as often as 595.276x841.89.
 */
export function matchPreset(widthPts: number, heightPts: number): PageSizePreset | null {
  const portrait = widthPts <= heightPts
    ? { w: widthPts, h: heightPts }
    : { w: heightPts, h: widthPts }
  for (const preset of PAGE_SIZE_PRESETS) {
    if (Math.abs(preset.widthPts - portrait.w) <= 2 && Math.abs(preset.heightPts - portrait.h) <= 2) {
      return preset
    }
  }
  return null
}
