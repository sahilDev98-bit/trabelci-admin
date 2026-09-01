// Ctrl + wheel zoom, driven with real wheel events.
//
// Three things have to be true at once, and each of them is a different
// kind of failure:
//
//   - the point under the pointer must not move. This is the whole feel of
//     it; zoom that grows from a corner sends what you were reading off the
//     screen and is why ours felt awkward.
//   - the gesture must not re-render the column. One width change costs
//     about 144ms on a real catalogue and a wheel fires twenty times a
//     second, so a gesture that lays out is a gesture that jams. The check
//     here loads the page with slots so a stray render would show up as
//     time.
//   - committing the real width afterwards must be invisible. The preview
//     is a stretched bitmap and the commit is a proper re-render; if the two
//     disagree by even a few pixels the document lurches the instant you
//     stop rolling, which reads as a bug even though the picture is right.
//
// Each is checked with a control that shows the check can fail, because a
// pin test passes trivially if nothing moved at all.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEngineWorkspace } from "./PdfEngineWorkspace"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"
import { ZOOM_SETTLE_MS } from "./zoomGesture"

export interface ZoomGestureTestResult {
  errors: string[]
  /** How far the point under the pointer drifted, in pixels. */
  pinDriftPx: number
  /** The same measurement with the anchoring removed — the control. */
  pinDriftWithoutAnchoringPx: number
  /** Page width before, during the preview, and after the commit. */
  widthBefore: number
  widthPreviewed: number
  widthCommitted: number
  /** Milliseconds for a burst of 10 wheel events. */
  burstMs: number
  slotsMounted: number
  /** How far the document shifted on screen when the width was committed. */
  commitSeamPx: number
  /** A plain wheel must scroll, not zoom. */
  plainWheelZoomed: boolean
  plainWheelScrolled: boolean
  /** Zoomed in past the window, both edges must be reachable. */
  leftEdgeReachable: boolean
  /** The same pin check while zooming OUT, where the page becomes narrower
   * than the window and the centring margin moves. */
  pinDriftZoomingOutPx: number
  commitSeamZoomingOutPx: number
  widthZoomedOut: number
  /** The zoom-out stopped while the page still overflowed the window, so
   * the anchor above had somewhere to move. */
  stillWiderThanWindow: boolean
  /** Zoomed out below the window there is no scroll left and pinning is
   * impossible; the page must be centred instead. */
  narrowPageOffCentrePx: number
  /** Non-zero proves the anchor was free to move, so the pin check above is
   * measuring the arithmetic and not the browser clamping at an edge. */
  scrollTopAfterZoomOut: number
  /** Zoom must stop at the renderer's limit rather than run away. */
  stoppedAtLimit: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

const PAGE = { index: 0, widthPts: 595, heightPts: 794, rotation: 0 }

/** Enough slots that a stray re-render costs real, measurable time. */
function fakeLines(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    lineIndex: i,
    text: `line ${i}`,
    pieceCount: 1,
    fontSize: 8,
    bbox: { left: 40, bottom: 700 - i * 2.4, right: 320, top: 702 - i * 2.4 },
    matrix: { a: 8, b: 0, c: 0, d: 8, e: 40, f: 700 - i * 2.4 },
    fontName: "JosefinSans-Light",
    direction: "ltr" as const,
    color: { r: 0, g: 0, b: 0, a: 255 },
    bold: false,
    italic: false,
  }))
}

function fakeDoc(pageCount: number, linesPerPage: number): UsePdfEngineDocumentResult {
  const noop = async () => {}
  const pages = Array.from({ length: pageCount }, (_, i) => ({ ...PAGE, index: i }))
  const pageText: Record<number, unknown> = {}
  const pageImages: Record<number, unknown> = {}
  const pageVectors: Record<number, unknown> = {}
  for (let i = 0; i < pageCount; i++) {
    pageText[i] = { loaded: true, lines: fakeLines(linesPerPage) }
    pageImages[i] = { loaded: true, images: [] }
    pageVectors[i] = { loaded: true, groups: [] }
  }
  return {
    phase: "ready", error: null, downloadPercent: null,
    pages, docId: "test", revision: 0, busy: false,
    pageText, pageImages, pageVectors,
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    renderPage: async () => null,
    renderPageRegion: async () => null,
    lastChange: null,
    renderCleanPatch: async () => null,
    renderImagePreview: async () => null,
    editText: noop, moveText: async () => -1, moveTextToPage: async () => -1,
    moveImageToPage: async () => -1, removeText: noop,
    replaceImage: noop, removeImage: noop, setImageRect: async () => -1,
    removeVector: noop, replaceVector: noop,
    addTextOverlay: noop, addImageOverlay: noop, applyPagePlan: noop,
    save: async () => new Blob(),
  } as unknown as UsePdfEngineDocumentResult
}

