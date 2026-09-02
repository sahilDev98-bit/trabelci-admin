/**
 * Dev-only self test for the editor's pointer behaviour: file drag-and-drop
 * onto pages and slots, selection, resize, and — the reason this file grew a
 * second half — dragging a slot from one page to ANOTHER page.
 *
 * Lives in src/ (rather than as a test fixture) for two reasons: Vite
 * resolves its React/component imports the same way the real app does, and
 * it type-checks against the component's real props on every build, so a
 * prop rename cannot leave a silently-stale test behind. Nothing in the app
 * imports it, so it never reaches a production bundle.
 *
 * It fires genuine DragEvents and PointerEvents rather than calling the
 * handlers directly — the point is to prove the browser actually delivers
 * the gesture through the components' handlers, which a direct call would
 * not establish. That has already caught three bugs a type-checker could
 * not see.
 *
 * Driven by scripts/pdf-engine-dragdrop-test.mjs.
 */
import { createElement, useState } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePage } from "./PdfEnginePage"
import { useCrossPageDrag, type CrossPageDrop } from "./useCrossPageDrag"
import { CrossPageDragGhost } from "./CrossPageDragGhost"

export interface DragDropTestResult {
  errors: string[]
  slotRendered: boolean
  slotHighlighted: boolean
  droppedOnImage: { pageIndex: number; imageIndex: number; fileName: string } | null
  droppedOnPage: { pageIndex: number; fileName: string; xPts: number; yFromTopPts: number } | null
  ignoredNonFileDrag: boolean
  /** Handles only appear once a slot is selected. */
  handlesHiddenUntilSelected: boolean
  handlesShownWhenSelected: boolean
  /** Result of dragging its south-east corner. */
  resizedTo: { x: number; y: number; width: number; height: number } | null
  /** Selecting must not raise a floating panel over the artwork. */
  noToolbarOnSelect: boolean
  /** A selected image slot must offer no buttons at all — no toolbar and no
   * delete button. Deleting is the keyboard, as it is for text. */
  noButtonsOnImageSlot: boolean
}

/** Cross-page results are gathered separately: they need a two-page,
 * scrollable harness that the single-page checks above do not. */
export interface CrossPageTestResult {
  errors: string[]
  /** A drag that stays put reports its own page. */
  sameGhostAppears: boolean
  /** Drop reported after dragging from page 0 down onto page 1. */
  crossDrop: CrossPageDrop | null
  /** Drop reported by a drag that ended back on its starting page. */
  samePageDrop: CrossPageDrop | null
  /** The page under the cursor is marked as the target. */
  targetPageHighlighted: boolean
  /** Holding near the bottom edge scrolled the document by itself. */
  autoScrolledBy: number
  /** While auto-scrolling with a STATIONARY pointer, the target page must
   * still update as pages slide past. */
  retargetedDuringAutoScroll: boolean
  /** Escape abandons a drag without reporting a drop. */
  escapeCancelled: boolean
  /** The page width the drop reported, and the width that page is actually
   * drawn at. They must match: converting a drop with a width from
   * somewhere else is what made every drop land ~1.8x too far once the
   * expanded view drew pages at a zoom. */
  reportedPageWidth: number | null
  actualPageWidth: number | null
  /** Distance reported for a plain CLICK on an already-selected box. The
   * editor uses this to tell a click from a move; if it is not ~0 a click
   * would commit a move and clear the selection. */
  clickTravelledPx: number | null
  /** Distance reported for a real drag, so the two are distinguishable. */
  dragTravelledPx: number | null
  /** Text drags show the WORDS, drawn — never a crop, which would bring the
   * artwork behind them along. */
  textGhostShowsWords: boolean
  textGhostHasNoCrop: boolean
  /** Image drags show the image's own pixels, sampled back out of the crop. */
  imageGhostHasCrop: boolean
  imageGhostColour: string | null
  /** The original must be COVERED while in flight, or the drag reads as a
   * copy rather than a move. */
  originCoveredWhileDragging: boolean
  /** Raw geometry captured at each step, for diagnosing a failure without
   * having to re-run with guesses. */
  debug: Record<string, unknown>
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function pointerEvent(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1, isPrimary: true })
}

