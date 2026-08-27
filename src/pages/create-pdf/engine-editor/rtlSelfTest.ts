// Does the editor behave the same in Hebrew as in English?
//
// The app flips to right-to-left for Hebrew, and that flip is not cosmetic:
// CSS logical properties swap sides, and a browser's horizontal scrolling
// changes its numbering entirely. Anything that mixes those with PHYSICAL
// screen coordinates — which a PDF page is, all of it — behaves backwards
// without a single error being thrown.
//
// The reported symptom was resizing: in Hebrew, dragging a box's corner sent
// it the wrong way. So what is measured here is the property that matters and
// is identical in both languages: drag the corner that is visually at the
// top-left, and the box's left edge follows the pointer while it gets wider.
// Every check runs in BOTH directions and the two must agree — a check that
// only ran in Hebrew could pass on a page that was broken in both.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEngineWorkspace } from "./PdfEngineWorkspace"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface RtlCase {
  /** Change in the box's left edge and width after dragging the visually
   * top-left handle 40px further left. Both must be about +40/-40. */
  imageLeftDelta: number
  imageWidthDelta: number
  textLeftDelta: number
  textWidthDelta: number
  /** How far the point under the pointer drifted while zooming. */
  zoomPinDriftPx: number
  /** The page counter must read "1 / 6", not "6 / 1". */
  pageCounterText: string
  /** Handles must sit on the box's real corners in both directions. */
  handleCornerErrorPx: number
}

export interface RtlTestResult {
  errors: string[]
  ltr: RtlCase | null
  rtl: RtlCase | null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

const PAGE = { index: 0, widthPts: 595, heightPts: 794, rotation: 0 }

function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerId: 1, isPrimary: true, button: 0,
  })
}

function fakeDoc(): UsePdfEngineDocumentResult {
  const noop = async () => {}
  const line = {
    lineIndex: 0, text: "שלום", pieceCount: 1, fontSize: 24,
    bbox: { left: 60, bottom: 600, right: 300, top: 640 },
    matrix: { a: 24, b: 0, c: 0, d: 24, e: 60, f: 600 },
    fontName: "Heebo", direction: "rtl" as const,
    color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false,
  }
  const image = {
    imageIndex: 0,
    bbox: { left: 80, bottom: 200, right: 320, top: 440 },
    pixelWidth: 240, pixelHeight: 240, hasClipPath: false, filters: [],
  }
  const pages = Array.from({ length: 6 }, (_, i) => ({ ...PAGE, index: i }))
  const text: Record<number, unknown> = {}
  const images: Record<number, unknown> = {}
  const vectors: Record<number, unknown> = {}
  for (let i = 0; i < 6; i++) {
    text[i] = { loaded: true, lines: [line] }
    images[i] = { loaded: true, images: [image] }
    vectors[i] = { loaded: true, groups: [] }
  }
  return {
    phase: "ready", error: null, downloadPercent: null,
    pages, docId: "rtl", revision: 0, busy: false,
    pageText: text, pageImages: images, pageVectors: vectors,
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    renderPage: async () => null, renderPageRegion: async () => null, lastChange: null,
    renderCleanPatch: async () => null, renderImagePreview: async () => null,
    editText: noop, moveText: async () => -1, moveTextToPage: async () => -1,
    moveImageToPage: async () => -1, removeText: noop,
    replaceImage: noop, removeImage: noop, setImageRect: async () => -1,
    removeVector: noop, replaceVector: noop,
    addTextOverlay: noop, addImageOverlay: noop, applyPagePlan: noop,
    save: async () => new Blob(),
  } as unknown as UsePdfEngineDocumentResult
}

/**
 * Drag the handle that is VISUALLY at the box's top-left, wherever the
 * stylesheet happened to put it, and report what the box did.
 *
 * Chosen visually rather than by name on purpose: the whole fault is that
 * the handle named "north-west" stops being the north-west one when the page
 * flips, so trusting the name would test the bug's own assumption.
 */