/** A wheel event the way a real mouse sends one. */
function wheel(x: number, y: number, deltaY: number, ctrl: boolean): WheelEvent {
  return new WheelEvent("wheel", {
    bubbles: true, cancelable: true,
    clientX: x, clientY: y, deltaY, deltaMode: 0, ctrlKey: ctrl,
  })
}

export async function runZoomGestureSelfTest(): Promise<ZoomGestureTestResult> {
  const out: ZoomGestureTestResult = {
    errors: [],
    pinDriftPx: 0, pinDriftWithoutAnchoringPx: 0,
    widthBefore: 0, widthPreviewed: 0, widthCommitted: 0,
    burstMs: 0, slotsMounted: 0, commitSeamPx: 0,
    plainWheelZoomed: false, plainWheelScrolled: false,
    leftEdgeReachable: false, stoppedAtLimit: false,
    pinDriftZoomingOutPx: 0, commitSeamZoomingOutPx: 0, widthZoomedOut: 0,
    scrollTopAfterZoomOut: 0, stillWiderThanWindow: false, narrowPageOffCentrePx: 0,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    const doc = fakeDoc(6, 180)
    const column = {
      contentMode: "text" as const,
      selection: null,
      onSelect: () => {},
      drag: null,
      onMoveStart: () => {},
      originPatch: null,
      imagePreview: null,
      onEditLine: () => {},
      onReplaceImage: () => {},
      onReplaceVector: () => {},
      onDropOnImage: () => {},
      onDropOnPage: () => {},
      onTransformImage: () => {},
      onTransformVector: () => {},
      onResizeText: () => {},
    }
    const toolbar = {
      contentMode: "text" as const,
      onToggleContentMode: () => {},
      onAddText: () => {},
      onAddImage: () => {},
      onOpenOrganizer: () => {},
      onEditSelectedText: () => {},
      onReplaceSelectedImage: () => {},
      onReplaceSelectedVector: () => {},
      onDeleteSelected: () => {},
      onStyleSelectedText: () => {},
      onScaleSelectedText: () => {},
      onAlignSelectedText: () => {},
      onTransformSelectedImage: () => {},
    }

    root.render(createElement(PdfEngineWorkspace, {
      doc,
      documentName: "test.pdf",
      onExit: () => {},
      thumbnailRailOpen: true,
    onDisplayWidthChange: () => {},
      column: column as never,
      toolbar: toolbar as never,
      selection: null,
    }))
    await wait(700)

    const scroller = host.querySelector<HTMLElement>("[data-pdf-workspace] .overflow-auto")
    const pageEl = () => host.querySelector<HTMLElement>('[data-engine-page-index="0"]')
    if (!scroller || !pageEl()) {
      out.errors.push("the full-screen shell did not mount")
      return out
    }
    out.slotsMounted = host.querySelectorAll("[data-engine-page-index] > *").length

    // Scrolled off the very top, so the anchor has room to move in both
    // directions — at the top of a document it physically cannot hold.
    scroller.scrollTop = 300
    await frame()

    const box = scroller.getBoundingClientRect()
    const pointer = { x: box.left + box.width / 2, y: box.top + box.height / 2 }

    // ── the pin: where is the pointer within page 0, before and after? ──
    const before = pageEl()!.getBoundingClientRect()
    out.widthBefore = Math.round(before.width)
    const fractionX = (pointer.x - before.left) / before.width
    const fractionY = (pointer.y - before.top) / before.height

    const start = performance.now()
    for (let i = 0; i < 10; i++) {
      scroller.dispatchEvent(wheel(pointer.x, pointer.y, -100, true))
    }
    out.burstMs = Math.round(performance.now() - start)
    await frame()

    const previewed = pageEl()!.getBoundingClientRect()
    out.widthPreviewed = Math.round(previewed.width)
    // Where the material point that WAS under the pointer sits now.
    const nowX = previewed.left + fractionX * previewed.width
    const nowY = previewed.top + fractionY * previewed.height
    out.pinDriftPx = Math.round(Math.hypot(nowX - pointer.x, nowY - pointer.y))

    // The control: where that same point would have landed if the scroll had
    // NOT been compensated, which is exactly what the old zoom did. If this
    // also comes out on the pointer, the pin test is measuring nothing and
    // would pass against a broken implementation.
    const ratio = previewed.height / before.height
    const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0
    const intoContent = pointer.y - box.top + 300 - padTop
    const unanchoredY = box.top + padTop + intoContent * ratio - 300
    out.pinDriftWithoutAnchoringPx = Math.round(Math.abs(unanchoredY - pointer.y))

    // ── the commit must be invisible ──
    const justBefore = pageEl()!.getBoundingClientRect()
    await wait(ZOOM_SETTLE_MS + 500)
    const justAfter = pageEl()!.getBoundingClientRect()
    out.widthCommitted = Math.round(justAfter.width)
    out.commitSeamPx = Math.round(
      Math.max(Math.abs(justAfter.top - justBefore.top), Math.abs(justAfter.left - justBefore.left)),
    )

    // ── zoomed past the window, the left edge must still be reachable ──
    if (justAfter.width > box.width) {
      scroller.scrollLeft = 0
      await frame()
      out.leftEdgeReachable = pageEl()!.getBoundingClientRect().left >= box.left - 1
    } else {
      out.errors.push("the page never grew past the window, so edge reach is untested")
    }

    // ── zooming OUT, while there is still room to anchor ──
    // Its own case because a page narrower than the window is centred, and
    // that centring margin grows as the page shrinks; treating the content
    // as starting at a fixed offset drifts the anchor by half of it.
    // Started from the MIDDLE of the document, and stopped while the page is
    // still WIDER than the window — past that point the document has no
    // scroll left to give on either axis and the anchor cannot hold, which
    // would make this a test of the browser's clamping rather than of the
    // arithmetic.
    scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2)
    scroller.scrollLeft = Math.round((scroller.scrollWidth - scroller.clientWidth) / 2)
    await frame()
    const outBox = scroller.getBoundingClientRect()
    const outPointer = { x: outBox.left + outBox.width / 2, y: outBox.top + outBox.height / 3 }
    // Whichever page is actually under the pointer, which mid-document is
    // not page 0 — measuring a page that is off screen would compare two
    // positions neither of which the reader can see.
    const underPointer = document.elementsFromPoint(outPointer.x, outPointer.y)
      .map((el) => el.closest<HTMLElement>("[data-engine-page-index]"))
      .find((el): el is HTMLElement => el !== null)
    if (!underPointer) {
      out.errors.push("no page under the pointer to measure the zoom-out against")
      return out
    }
    const beforeOut = underPointer.getBoundingClientRect()
    const outFx = (outPointer.x - beforeOut.left) / beforeOut.width
    const outFy = (outPointer.y - beforeOut.top) / beforeOut.height
    for (let i = 0; i < 3; i++) {
      scroller.dispatchEvent(wheel(outPointer.x, outPointer.y, 100, true))
    }
    await frame()
    out.scrollTopAfterZoomOut = Math.round(scroller.scrollTop)
    const afterOut = underPointer.getBoundingClientRect()
    out.widthZoomedOut = Math.round(afterOut.width)
    out.stillWiderThanWindow = afterOut.width > scroller.clientWidth
    out.pinDriftZoomingOutPx = Math.round(Math.hypot(
      afterOut.left + outFx * afterOut.width - outPointer.x,
      afterOut.top + outFy * afterOut.height - outPointer.y,
    ))
    const seamBeforeOut = underPointer.getBoundingClientRect()
    await wait(ZOOM_SETTLE_MS + 500)
    const seamAfterOut = underPointer.getBoundingClientRect()
    out.commitSeamZoomingOutPx = Math.round(Math.max(
      Math.abs(seamAfterOut.top - seamBeforeOut.top),
      Math.abs(seamAfterOut.left - seamBeforeOut.left),
    ))

    // ── zoomed out BELOW the window, the page must sit in the middle ──
    // Horizontal pinning is impossible here and should not be attempted:
    // there is no scroll left, so the only right answer is the one the
    // committed layout gives, which is centred.
    for (let i = 0; i < 8; i++) {
      scroller.dispatchEvent(wheel(outPointer.x, outPointer.y, 100, true))
    }
    await wait(ZOOM_SETTLE_MS + 500)
    const small = underPointer.getBoundingClientRect()
    const smallBox = scroller.getBoundingClientRect()
    out.narrowPageOffCentrePx = Math.round(Math.abs(
      (small.left + small.width / 2) - (smallBox.left + smallBox.width / 2),
    ))

    // ── a plain wheel scrolls, it does not zoom ──
    const widthBeforePlain = pageEl()!.getBoundingClientRect().width
    const scrollBeforePlain = scroller.scrollTop
    const plain = wheel(pointer.x, pointer.y, 120, false)
    scroller.dispatchEvent(plain)
    // jsdom-free browsers do not scroll from a synthetic wheel, so the real
    // assertion is that it was NOT consumed as a zoom.
    await wait(ZOOM_SETTLE_MS + 300)
    out.plainWheelZoomed =
      Math.abs(pageEl()!.getBoundingClientRect().width - widthBeforePlain) > 1
    out.plainWheelScrolled = !plain.defaultPrevented
    void scrollBeforePlain

    // ── and it must stop at the renderer's limit ──
    for (let i = 0; i < 60; i++) {
      scroller.dispatchEvent(wheel(pointer.x, pointer.y, -240, true))
    }
    await wait(ZOOM_SETTLE_MS + 700)
    const atLimit = pageEl()!.getBoundingClientRect().width
    // 400% of a 595pt page is 595 * (96/72) * 4 ≈ 3173px.
    out.stoppedAtLimit = atLimit <= 3200

    // ---- verdicts ----
    if (out.pinDriftPx > 4) {
      out.errors.push(
        `the point under the pointer drifted ${out.pinDriftPx}px — zoom is not pinned to the cursor`)
    }
    if (out.pinDriftWithoutAnchoringPx <= 10) {
      out.errors.push(
        "the control drifted too little, so the pin test would pass even without anchoring")
    }
    if (out.widthPreviewed <= out.widthBefore) {
      out.errors.push("rolling the wheel did not make the page bigger")
    }
    if (out.burstMs > 120) {
      out.errors.push(
        `10 wheel events took ${out.burstMs}ms — the gesture is laying the column out`)
    }
    if (out.slotsMounted < 500) {
      out.errors.push(
        `only ${out.slotsMounted} slots mounted — too few for the timing to mean anything`)
    }
    if (out.commitSeamPx > 4) {
      out.errors.push(
        `the document jumped ${out.commitSeamPx}px when the width was committed`)
    }
    if (Math.abs(out.widthCommitted - out.widthPreviewed) > 4) {
      out.errors.push(
        `committed width ${out.widthCommitted}px does not match the preview ${out.widthPreviewed}px`)
    }
    if (out.widthZoomedOut >= out.widthCommitted) {
      out.errors.push("rolling the other way did not make the page smaller")
    }
    if (out.scrollTopAfterZoomOut <= 0) {
      out.errors.push(
        "zooming out ran to the top of the document, so the pin there proves nothing")
    }
    if (!out.stillWiderThanWindow) {
      out.errors.push(
        "the zoom-out went past the window's width, where anchoring is impossible"
        + " — that case proves nothing about the arithmetic")
    }
    if (out.pinDriftZoomingOutPx > 4) {
      out.errors.push(
        `zooming out, the point under the pointer drifted ${out.pinDriftZoomingOutPx}px`)
    }
    if (out.narrowPageOffCentrePx > 4) {
      out.errors.push(
        `zoomed out below the window, the page sits ${out.narrowPageOffCentrePx}px off centre`)
    }
    if (out.commitSeamZoomingOutPx > 4) {
      out.errors.push(
        `zooming out, the document jumped ${out.commitSeamZoomingOutPx}px when committed`)
    }
    if (out.plainWheelZoomed) out.errors.push("a plain wheel zoomed instead of scrolling")
    if (!out.plainWheelScrolled) {
      out.errors.push("a plain wheel was swallowed — the document cannot be scrolled")
    }
    if (!out.leftEdgeReachable) {
      out.errors.push("zoomed in, the left edge of the page cannot be scrolled to")
    }
    if (!out.stoppedAtLimit) {
      out.errors.push(`zoom ran past its limit to ${Math.round(atLimit)}px`)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
