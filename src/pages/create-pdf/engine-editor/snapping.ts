import type { BoxRectPx } from "./useBoxTransform"

/**
 * Making things line up.
 *
 * Two features that are really one: while you drag, a box nudges into
 * alignment with what is already on the page, and a thin line appears showing
 * what it lined up with. Separating them would mean two sets of arithmetic
 * that have to agree about what "aligned" means, and they would drift.
 *
 * Everything here is in CSS pixels, in the page's own coordinate space — the
 * same space the slots are laid out in. Doing it in PDF points instead would
 * mean the tolerance below changing size as you zoom, so a nudge that felt
 * right at 100% would be unusably sticky at 400%.
 */

/** How close an edge must come, in CSS px, before it snaps.
 *
 * Small enough that you can still place something deliberately a few pixels
 * off; large enough that you do not have to be accurate to the pixel, which
 * is the entire point. */
const SNAP_TOLERANCE_PX = 6

export type GuideAxis = "x" | "y"

export interface SnapGuide {
  axis: GuideAxis
  /** Where the line sits, CSS px from the page's top-left. */
  at: number
  /** How far along the other axis the line should be drawn, so it reaches
   * from the moving box to whatever it aligned with rather than crossing the
   * whole page. A line spanning the page is noise; a line joining two things
   * says which two. */
  from: number
  to: number
}

export interface SnapTarget {
  /** The three interesting positions on each axis: both edges and the middle. */
  left: number
  right: number
  top: number
  bottom: number
}

export interface SnapResult {
  rect: BoxRectPx
  guides: SnapGuide[]
}

/** Which edges of the moving box a gesture is allowed to move. A corner
 * resize moves two; a whole-box drag moves all four together. */
export interface FreeEdges {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
  /** True for a move: the box keeps its size, so snapping one edge shifts
   * the whole thing rather than stretching it. */
  rigid: boolean
}

export const MOVE_EDGES: FreeEdges = { left: true, right: true, top: true, bottom: true, rigid: true }

export function edgesForHandle(handle: "nw" | "ne" | "sw" | "se"): FreeEdges {
  return {
    left: handle === "nw" || handle === "sw",
    right: handle === "ne" || handle === "se",
    top: handle === "nw" || handle === "ne",
    bottom: handle === "sw" || handle === "se",
    rigid: false,
  }
}

/**
 * The lines worth snapping to on a page.
 *
 * The page's own edges and centre, plus every other object's edges and
 * centre. The object being dragged is left out by the caller — a box that
 * snapped to itself would never move.
 */
export function buildSnapTargets(
  pageWidth: number, pageHeight: number, others: readonly SnapTarget[],
): { xs: number[]; ys: number[]; boxes: readonly SnapTarget[] } {
  const xs = [0, pageWidth / 2, pageWidth]
  const ys = [0, pageHeight / 2, pageHeight]
  for (const box of others) {
    xs.push(box.left, (box.left + box.right) / 2, box.right)
    ys.push(box.top, (box.top + box.bottom) / 2, box.bottom)
  }
  return { xs, ys, boxes: others }
}

/** The nearest candidate within tolerance, or null. */
function nearest(value: number, candidates: readonly number[]): { at: number; delta: number } | null {
  let best: { at: number; delta: number } | null = null
  for (const candidate of candidates) {
    const delta = candidate - value
    if (Math.abs(delta) > SNAP_TOLERANCE_PX) continue
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { at: candidate, delta }
  }
  return best
}

/**
 * Nudges a rectangle into alignment and says what it aligned with.
 *
 * Each axis is decided independently and only ONCE: the closest of the box's
 * three positions on that axis wins. Applying every match would fight itself
 * — the left edge pulling one way and the centre another — and the box would
 * jitter between them as the pointer moved.
 */