async function dragTopLeftHandle(
  box: HTMLElement, handles: HTMLElement[], byPx: number,
): Promise<{ leftDelta: number; widthDelta: number; cornerError: number }> {
  const before = box.getBoundingClientRect()
  const scored = handles.map((h) => {
    const r = h.getBoundingClientRect()
    return { h, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }
  })
  const topLeft = scored.reduce((best, c) =>
    (c.cx + c.cy < best.cx + best.cy ? c : best))
  // How far the four handles sit from the box's actual corners. A handle
  // parked on the wrong side shows up here even before anything is dragged.
  const corners = [
    { x: before.left, y: before.top }, { x: before.right, y: before.top },
    { x: before.left, y: before.bottom }, { x: before.right, y: before.bottom },
  ]
  const cornerError = Math.max(...scored.map((s) =>
    Math.min(...corners.map((c) => Math.hypot(s.cx - c.x, s.cy - c.y)))))

  topLeft.h.dispatchEvent(pointer("pointerdown", topLeft.cx, topLeft.cy))
  await frame()
  window.dispatchEvent(pointer("pointermove", topLeft.cx + byPx, topLeft.cy))
  await frame()
  const during = box.getBoundingClientRect()
  window.dispatchEvent(pointer("pointerup", topLeft.cx + byPx, topLeft.cy))
  await frame()

  return {
    leftDelta: Math.round(during.left - before.left),
    widthDelta: Math.round(during.width - before.width),
    cornerError: Math.round(cornerError),
  }
}

async function runDirection(direction: "ltr" | "rtl"): Promise<RtlCase> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  const previous = document.documentElement.getAttribute("dir")
  document.documentElement.setAttribute("dir", direction)

  try {
    const doc = fakeDoc()
    let selection: { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null =
      { pageIndex: 0, kind: "image", index: 0 }

    const render = () => root.render(createElement(PdfEngineWorkspace, {
      doc, documentName: "rtl.pdf", onExit: () => {}, onDisplayWidthChange: () => {},
      selection,
      column: {
        contentMode: "text", selection, onSelect: () => {}, drag: null,
        onMoveStart: () => {}, originPatch: null, imagePreview: null,
        onEditLine: () => {}, onReplaceImage: () => {}, onReplaceVector: () => {},
        onDropOnImage: () => {}, onDropOnPage: () => {}, onTransformImage: () => {},
        onDropAssetOnPage: () => {}, onDropAssetOnImage: () => {},
        onResizeText: () => {},
      } as never,
      toolbar: {
        selection, contentMode: "text", onToggleContentMode: () => {},
        onAddText: () => {}, onAddImage: () => {}, onOpenOrganizer: () => {},
        onEditSelectedText: () => {}, onReplaceSelectedImage: () => {},
        onReplaceSelectedVector: () => {}, onDeselect: () => {},
        textStyle: { bold: false, italic: false, color: { r: 0, g: 0, b: 0 } },
        onToggleBold: () => {}, onToggleItalic: () => {}, onTextColor: () => {},
        onScaleText: () => {}, onAlignText: () => {}, onTransformImage: () => {},
        onDownload: () => {}, downloading: false, busy: false,
      } as never,
    }))

    render()
    await wait(700)

    const scroller = host.querySelector<HTMLElement>("[data-pdf-workspace] .overflow-auto")!
    const bar = host.querySelector<HTMLElement>("[data-pdf-viewport-bar]")

    // ── the image box ──
    const imageBox = host.querySelector<HTMLElement>("[data-pdf-image-slot]")
      ?? host.querySelectorAll<HTMLElement>("[data-engine-page-index] > div.group")[0]
    const imageHandles = Array.from(
      imageBox?.querySelectorAll<HTMLElement>("[data-resize-handle]") ?? [])
    const image = imageBox && imageHandles.length === 4
      ? await dragTopLeftHandle(imageBox, imageHandles, -40)
      : { leftDelta: NaN, widthDelta: NaN, cornerError: NaN }

    // ── the text box ──
    selection = { pageIndex: 0, kind: "text", index: 0 }
    render()
    await wait(400)
    const textBox = host.querySelector<HTMLElement>("[data-pdf-text-slot]")
    const textHandles = Array.from(
      textBox?.querySelectorAll<HTMLElement>("[data-resize-handle]") ?? [])
    const text = textBox && textHandles.length === 4
      ? await dragTopLeftHandle(textBox, textHandles, -40)
      : { leftDelta: NaN, widthDelta: NaN, cornerError: NaN }

    // ── zoom must stay pinned to the pointer in both directions ──
    selection = null
    render()
    await wait(300)
    scroller.scrollTop = 300
    await frame()
    const box = scroller.getBoundingClientRect()
    const px = box.left + box.width / 2
    const py = box.top + box.height / 2
    const pageEl = () => host.querySelector<HTMLElement>('[data-engine-page-index="0"]')!
    const beforeZoom = pageEl().getBoundingClientRect()
    const fx = (px - beforeZoom.left) / beforeZoom.width
    const fy = (py - beforeZoom.top) / beforeZoom.height
    for (let i = 0; i < 6; i++) {
      scroller.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, clientX: px, clientY: py,
        deltaY: -100, deltaMode: 0, ctrlKey: true,
      }))
    }
    await frame()
    const afterZoom = pageEl().getBoundingClientRect()
    const zoomPinDriftPx = Math.round(Math.hypot(
      afterZoom.left + fx * afterZoom.width - px,
      afterZoom.top + fy * afterZoom.height - py,
    ))

    return {
      imageLeftDelta: image.leftDelta,
      imageWidthDelta: image.widthDelta,
      textLeftDelta: text.leftDelta,
      textWidthDelta: text.widthDelta,
      handleCornerErrorPx: Math.max(image.cornerError, text.cornerError),
      zoomPinDriftPx,
      pageCounterText: (
        bar?.querySelector("[data-pdf-page-counter]")?.textContent ?? ""
      ).replace(/\s+/g, " ").trim(),
    }
  } finally {
    root.unmount()
    host.remove()
    if (previous === null) document.documentElement.removeAttribute("dir")
    else document.documentElement.setAttribute("dir", previous)
  }
}

