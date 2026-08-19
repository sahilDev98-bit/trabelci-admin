/**
 * Where to put something new on a page.
 *
 * Written because "always 48pt in from the top-left corner" is wrong on a
 * designed document: that corner is exactly where a logo lives. An image
 * added there landed UNDER the logo's slot, and since logos and text are
 * drawn above images, the new image's top corners — its resize handles —
 * were buried and could not be grabbed. It looked like adding an image
 * simply produced something broken.
 *
 * Pure functions so the choice can be checked against exact geometry.
 */

export interface Box {
  left: number
  bottom: number
  right: number
  top: number
}

export interface PageSize {
  widthPts: number
  heightPts: number
}

/** Margin kept from the page edges, PDF points. */
const EDGE_MARGIN_PTS = 24

/**
 * Slots covering more of the page than this are BACKGROUNDS — a full-bleed
 * photo, a border. New content is meant to sit on top of those, so counting
 * them as occupied would make every position look equally bad and the search
 * pointless.
 */
const BACKGROUND_COVERAGE = 0.6

/** How finely the page is searched. 7x7 is enough to find a gap on a busy
 * catalogue page without turning placement into a visible pause. */
const GRID: number = 7

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * A spot for a new item of `size`, as its BOTTOM-LEFT corner in PDF points.
 *
 * Searches a grid of candidates and takes the one that collides least with
 * what is already there, preferring positions nearer the middle of the page
 * when several are equally free — the middle is where a person looks, and
 * where there is most room to then drag it somewhere deliberate.
 */
export function findFreeSpot(
  page: PageSize,
  occupied: Box[],
  size: { width: number; height: number },
): { x: number; y: number } {
  const maxX = Math.max(EDGE_MARGIN_PTS, page.widthPts - size.width - EDGE_MARGIN_PTS)
  const maxY = Math.max(EDGE_MARGIN_PTS, page.heightPts - size.height - EDGE_MARGIN_PTS)

  const pageArea = page.widthPts * page.heightPts
  const blocking = pageArea > 0
    ? occupied.filter((b) => {
      const area = Math.max(0, b.right - b.left) * Math.max(0, b.top - b.bottom)
      return area / pageArea <= BACKGROUND_COVERAGE
    })
    : occupied

  const centre = {
    x: (EDGE_MARGIN_PTS + maxX) / 2,
    y: (EDGE_MARGIN_PTS + maxY) / 2,
  }

  let best: { x: number; y: number; overlap: number; fromCentre: number } | null = null

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = GRID === 1 ? centre.x
        : EDGE_MARGIN_PTS + ((maxX - EDGE_MARGIN_PTS) * col) / (GRID - 1)
      const y = GRID === 1 ? centre.y
        : EDGE_MARGIN_PTS + ((maxY - EDGE_MARGIN_PTS) * row) / (GRID - 1)
      const candidate: Box = {
        left: x, bottom: y, right: x + size.width, top: y + size.height,
      }
      const overlap = blocking.reduce((sum, b) => sum + overlapArea(candidate, b), 0)
      const fromCentre = Math.hypot(x - centre.x, y - centre.y)

      if (
        !best
        || overlap < best.overlap - 0.5
        // Equally clear: take the one nearer the middle.
        || (Math.abs(overlap - best.overlap) <= 0.5 && fromCentre < best.fromCentre)
      ) {
        best = { x, y, overlap, fromCentre }
      }
      // Nothing beats a completely free spot at the centre.
      if (overlap === 0 && fromCentre === 0) return { x, y }
    }
  }

  return best ? { x: best.x, y: best.y } : { x: EDGE_MARGIN_PTS, y: EDGE_MARGIN_PTS }
}

/**
 * The size a newly added image should be drawn at, keeping its own aspect
 * ratio so it is never stretched.
 *
 * Shared by both ways of adding one — the button and a dropped file — so the
 * two cannot drift into producing different sizes for the same picture.
 */
export function newImageSize(
  page: PageSize, naturalWidth: number, naturalHeight: number, preferredWidth: number,
): { width: number; height: number } {
  const ratio = naturalWidth > 0 ? naturalHeight / naturalWidth : 1
  const width = Math.min(preferredWidth, page.widthPts * 0.8)
  return { width, height: width * ratio }
}