export function snapRect(
  rect: BoxRectPx,
  targets: { xs: number[]; ys: number[]; boxes: readonly SnapTarget[] },
  edges: FreeEdges,
): SnapResult {
  const guides: SnapGuide[] = []
  let { left, top, width, height } = rect

  // ── horizontal ──
  const xCandidates: { value: number; apply: (delta: number) => void }[] = []
  if (edges.left) {
    xCandidates.push({
      value: left,
      apply: (d) => { if (edges.rigid) left += d; else { left += d; width -= d } },
    })
  }
  if (edges.right) {
    xCandidates.push({
      value: left + width,
      apply: (d) => { if (edges.rigid) left += d; else width += d },
    })
  }
  // The centre is only offered for a whole-box move. Snapping a centre during
  // a corner resize would move the edge you are not holding.
  if (edges.rigid) {
    xCandidates.push({ value: left + width / 2, apply: (d) => { left += d } })
  }

  let bestX: { delta: number; at: number; apply: (d: number) => void } | null = null
  for (const candidate of xCandidates) {
    const hit = nearest(candidate.value, targets.xs)
    if (!hit) continue
    if (!bestX || Math.abs(hit.delta) < Math.abs(bestX.delta)) {
      bestX = { delta: hit.delta, at: hit.at, apply: candidate.apply }
    }
  }
  if (bestX) {
    bestX.apply(bestX.delta)
    guides.push(spanGuide("x", bestX.at, { left, top, width, height }, targets.boxes))
  }

  // ── vertical ──
  const yCandidates: { value: number; apply: (delta: number) => void }[] = []
  if (edges.top) {
    yCandidates.push({
      value: top,
      apply: (d) => { if (edges.rigid) top += d; else { top += d; height -= d } },
    })
  }
  if (edges.bottom) {
    yCandidates.push({
      value: top + height,
      apply: (d) => { if (edges.rigid) top += d; else height += d },
    })
  }
  if (edges.rigid) {
    yCandidates.push({ value: top + height / 2, apply: (d) => { top += d } })
  }

  let bestY: { delta: number; at: number; apply: (d: number) => void } | null = null
  for (const candidate of yCandidates) {
    const hit = nearest(candidate.value, targets.ys)
    if (!hit) continue
    if (!bestY || Math.abs(hit.delta) < Math.abs(bestY.delta)) {
      bestY = { delta: hit.delta, at: hit.at, apply: candidate.apply }
    }
  }
  if (bestY) {
    bestY.apply(bestY.delta)
    guides.push(spanGuide("y", bestY.at, { left, top, width, height }, targets.boxes))
  }

  return { rect: { left, top, width, height }, guides }
}

/**
 * How far a guide line should reach.
 *
 * From the moving box to whatever shares that line, rather than across the
 * whole page. A full-width rule tells you something lined up; a line joining
 * two boxes tells you WHICH two, which is the question you actually have
 * while dragging.
 */
function spanGuide(
  axis: GuideAxis, at: number, rect: BoxRectPx, boxes: readonly SnapTarget[],
): SnapGuide {
  const onLine = boxes.filter((b) => axis === "x"
    ? near(b.left, at) || near(b.right, at) || near((b.left + b.right) / 2, at)
    : near(b.top, at) || near(b.bottom, at) || near((b.top + b.bottom) / 2, at))

  if (axis === "x") {
    let from = rect.top
    let to = rect.top + rect.height
    for (const b of onLine) { from = Math.min(from, b.top); to = Math.max(to, b.bottom) }
    return { axis, at, from, to }
  }
  let from = rect.left
  let to = rect.left + rect.width
  for (const b of onLine) { from = Math.min(from, b.left); to = Math.max(to, b.right) }
  return { axis, at, from, to }
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.5

/**
 * Draws the guide lines straight into a DOM element.
 *
 * Not React state, deliberately. This is called on every pointer move of a
 * drag — dozens a second — and re-rendering the page column costs about
 * 144ms on a real catalogue. The same reason the zoom gesture writes to the
 * DOM by hand.
 */
export function paintGuides(host: HTMLElement | null, guides: readonly SnapGuide[]): void {
  if (!host) return
  host.replaceChildren()
  for (const guide of guides) {
    const line = document.createElement("div")
    line.dataset.pdfSnapGuide = guide.axis
    line.style.position = "absolute"
    line.style.background = "#ec4899"
    line.style.pointerEvents = "none"
    if (guide.axis === "x") {
      line.style.left = `${guide.at}px`
      line.style.top = `${guide.from}px`
      line.style.width = "1px"
      line.style.height = `${Math.max(1, guide.to - guide.from)}px`
    } else {
      line.style.top = `${guide.at}px`
      line.style.left = `${guide.from}px`
      line.style.height = "1px"
      line.style.width = `${Math.max(1, guide.to - guide.from)}px`
    }
    host.appendChild(line)
  }
}