export async function runRtlSelfTest(): Promise<RtlTestResult> {
  const out: RtlTestResult = { errors: [], ltr: null, rtl: null }

  out.ltr = await runDirection("ltr")
  out.rtl = await runDirection("rtl")

  for (const [name, c] of [["English", out.ltr], ["Hebrew", out.rtl]] as const) {
    if (!c) continue
    if (Number.isNaN(c.imageWidthDelta) || Number.isNaN(c.textWidthDelta)) {
      out.errors.push(`${name}: could not find a box with four handles to drag`)
      continue
    }
    // Dragged 40px LEFT from the top-left corner: the left edge follows the
    // pointer and the box gets WIDER by the same amount. Backwards in either
    // number is the reported fault.
    for (const [what, left, width] of [
      ["image", c.imageLeftDelta, c.imageWidthDelta],
      ["text", c.textLeftDelta, c.textWidthDelta],
    ] as const) {
      if (Math.abs(left - -40) > 3) {
        out.errors.push(
          `${name}: dragging the ${what} box's top-left corner 40px left moved its`
          + ` left edge by ${left}px, expected -40`)
      }
      if (Math.abs(width - 40) > 3) {
        out.errors.push(
          `${name}: dragging the ${what} box's top-left corner 40px left changed its`
          + ` width by ${width}px, expected +40`)
      }
    }
    if (c.handleCornerErrorPx > 12) {
      out.errors.push(
        `${name}: a resize handle sits ${c.handleCornerErrorPx}px from any corner of`
        + " the box it belongs to")
    }
    if (c.zoomPinDriftPx > 4) {
      out.errors.push(
        `${name}: zooming drifted ${c.zoomPinDriftPx}px from the pointer`)
    }
    if (!/\b1 \/ 6\b/.test(c.pageCounterText)) {
      out.errors.push(
        `${name}: the page counter reads "${c.pageCounterText}", expected "1 / 6"`)
    }
  }
  return out
}