function dragEvent(type: string, file: File | null, clientX = 0, clientY = 0): DragEvent {
  const dataTransfer = new DataTransfer()
  if (file) dataTransfer.items.add(file)
  return new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX, clientY })
}

/** The fixture line, shared by both harnesses. A 1:1 page (600pt shown at
 * 600px) keeps PDF points and CSS pixels the same number, so a coordinate
 * error shows up directly instead of being masked by a scale factor. */
const FIXTURE_LINE = {
  lineIndex: 0,
  text: "Carnaby",
  pieceCount: 1,
  fontSize: 40,
  // 200x50pt at (50,300)-(250,350) -> 200x50px at left 50, top 450.
  bbox: { left: 50, bottom: 300, right: 250, top: 350 },
  matrix: { a: 40, b: 0, c: 0, d: 40, e: 50, f: 300 },
  fontName: "JosefinSans-Light",
  direction: "ltr" as const,
  color: { r: 0, g: 0, b: 0, a: 255 },
  bold: false,
  italic: false,
}

/** Stands in for "the image rendered on its own". A 1x1 png, distinct from
 * the page's colour so a test can tell which one the ghost is showing. */
const IMAGE_PREVIEW_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const FIXTURE_IMAGE = {
  imageIndex: 0,
  bbox: { left: 100, bottom: 500, right: 300, top: 700 },
  pixelWidth: 500, pixelHeight: 500,
  hasClipPath: false,
  filters: ["DCTDecode"],
}

