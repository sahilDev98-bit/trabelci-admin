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

/**
 * Which of a page's text lines is the one that was just added.
 *
 * Found by DIFFING the page's text before and after, not by geometry. The
 * geometric version of this — "the line starting nearest where the text was
 * asked to go" — was written first and measured wrong on a real catalogue
 * page, in two separate ways:
 *
 *   - Right-to-left text is right-ALIGNED inside its box, so a short Hebrew
 *     word landed most of the box's width away from the point it was asked
 *     for, and no sane tolerance could tell that from a miss.
 *   - New text that lands on an existing line's baseline is GROUPED with it,
 *     so the page gains no line at all and there is no new box to be near.
 *
 * A diff handles both without a tolerance to tune. A merged line still counts
 * as new, because its text changed — and selecting it is right: it is the
 * line that now holds what was added.
 *
 * Returns -1 when the answer is ambiguous rather than guessing, since
 * selecting the wrong box would be worse than selecting none.
 */
export function addedLineIndex(
  before: readonly { text: string; bbox: Box }[],
  after: readonly { text: string; bbox: Box }[],
  insertedText: string,
): number {
  // Rounded, because a line that was not touched is re-listed with exactly
  // the same geometry; this only has to survive float formatting.
  const key = (l: { text: string; bbox: Box }) =>
    `${l.text}@${Math.round(l.bbox.left)},${Math.round(l.bbox.bottom)}`

  // A multiset: two identical captions in different places are different
  // lines, and consuming one must not consume the other.
  const remaining = new Map<string, number>()
  for (const line of before) {
    const k = key(line)
    remaining.set(k, (remaining.get(k) ?? 0) + 1)
  }

  const candidates: number[] = []
  for (let i = 0; i < after.length; i++) {
    const k = key(after[i])
    const count = remaining.get(k) ?? 0
    if (count > 0) remaining.set(k, count - 1)
    else candidates.push(i)
  }

  if (candidates.length === 0) return -1
  if (candidates.length === 1) return candidates[0]

  // Several lines changed — text long enough to wrap produces one line per
  // wrapped row. Prefer the one that actually contains what was inserted, and
  // failing that the FIRST, which is the top of the block that was added.
  const wanted = insertedText.trim()
  const reversed = [...wanted].reverse().join("")
  const holding = candidates.filter((i) => {
    const text = after[i].text
    // PDFium extracts right-to-left runs in visual order, so a Hebrew value
    // comes back reversed. Both readings count as holding it.
    return text.includes(wanted) || text.includes(reversed)
  })
  return holding.length > 0 ? holding[0] : candidates[0]
}
