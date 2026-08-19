/**
 * How big to draw a page.
 *
 * Pure functions, kept apart from the components, because this is where the
 * counter-intuitive part of full screen lives and it is worth being able to
 * check it against exact numbers.
 *
 * The catalogue this was built for has 1,501 pieces of text and about one in
 * four of them is under 7pt — the smallest is 3pt. Filling the screen with
 * the WHOLE page actually makes those SMALLER than the windowed view does,
 * because the page is taller than it is wide and the screen is not:
 *
 *   windowed today            1.8x   a 6pt caption is ~11px
 *   full screen, whole page   1.2x   ~7px   <- worse
 *   full screen, fit width    3.2x   ~19px  <- readable
 *
 * So zoom is the thing that solves small text; full screen is what gives the
 * zoomed page somewhere to live.
 */

/** CSS pixels per PDF point at 100%. A PDF point is 1/72 inch and CSS
 * assumes 96 dpi, so "actual size" is 96/72. */
export const PX_PER_PT = 96 / 72

export type ZoomMode =
  /** Page width follows the space available. */
  | { kind: "fit-width" }
  /** Whole page visible at once. */
  | { kind: "fit-page" }
  /** Fixed magnification, 1 = actual size. */
  | { kind: "level"; level: number }

/**
 * Zoom stops offered in the toolbar.
 *
 * Capped at 400% deliberately, and the cap is tied to the renderer's own.
 * Pages are drawn as ONE bitmap and the renderer refuses to exceed
 * MAX_RENDER_WIDTH_PX device pixels to bound memory; at 400% an A4 page is
 * ~3173 CSS px, which that cap can still cover at about one device pixel per
 * CSS pixel, so the page stays SHARP. Past this the page would be blown up
 * from a capped bitmap and go soft — and going soft is the opposite of the
 * point when the reason you zoomed in was to read 3pt text. Higher would
 * need tiled rendering of just the visible part, which is a bigger job.
 *
 * 400% is also enough for the problem at hand: it puts the smallest text in
 * this catalogue (3pt) at ~16px, which is ordinary small-print size.
 */
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const
export const MIN_ZOOM = ZOOM_LEVELS[0]
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]

export interface PageSizePts {
  widthPts: number
  heightPts: number
}

export interface AvailableSpace {
  width: number
  height: number
}

/** The CSS width to draw a page at, for a given zoom and space. */
export function pageWidthForZoom(
  mode: ZoomMode, page: PageSizePts, space: AvailableSpace,
): number {
  if (page.widthPts <= 0 || page.heightPts <= 0) return 0
  switch (mode.kind) {
    case "fit-width":
      return Math.max(0, space.width)
    case "fit-page": {
      // Limited by whichever runs out first, so the whole page is visible.
      const byHeight = (space.height * page.widthPts) / page.heightPts
      return Math.max(0, Math.min(space.width, byHeight))
    }
    case "level":
      return page.widthPts * PX_PER_PT * clampZoom(mode.level)
  }
}

export function clampZoom(level: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level))
}

/** What a fit mode works out to as a percentage, for showing in the toolbar
 * — "Fit width" alone tells you nothing about how big things will be. */
export function zoomLevelOf(widthPx: number, page: PageSizePts): number {
  if (page.widthPts <= 0) return 1
  return widthPx / (page.widthPts * PX_PER_PT)
}

/** The next stop up or down from wherever the zoom currently sits, so the
 * +/- buttons work the same whether you are on a fixed level or a fit mode. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const stops = ZOOM_LEVELS
  if (direction === 1) {
    return stops.find((z) => z > current + 0.001) ?? MAX_ZOOM
  }
  return [...stops].reverse().find((z) => z < current - 0.001) ?? MIN_ZOOM
}

/**
 * The zoom that brings one slot up to a comfortable reading size.
 *
 * Used by "Zoom to selection", which is the direct answer to "this caption
 * is 3pt and I cannot read it to edit it". Sized so the slot's HEIGHT lands
 * around a comfortable on-screen size rather than filling the screen, since
 * filling it with one word would lose all context.
 */
export function zoomToFitSlot(
  slotHeightPts: number, targetHeightPx = 20,
): number {
  if (slotHeightPts <= 0) return 1
  return clampZoom(targetHeightPx / (slotHeightPts * PX_PER_PT))
}
