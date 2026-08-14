import type { EngineTextLine, EnginePage } from "@/lib/pdf-engine"
import type { CrossPageDrop } from "./useCrossPageDrag"

/**
 * Turning "the box was released here on screen" into PDF coordinates.
 *
 * Pulled out of the editor component as pure functions because this is
 * where cross-page dragging can go subtly wrong in ways a click-through
 * never reveals: a line can land on the right page but a few points high,
 * or a Hebrew line can land a whole line-width to the side, and both still
 * look plausible until measured. Pure functions can be checked against
 * exact expected numbers.
 *
 * Two conventions collide here and every function below exists to bridge
 * them:
 *   - the screen measures y DOWNWARD from the top of the page;
 *   - PDF measures y UPWARD from the bottom.
 */

/** Where a drop landed, in the target page's PDF points, measured from its
 * top-left the way a person describes a position. */
export function dropToPagePoints(
  drop: Pick<CrossPageDrop, "leftPx" | "topPx" | "widthPx" | "heightPx">,
  scale: number,
): { xPts: number; yFromTopPts: number; widthPts: number; heightPts: number } {
  return {
    xPts: drop.leftPx / scale,
    yFromTopPts: drop.topPx / scale,
    widthPts: drop.widthPx / scale,
    heightPts: drop.heightPx / scale,
  }
}

/** A text line dropped back on its OWN page: a plain translation, in PDF
 * points, with dy positive meaning UP the page. */
export function textMoveDelta(
  line: Pick<EngineTextLine, "bbox">,
  page: Pick<EnginePage, "heightPts">,
  xPts: number,
  yFromTopPts: number,
): { dx: number; dy: number } {
  return {
    dx: xPts - line.bbox.left,
    dy: (page.heightPts - yFromTopPts) - line.bbox.top,
  }
}

/**
 * A text line dropped on a DIFFERENT page.
 *
 * The engine places a line by its anchor's origin — the text baseline —
 * not by the box the user was dragging. Both offsets are carried over from
 * the original so the glyphs sit inside the dropped box exactly as they
 * did before: the horizontal side bearing between the box's left edge and
 * the anchor's origin, and the vertical distance from the box's top down
 * to the baseline.
 *
 * Taking the offsets from the line itself, rather than assuming the origin
 * is the box corner, is also what makes RTL work: grouping anchors a
 * Hebrew line on its RIGHTMOST piece, so `matrix.e - bbox.left` is nearly
 * the full line width there, and assuming zero would drop every Hebrew
 * line a line-width away from where it was released.
 */
export function textPlacementOnPage(
  line: Pick<EngineTextLine, "bbox" | "matrix">,
  targetPage: Pick<EnginePage, "heightPts">,
  xPts: number,
  yFromTopPts: number,
): { x: number; yBaseline: number } {
  const anchorInsetX = line.matrix.e - line.bbox.left
  const baselineFromTop = line.bbox.top - line.matrix.f
  return {
    x: xPts + anchorInsetX,
    yBaseline: targetPage.heightPts - yFromTopPts - baselineFromTop,
  }
}

/** An image dropped anywhere: a rect in PDF points whose y is the BOTTOM
 * edge, measured up from the bottom of the page. */
export function imagePlacement(
  targetPage: Pick<EnginePage, "heightPts">,
  xPts: number,
  yFromTopPts: number,
  widthPts: number,
  heightPts: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: xPts,
    y: targetPage.heightPts - yFromTopPts - heightPts,
    width: widthPts,
    height: heightPts,
  }
}
