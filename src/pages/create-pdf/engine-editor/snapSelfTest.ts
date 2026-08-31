// Does dragging actually line things up — and does it let go when it should?
//
// Snapping is pure arithmetic, so it is checked as arithmetic, against exact
// numbers rather than against how it feels. Four claims:
//
//   1. A box released NEAR another box's edge lands EXACTLY on it, and a
//      guide line appears saying so.
//   2. A box released far from anything is left exactly where it was put.
//      This is the control for all of the above: a snap that pulls
//      everything is not alignment, it is a magnet, and every "it snapped"
//      result below would be meaningless without it.
//   3. Only ONE line per axis wins. The obvious implementation applies every
//      match it finds, so the left edge pulls one way while the centre pulls
//      another and the box jitters between them as the pointer moves.
//   4. A corner resize moves only the edges being dragged. Snapping the
//      centre during a resize would move the corner the user is NOT holding,
//      which looks like the box fighting back.
import {
  buildSnapTargets, edgesForHandle, MOVE_EDGES, snapRect, paintGuides,
  type SnapTarget,
} from "./snapping"

export interface SnapTestResult {
  errors: string[]
  snappedLeft: number
  guidesWhenSnapped: number
  unsnappedLeft: number
  guidesWhenFar: number
  guidesPerAxis: number
  resizeMovedFarEdge: boolean
  resizeSnappedNearEdge: number
  guideLinesDrawn: number
}

/** A page with one box on it, 100 wide starting at x=100. */
const PAGE = { width: 600, height: 800 }
const OTHER: SnapTarget = { left: 100, top: 200, right: 200, bottom: 300 }

export function runSnapSelfTest(): SnapTestResult {
  const out: SnapTestResult = {
    errors: [], snappedLeft: 0, guidesWhenSnapped: 0, unsnappedLeft: 0,
    guidesWhenFar: 0, guidesPerAxis: 0, resizeMovedFarEdge: false,
    resizeSnappedNearEdge: 0, guideLinesDrawn: 0,
  }
  const targets = buildSnapTargets(PAGE.width, PAGE.height, [OTHER])

  // ── 1. Near enough: it lands exactly on the line ─────────────────────
  // Left edge at 103, three away from the other box's left edge at 100.
  const near = snapRect(
    { left: 103, top: 500, width: 80, height: 40 }, targets, MOVE_EDGES)
  out.snappedLeft = near.rect.left
  out.guidesWhenSnapped = near.guides.length
  if (near.rect.left !== 100) {
    out.errors.push(`released at 103 near an edge at 100, landed at ${near.rect.left}`)
  }
  if (near.guides.length === 0) {
    out.errors.push("it snapped but drew no guide, so nothing tells the user why")
  }
  // A rigid move must keep its size — snapping an edge shifts the box, it
  // does not stretch it.
  if (near.rect.width !== 80) {
    out.errors.push(`a move changed the width to ${near.rect.width}, expected 80`)
  }

  // ── 2. The control: far from anything, nothing moves ─────────────────
  const far = snapRect(
    { left: 340, top: 500, width: 80, height: 40 }, targets, MOVE_EDGES)
  out.unsnappedLeft = far.rect.left
  out.guidesWhenFar = far.guides.length
  if (far.rect.left !== 340) {
    out.errors.push(
      `a box released at 340, far from anything, was moved to ${far.rect.left}`
      + " — snapping is pulling everything, which makes every other check here meaningless")
  }
  if (far.guides.length !== 0) {
    out.errors.push(`${far.guides.length} guides drawn when nothing was in range`)
  }

  // ── 3. One line per axis ─────────────────────────────────────────────
  // Placed where the left edge AND the centre are both within tolerance of
  // something: 98 puts the left edge 2 from 100, and with width 204 the
  // centre lands at 200 — the other box's right edge.
  const crowded = snapRect(
    { left: 98, top: 500, width: 204, height: 40 }, targets, MOVE_EDGES)
  out.guidesPerAxis = crowded.guides.filter((g) => g.axis === "x").length
  if (out.guidesPerAxis > 1) {
    out.errors.push(
      `${out.guidesPerAxis} vertical guides at once — two matches are fighting`
      + " and the box will jitter between them")
  }

  // ── 4. A resize moves only the edges being dragged ───────────────────
  // Dragging the NE corner: the right and top edges move, left and bottom
  // stay pinned. The right edge starts at 303, three from the page centre.
  const before = { left: 20, top: 500, width: 283, height: 40 }
  const resized = snapRect(before, targets, edgesForHandle("ne"))
  out.resizeSnappedNearEdge = resized.rect.left + resized.rect.width
  out.resizeMovedFarEdge = resized.rect.left !== before.left
  if (out.resizeSnappedNearEdge !== 300) {
    out.errors.push(
      `the dragged edge was at 303, three from the page centre at 300,`
      + ` and ended at ${out.resizeSnappedNearEdge}`)
  }
  if (out.resizeMovedFarEdge) {
    out.errors.push("a corner resize moved the edge that was not being dragged")
  }

  // ── The guides actually reach the DOM ────────────────────────────────
  const host = document.createElement("div")
  document.body.appendChild(host)
  try {
    paintGuides(host, near.guides)
    out.guideLinesDrawn = host.querySelectorAll("[data-pdf-snap-guide]").length
    if (out.guideLinesDrawn !== near.guides.length) {
      out.errors.push(
        `${near.guides.length} guides but ${out.guideLinesDrawn} lines drawn`)
    }
    // And they are cleared again, or the last drag's lines stay on the page.
    paintGuides(host, [])
    if (host.querySelectorAll("[data-pdf-snap-guide]").length !== 0) {
      out.errors.push("guides are not cleared when a gesture ends")
    }
  } finally {
    host.remove()
  }

  return out
}