export async function runDragDropSelfTest(): Promise<DragDropTestResult> {
  const out: DragDropTestResult = {
    errors: [], slotRendered: false, slotHighlighted: false,
    droppedOnImage: null, droppedOnPage: null, ignoredNonFileDrag: false,
    handlesHiddenUntilSelected: false, handlesShownWhenSelected: false,
    resizedTo: null, noToolbarOnSelect: false, noButtonsOnImageSlot: false,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    const page = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }

    const captured: {
      onImage: DragDropTestResult["droppedOnImage"]
      onPage: DragDropTestResult["droppedOnPage"]
      // Collected rather than overwritten: reassigning a single field to
      // null makes TypeScript narrow it to `never` for the rest of the
      // function, which is a fight not worth having in a test.
      transforms: { x: number; y: number; width: number; height: number }[]
      textResizes: { fontSize: number; maxWidth: number }[]
    } = { onImage: null, onPage: null, transforms: [], textResizes: [] }

    let selection: { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null = null
    const renderPage = () => root.render(createElement(PdfEnginePage, {
      page,
      pageIndex: 0,
      displayWidth: 600,
      text: { loaded: true, lines: [FIXTURE_LINE] },
      images: { loaded: true, images: [FIXTURE_IMAGE] },
      contentMode: "text",
      revision: 0,
      renderPage: async () => null,
      renderPageRegion: async () => null,
      lastChange: null,
      loadPageText: async () => {},
      loadPageImages: async () => {},
      loadPageVectors: async () => {},
      vectors: { loaded: true, groups: [] },
      onReplaceVector: () => {},
      onSelectLine: () => {},
      onReplaceImage: () => {},
      onDropOnImage: (pageIndex, imageIndex, file) => {
        captured.onImage = { pageIndex, imageIndex, fileName: file.name }
      },
      // Dropping from the asset LIBRARY is a separate gesture with its own
      // payload; what this file measures is dropping a file off the desktop.
      productSlots: new Map(),
    onDropProductOnPage: () => {},
    onDropProductOnImage: () => {},
    onDropAssetOnPage: () => {},
      // Nothing is locked in these measurements.
      locks: new Set<string>(),
    alsoSelected: [],
    cropping: null,
    onCropCancel: () => {},
    onCropCommit: () => {},
      onTransformImage: (_pageIndex, _imageIndex, rect) => { captured.transforms.push(rect) },
      onTransformVector: () => {},
      selection,
      onSelect: (next: typeof selection) => { selection = next; renderPage() },
      onMoveStart: () => {},
      draggingSlot: null,
      dropTargetPage: false,
      imagePreviewUrl: null,
      // A 1x1 solid GREEN png. Distinct from the page's red, so a test can
      // tell "the hole is showing the engine's patch" from "the hole is
      // still showing the page".
      originPatchUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIA5agATwAAAABJRU5ErkJggg==",
      onResizeText: (_pageIndex, _lineIndex, fontSize, maxWidth) => { captured.textResizes.push({ fontSize, maxWidth }) },
      onDropOnPage: (pageIndex, file, xPts, yFromTopPts) => {
        captured.onPage = {
          pageIndex, fileName: file.name,
          xPts: Math.round(xPts), yFromTopPts: Math.round(yFromTopPts),
        }
      },
    }))
    renderPage()
    await wait(300)

    const pageEl = host.firstElementChild as HTMLElement | null
    if (!pageEl) { out.errors.push("page element not rendered"); return out }

    const slotEl = host.querySelector<HTMLElement>("div.group")
    out.slotRendered = !!slotEl
    // Rendered with contentMode "text" on purpose: image slots must be
    // visible regardless of the text layer, which is the bug this guards.
    if (!slotEl) { out.errors.push("image slot not rendered while text layer is on"); return out }

    const file = new File([new Uint8Array([137, 80, 78, 71])], "dropped.png", { type: "image/png" })

    const slotRect = slotEl.getBoundingClientRect()
    slotEl.dispatchEvent(dragEvent("dragenter", file, slotRect.left + 5, slotRect.top + 5))
    await wait(120)
    out.slotHighlighted = slotEl.className.includes("emerald")
    if (!out.slotHighlighted) out.errors.push("slot showed no drop highlight")

    slotEl.dispatchEvent(dragEvent("drop", file, slotRect.left + 5, slotRect.top + 5))
    await wait(150)
    out.droppedOnImage = captured.onImage
    if (!captured.onImage) out.errors.push("drop on the image slot did not fire")
    // The slot stops propagation; if it did not, the page handler would
    // also run and add a second, floating copy of the same picture.
    if (captured.onPage) out.errors.push("drop on a slot ALSO fired the page handler")

    const pageRect = pageEl.getBoundingClientRect()
    pageEl.dispatchEvent(dragEvent("drop", file, pageRect.left + 450, pageRect.top + 100))
    await wait(150)
    out.droppedOnPage = captured.onPage
    if (!captured.onPage) {
      out.errors.push("drop on bare page did not fire")
    } else {
      if (Math.abs(captured.onPage.xPts - 450) > 2) out.errors.push(`x was ${captured.onPage.xPts}, expected ~450`)
      if (Math.abs(captured.onPage.yFromTopPts - 100) > 2) out.errors.push(`y was ${captured.onPage.yFromTopPts}, expected ~100`)
    }

    // ---- selection reveals handles; they must not exist before that ----
    out.handlesHiddenUntilSelected = host.querySelectorAll('[role="presentation"]').length === 0
    if (!out.handlesHiddenUntilSelected) out.errors.push("resize handles were visible before the slot was selected")

    slotEl.dispatchEvent(pointerEvent("pointerdown", slotRect.left + 20, slotRect.top + 20))
    await wait(120)
    out.handlesShownWhenSelected = host.querySelectorAll('[role="presentation"]').length === 4
    // The floating action panel was removed because it covered the page it
    // sat on; a button row reappearing here would be a regression, so it is
    // asserted rather than left to a visual check.
    out.noToolbarOnSelect = host.querySelectorAll("div.shadow.ring-1 button").length === 0
    if (!out.noToolbarOnSelect) out.errors.push("a floating toolbar reappeared on selection")
    // Scoped to the slot itself: the delete button sat inside it, so a
    // document-wide button count would not notice it returning.
    out.noButtonsOnImageSlot = slotEl.querySelectorAll("button").length === 0
    if (!out.noButtonsOnImageSlot) {
      out.errors.push(`the image slot has ${slotEl.querySelectorAll("button").length} button(s); it should have none`)
    }
    if (!out.handlesShownWhenSelected) {
      out.errors.push(`expected 4 resize handles after selecting, found ${host.querySelectorAll('[role="presentation"]').length}`)
    }

    // ---- drag the SE corner: width/height should grow, origin stay put ----
    const beforeResizeCount = captured.transforms.length
    const handleEl = host.querySelectorAll<HTMLElement>('[role="presentation"]')[3]
    const slotNow = host.querySelector<HTMLElement>("div.group")
    if (handleEl && slotNow) {
      const rBefore = slotNow.getBoundingClientRect()
      handleEl.dispatchEvent(pointerEvent("pointerdown", rBefore.right, rBefore.bottom))
      await wait(60)
      window.dispatchEvent(pointerEvent("pointermove", rBefore.right + 40, rBefore.bottom + 40))
      await wait(60)
      window.dispatchEvent(pointerEvent("pointerup", rBefore.right + 40, rBefore.bottom + 40))
      await wait(150)
      const resized = captured.transforms.length > beforeResizeCount ? captured.transforms.at(-1) ?? null : null
      out.resizedTo = resized
      if (!resized) out.errors.push("resizing did not commit a transform")
      else if (resized.width <= 200) out.errors.push(`resize did not grow the width: ${resized.width}`)
    }

    // Dragging a text selection or a link must not present the page as a
    // drop target.
    pageEl.dispatchEvent(dragEvent("dragenter", null, pageRect.left + 10, pageRect.top + 10))
    await wait(120)
    out.ignoredNonFileDrag = !pageEl.className.includes("emerald")
    if (!out.ignoredNonFileDrag) out.errors.push("a non-file drag lit the page up as droppable")

    return out
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * The cross-page half.
 *
 * Renders TWO pages inside a scrollable column and wires them to the real
 * useCrossPageDrag hook exactly as the editor does — the whole behaviour
 * under test is about what happens BETWEEN pages, which a single-page
 * harness cannot express. The pages are deliberately taller than the
 * viewport so page 2 starts off-screen and can only be reached by the
 * auto-scroll doing its job.
 */
export async function runCrossPageDragSelfTest(): Promise<CrossPageTestResult> {
  const out: CrossPageTestResult = {
    errors: [], sameGhostAppears: false, crossDrop: null, samePageDrop: null,
    targetPageHighlighted: false,
    autoScrolledBy: 0, retargetedDuringAutoScroll: false, escapeCancelled: false,
    clickTravelledPx: null, dragTravelledPx: null,
    reportedPageWidth: null, actualPageWidth: null,
    textGhostShowsWords: false, textGhostHasNoCrop: false,
    imageGhostHasCrop: false, imageGhostColour: null,
    originCoveredWhileDragging: false,
    debug: {},
  }

  const host = document.createElement("div")
  // Pinned over the whole viewport. Appended normally, the harness landed
  // BELOW the fold on the test page, so a pointer held at the bottom of the
  // window was never over any page and the auto-scroll had nothing to aim
  // at — the geometry under test has to be on screen to be tested at all.
  host.style.cssText = "position:fixed;inset:0;z-index:9999;background:#fff"
  document.body.appendChild(host)
  const root = createRoot(host)
  const drops: CrossPageDrop[] = []
  /** Target page seen on each frame, so re-targeting during a scroll with a
   * stationary pointer can be observed rather than inferred. */
  const targetsSeen: (number | null)[] = []

  try {
    const pages = [
      { index: 0, widthPts: 600, heightPts: 800, rotation: 0 },
      { index: 1, widthPts: 600, heightPts: 800, rotation: 0 },
    ]

    function Harness() {
      const [selection, setSelection] = useState<
        { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null
      >(null)
      const { drag, start } = useCrossPageDrag((drop) => { drops.push(drop) })
      targetsSeen.push(drag?.targetPageIndex ?? null)

      return createElement(
        "div",
        // Fills the viewport so "near the bottom edge of the window" and
        // "near the bottom edge of the scroller" are the same place, which
        // is what the auto-scroll's edge zone is defined against.
        { id: "harness-scroller", style: { height: "100%", overflowY: "auto" } },
        // The REAL ghost component, exactly as the editor mounts it — a
        // copy of its markup here would keep passing after the real one
        // broke, which is the failure mode this harness exists to avoid.
        createElement(CrossPageDragGhost, { drag }),
        createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" } },
          ...pages.map((page, index) => createElement(PdfEnginePage, {
            key: index,
            page,
            pageIndex: index,
            displayWidth: 600,
            // Only page 0 carries the fixture content: the test drags FROM
            // page 0 TO page 1, and an empty target proves the box arrived
            // rather than matching something already there.
            text: { loaded: true, lines: index === 0 ? [FIXTURE_LINE] : [] },
            images: { loaded: true, images: index === 0 ? [FIXTURE_IMAGE] : [] },
            contentMode: "text" as const,
            revision: 0,
            // A known solid colour, so the drag preview can be checked by
            // sampling it rather than by trusting that an <img> appeared.
            renderPageRegion: async () => null,
            lastChange: null,
            renderPage: async (_p: number, scale: number) => {
              const w = Math.max(1, Math.round(600 * scale))
              const h = Math.max(1, Math.round(800 * scale))
              const rgba = new Uint8ClampedArray(w * h * 4)
              for (let i = 0; i < w * h; i++) {
                rgba[i * 4] = 220; rgba[i * 4 + 1] = 40
                rgba[i * 4 + 2] = 90; rgba[i * 4 + 3] = 255
              }
              return { width: w, height: h, rgba: rgba.buffer }
            },
            loadPageText: async () => {},
            loadPageImages: async () => {},
        loadPageVectors: async () => {},
        vectors: { loaded: true, groups: [] },
        onReplaceVector: () => {},
            onSelectLine: () => {},
            onReplaceImage: () => {},
                  onDropOnImage: () => {},
            onDropOnPage: () => {},
            productSlots: new Map(),
    onDropProductOnPage: () => {},
    onDropProductOnImage: () => {},
    onDropAssetOnPage: () => {},
            locks: new Set<string>(),
    alsoSelected: [],
    cropping: null,
    onCropCancel: () => {},
    onCropCommit: () => {},
            onTransformImage: () => {},
            onTransformVector: () => {},
            onResizeText: () => {},
            selection,
            onSelect: setSelection,
            onMoveStart: start,
            draggingSlot: drag ? { ...drag.item } : null,
            dropTargetPage: drag !== null && drag.targetPageIndex === index,
            // A 1x1 solid BLUE png standing in for "the image on its own",
            // distinct from the page's red so the test can tell which one
            // the ghost is showing.
            imagePreviewUrl: { pageIndex: index, index: 0, url: IMAGE_PREVIEW_URL },
            // A 1x1 solid GREEN png. Distinct from the page's red, so a test can
            // tell "the hole is showing the engine's patch" from "the hole is
            // still showing the page".
            originPatchUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIA5agATwAAAABJRU5ErkJggg==",
          })),
        ),
      )
    }

    root.render(createElement(Harness))
    await wait(350)

    const scroller = document.getElementById("harness-scroller")
    if (!scroller) { out.errors.push("harness scroller not rendered"); return out }

    const surfaces = host.querySelectorAll<HTMLElement>("[data-engine-page-index]")
    if (surfaces.length !== 2) {
      out.errors.push(`expected 2 page surfaces, found ${surfaces.length}`)
      return out
    }

    // ---- select the text line on page 0, then drag it down to page 1 ----
    // Found by its marker, not by the colour it happens to be outlined in:
    // this used to look for "ring-blue-500/30", so simply making that outline
    // strong enough to see broke the whole cross-page suite.
    const textEl = host.querySelector<HTMLElement>("[data-pdf-text-slot]")
    if (!textEl) { out.errors.push("text slot not rendered on page 0"); return out }

    textEl.dispatchEvent(pointerEvent("pointerdown", 0, 0))
    await wait(120)
    const selectedText = Array.from(host.querySelectorAll<HTMLElement>("div"))
      .find((el) => el.className.includes("ring-blue-600"))
    if (!selectedText) { out.errors.push("text slot did not select on click"); return out }

    const t0 = selectedText.getBoundingClientRect()
    const grabX = t0.left + 20
    const grabY = t0.top + 10
    selectedText.dispatchEvent(pointerEvent("pointerdown", grabX, grabY))
    await wait(80)

    out.sameGhostAppears = !!document.querySelector("[data-engine-drag-ghost]")
    if (!out.sameGhostAppears) out.errors.push("no ghost appeared when the drag began")

    // ---- a TEXT ghost shows the words, not a crop of the page ----
    const ghost = document.querySelector<HTMLElement>("[data-engine-drag-ghost]")
    out.textGhostHasNoCrop = !ghost?.querySelector("img")
    out.textGhostShowsWords = (ghost?.textContent ?? "").includes(FIXTURE_LINE.text)
    if (!out.textGhostShowsWords) {
      out.errors.push("the text ghost does not show the words being dragged")
    }
    if (!out.textGhostHasNoCrop) {
      out.errors.push("the text ghost is a page crop — it would carry the background with it")
    }

    // ---- and the original shows the engine's patch, not the page ----
    const origin = host.querySelector<HTMLImageElement>("[data-engine-drag-origin]")
    out.originCoveredWhileDragging = origin?.tagName === "IMG" && !!origin.src
    if (!out.originCoveredWhileDragging) {
      out.errors.push("the original still shows while dragging — the move reads as a copy")
    } else if (!origin!.src.startsWith("data:image/png")) {
      // It must be the picture the engine rendered of the page WITHOUT this
      // slot; anything else would be a mark laid over the artwork.
      out.errors.push("the origin cover is not an engine-rendered patch")
    }


    // ---- hold near the bottom edge and let auto-scroll do the work ----
    const scrollBefore = scroller.scrollTop
    const holdY = window.innerHeight - 20
    window.dispatchEvent(pointerEvent("pointermove", grabX, holdY))
    // Held with NO further pointer events: any scrolling from here on is
    // the auto-scroll's own doing, which is exactly the claim being tested.
    await wait(700)
    out.autoScrolledBy = Math.round(scroller.scrollTop - scrollBefore)
    if (out.autoScrolledBy <= 0) {
      out.errors.push("holding at the bottom edge did not auto-scroll the document")
    }

    const rectsNow = () => Array.from(document.querySelectorAll<HTMLElement>("[data-engine-page-index]"))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { i: el.dataset.enginePageIndex, top: Math.round(r.top), bottom: Math.round(r.bottom) }
      })
    out.debug.afterHold = {
      holdY, innerHeight: window.innerHeight, scrollTop: scroller.scrollTop,
      rects: rectsNow(), targets: targetsSeen.slice(-8),
      hasTargetReadout: !!document.querySelector("[data-engine-drag-target]"),
    }

    // Target must have followed the pages sliding past a stationary pointer.
    out.retargetedDuringAutoScroll = targetsSeen.includes(1)
    if (!out.retargetedDuringAutoScroll) {
      out.errors.push("the drop target never updated to page 1 while auto-scrolling")
    }

    const page1 = host.querySelector<HTMLElement>('[data-engine-page-index="1"]')
    out.targetPageHighlighted = !!page1?.className.includes("ring-sky-500")
    if (!out.targetPageHighlighted) out.errors.push("page 1 was not marked as the drop target")

    // ---- release over page 1 ----
    const r1 = page1!.getBoundingClientRect()
    const dropX = r1.left + 120
    const dropY = r1.top + 200
    window.dispatchEvent(pointerEvent("pointermove", dropX, dropY))
    await wait(80)
    window.dispatchEvent(pointerEvent("pointerup", dropX, dropY))
    await wait(200)

    out.crossDrop = drops.at(-1) ?? null
    out.reportedPageWidth = out.crossDrop ? Math.round(out.crossDrop.targetPageWidthPx) : null
    out.actualPageWidth = Math.round(page1!.getBoundingClientRect().width)
    if (out.reportedPageWidth !== out.actualPageWidth) {
      out.errors.push(
        `the drop reported the page as ${out.reportedPageWidth}px wide but it is drawn at `
        + `${out.actualPageWidth}px — the conversion to PDF points would be wrong by that ratio`,
      )
    }
    if (!out.crossDrop) {
      out.errors.push("releasing over page 1 reported no drop")
    } else {
      if (out.crossDrop.targetPageIndex !== 1) {
        out.errors.push(`drop reported page ${out.crossDrop.targetPageIndex}, expected 1`)
      }
      if (out.crossDrop.item.pageIndex !== 0) {
        out.errors.push(`drop reported source page ${out.crossDrop.item.pageIndex}, expected 0`)
      }
      // The pointer was grabbed 20px right and 10px down inside the box, so
      // the box's top-left must land 20/10 up-left of the release point.
      // This is the check that catches a ghost that snapped its corner to
      // the cursor instead of preserving the grab offset.
      const expectedLeft = dropX - r1.left - 20
      const expectedTop = dropY - r1.top - 10
      if (Math.abs(out.crossDrop.leftPx - expectedLeft) > 2) {
        out.errors.push(`drop left was ${Math.round(out.crossDrop.leftPx)}, expected ~${Math.round(expectedLeft)}`)
      }
      if (Math.abs(out.crossDrop.topPx - expectedTop) > 2) {
        out.errors.push(`drop top was ${Math.round(out.crossDrop.topPx)}, expected ~${Math.round(expectedTop)}`)
      }
    }

    // The ghost must be gone once released, or it would sit over the page.
    if (document.querySelector("[data-engine-drag-ghost]")) {
      out.errors.push("the ghost survived the drop")
    }

    // ---- a drag that ends on its own page still reports a drop ----
    // The box is STILL selected after the drop above, so one press starts a
    // drag directly; pressing twice would begin a gesture and then begin a
    // second one on top of it.
    scroller.scrollTop = 0
    await wait(250)
    out.debug.beforeSamePage = { scrollTop: scroller.scrollTop, rects: rectsNow() }
    const sel = Array.from(host.querySelectorAll<HTMLElement>("div"))
      .find((el) => el.className.includes("ring-blue-600"))
    if (!sel) {
      out.errors.push("the text box lost its selection after the cross-page drop")
    } else {
      const dropsBeforeSame = drops.length
      const s1 = sel.getBoundingClientRect()
      out.debug.samePageBox = { top: Math.round(s1.top), left: Math.round(s1.left) }
      sel.dispatchEvent(pointerEvent("pointerdown", s1.left + 10, s1.top + 10))
      await wait(80)
      // Kept well clear of the viewport edges so auto-scroll cannot fire
      // and carry the box onto the other page mid-gesture.
      window.dispatchEvent(pointerEvent("pointermove", s1.left + 40, s1.top + 25))
      await wait(80)
      window.dispatchEvent(pointerEvent("pointerup", s1.left + 40, s1.top + 25))
      await wait(200)
      const last = drops.length > dropsBeforeSame ? drops.at(-1) ?? null : null
      if (last) out.dragTravelledPx = Math.round(last.travelledPx)
      if (!last) {
        out.errors.push("a drag ending on its own page reported no drop")
      } else if (last.targetPageIndex !== 0) {
        out.errors.push(`same-page drag reported page ${last.targetPageIndex}, expected 0`)
      } else {
        out.samePageDrop = last
      }
    }

    // ---- a click on a selected box must read as a CLICK, not a move ----
    // This is what lets a selected box stay selected when clicked again:
    // the editor only commits when the pointer really travelled.
    const clickTarget = Array.from(host.querySelectorAll<HTMLElement>("div"))
      .find((el) => el.className.includes("ring-blue-600"))
    if (clickTarget) {
      const dropsBeforeClick = drops.length
      const c0 = clickTarget.getBoundingClientRect()
      clickTarget.dispatchEvent(pointerEvent("pointerdown", c0.left + 15, c0.top + 12))
      await wait(60)
      window.dispatchEvent(pointerEvent("pointerup", c0.left + 15, c0.top + 12))
      await wait(150)
      const clicked = drops.length > dropsBeforeClick ? drops.at(-1) ?? null : null
      out.clickTravelledPx = clicked ? Math.round(clicked.travelledPx) : null
      if (clicked === null) {
        out.errors.push("a click on a selected box reported no drop at all")
      } else if (clicked.travelledPx > 2) {
        out.errors.push(`a click reported ${clicked.travelledPx}px of travel; it must read as ~0`)
      }
    }

    // ---- an IMAGE ghost DOES carry a crop, and it is the right pixels ----
    // The opposite expectation to text: an image is its pixels, so cropping
    // it is exactly right.
    scroller.scrollTop = 0
    await wait(150)
    const imageSlot = host.querySelector<HTMLElement>("div.group")
    if (imageSlot) {
      const i0 = imageSlot.getBoundingClientRect()
      imageSlot.dispatchEvent(pointerEvent("pointerdown", i0.left + 20, i0.top + 20))
      await wait(120)
      const selectedImg = host.querySelector<HTMLElement>("div.group")
      const i1 = selectedImg!.getBoundingClientRect()
      selectedImg!.dispatchEvent(pointerEvent("pointerdown", i1.left + 20, i1.top + 20))
      await wait(60)
      window.dispatchEvent(pointerEvent("pointermove", i1.left + 60, i1.top + 45))
      await wait(120)

      const img = document.querySelector<HTMLImageElement>("[data-engine-drag-ghost] img")
      out.imageGhostHasCrop = !!img?.src
      if (!img?.src) {
        out.errors.push("the image ghost shows no picture of the image being dragged")
      } else {
        // It must be the IMAGE rendered on its own — the picture supplied
        // as imagePreviewUrl — and not a crop of the page, which would
        // carry anything drawn over the image along with it.
        out.imageGhostColour = img.src.slice(0, 40)
        if (img.src !== IMAGE_PREVIEW_URL) {
          out.errors.push(
            "the image ghost is not the prepared image render — it is showing something else, "
            + "most likely a crop of the composited page",
          )
        }
      }
      window.dispatchEvent(pointerEvent("pointerup", i1.left + 60, i1.top + 45))
      await wait(150)
    }

    // ---- Escape abandons a drag without committing anything ----
    const dropsBefore = drops.length
    // Whatever is selected at this point — the image case above runs first,
    // so looking only for a selected TEXT box finds nothing and the check
    // silently never runs.
    const escTarget = Array.from(host.querySelectorAll<HTMLElement>("div"))
      .find((el) => el.className.includes("ring-blue-600") || el.className.includes("ring-sky-500"))
    if (escTarget) {
      const e0 = escTarget.getBoundingClientRect()
      escTarget.dispatchEvent(pointerEvent("pointerdown", e0.left + 10, e0.top + 10))
      await wait(60)
      window.dispatchEvent(pointerEvent("pointermove", e0.left + 60, e0.top + 60))
      await wait(60)
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await wait(120)
      window.dispatchEvent(pointerEvent("pointerup", e0.left + 60, e0.top + 60))
      await wait(150)
      out.escapeCancelled = drops.length === dropsBefore
        && !document.querySelector("[data-engine-drag-ghost]")
      if (!out.escapeCancelled) out.errors.push("Escape did not abandon the drag")
    }

    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
