/**
 * Zooming with the wheel, pinned to the pointer.
 *
 * Two separate things live here, both pure, both apart from the components
 * so they can be checked against exact numbers.
 *
 * ── Why pinned to the pointer ──
 * Our zoom used to grow the page from its top-left corner, so whatever you
 * were looking at slid off the screen and had to be chased with the
 * scrollbars. Every real viewer instead keeps the point under the cursor
 * STILL and grows everything else away from it: you point at the 6pt caption
 * you cannot read, roll the wheel, and it gets bigger exactly where it
 * already was. That is the whole of the difference in feel, and it is four
 * lines of arithmetic.
 *
 * ── Why the gesture cannot simply set a new width ──
 * The width a page is drawn at reaches every slot on it, because a caption's
 * box is placed by multiplying its PDF coordinates by the current scale.
 * Measured on a real 14-page catalogue (1,401 slots), one width change costs
 * about 144ms — nine frames. A wheel fires around twenty times a second, so
 * driving the layout from it directly would be a slideshow.
 *
 * So a gesture only ever changes a CSS transform, which the compositor
 * applies without laying anything out or asking React for a thing. The
 * bitmap already on screen is stretched, which is momentarily soft, and the
 * real width is committed once the wheel stops — one 144ms render instead of
 * one per event. Rolling feels weightless; letting go snaps it sharp.
 */

/** Pixels a "line" of wheel delta is worth, for mice that report lines
 * rather than pixels (deltaMode 1). Firefox does this. */
const WHEEL_LINE_PX = 16
/** ...and a "page" (deltaMode 2), which some remote desktops send. */
const WHEEL_PAGE_PX = 400

/**
 * How hard the wheel bites.
 *
 * Exponential rather than additive so zooming feels the same at every size:
 * a notch takes you from 100% to 120%, and from 200% to 240%, instead of
 * crawling when you are zoomed in and lurching when you are zoomed out.
 *
 * Chrome sends 100 per notch on Windows, so a notch is e^0.18 ≈ 1.2x. That
 * is the step Figma and Google Maps use, and it takes about four notches to
 * double — fine enough to land on the size you actually want, which was the
 * complaint about our fixed 25/50/75/100 stops.
 */
const WHEEL_SENSITIVITY = 0.0018

/**
 * The most one event may be worth, in wheel pixels.
 *
 * A free-spinning wheel or an over-eager trackpad can deliver a single event
 * of several thousand, which without this would cross the entire zoom range
 * in one flick and leave the user lost.
 */
const MAX_WHEEL_PX = 240

/** How much to multiply the zoom by for one wheel event. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1
    ? deltaY * WHEEL_LINE_PX
    : deltaMode === 2
      ? deltaY * WHEEL_PAGE_PX
      : deltaY
  const clamped = Math.max(-MAX_WHEEL_PX, Math.min(MAX_WHEEL_PX, px))
  // Negative delta is a roll AWAY from the user, which everywhere means
  // "closer", so the sign is flipped.
  return Math.exp(-clamped * WHEEL_SENSITIVITY)
}

export interface Point {
  x: number
  y: number
}

export interface AnchoredZoomInput {
  /** Where the scroll container is scrolled to, before the change. */
  scrollLeft: number
  scrollTop: number
  /** The pointer, measured from the container's own top-left corner —
   * `event.clientX - container.getBoundingClientRect().left`. */
  pointerX: number
  pointerY: number
  /**
   * Where the scaling content STARTS inside the scrollable area, before and
   * after the change, measured from the scroll origin.
   *
   * Two of them rather than one because this offset is not constant. It is
   * the container's padding plus however far the content is indented to
   * keep it centred, and a page narrower than the window is centred by a
   * margin that shrinks as the page grows. Treating that as fixed leaves
   * the anchor drifting by half the change on every step — the error is
   * invisible at first and unmistakable after ten.
   */
  originBefore: Point
  originAfter: Point
  /** How much the content is growing: 2 doubles it, 0.5 halves it. */
  ratio: number
}

/**
 * Where to scroll to so the point under the pointer does not move.
 *
 * The whole idea in one line: work out how far the pointer is into the
 * content, multiply that distance by the growth, and scroll by the
 * difference. Everything else is the padding correction.
 *
 * Returned unclamped. The browser clamps assignments to scrollLeft and
 * scrollTop by itself, and clamping here as well would only hide the fact
 * that at the edges of a document the anchor CANNOT hold — there is no
 * scroll left to give.
 */
export function anchoredScroll(input: AnchoredZoomInput): {
  scrollLeft: number
  scrollTop: number
} {
  const {
    scrollLeft, scrollTop, pointerX, pointerY, originBefore, originAfter, ratio,
  } = input
  // How far into the scaling content the pointer is, before the change.
  const intoContentX = scrollLeft + pointerX - originBefore.x
  const intoContentY = scrollTop + pointerY - originBefore.y
  // That distance grows by `ratio`; scroll by whatever keeps the pointer
  // over the same place.
  return {
    scrollLeft: originAfter.x + intoContentX * ratio - pointerX,
    scrollTop: originAfter.y + intoContentY * ratio - pointerY,
  }
}

/**
 * How a preview at `scale` is laid out inside the scroll container.
 *
 * The content is scaled by a transform, which changes nothing about layout,
 * so both the scrollable extent and the centring have to be worked out here
 * and applied by hand. Kept as one function, apart from the component, so
 * the preview and the real layout that replaces it are guaranteed to agree
 * — if they disagree the document visibly jumps the moment the wheel stops.
 */
export function previewLayout(
  naturalWidth: number, naturalHeight: number, scale: number, containerWidth: number,
): { trackWidth: number; trackHeight: number; offsetX: number } {
  const visualWidth = naturalWidth * scale
  // At least the width of the window, exactly as the real layout does, so a
  // page smaller than the window still has the window's width to sit in.
  const trackWidth = Math.max(containerWidth, visualWidth)
  return {
    trackWidth,
    trackHeight: naturalHeight * scale,
    // The real layout centres the content with automatic margins. A
    // transform ignores margins, so the same centring is done explicitly.
    offsetX: (trackWidth - visualWidth) / 2,
  }
}

/**
 * How long after the last wheel event to commit the real width.
 *
 * Short enough that letting go feels like it snaps sharp immediately, long
 * enough that the pause between two rolls of the same gesture does not
 * trigger a 144ms render in the middle of it.
 */
export const ZOOM_SETTLE_MS = 160
