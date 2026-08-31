// How long after a page appears can you actually click its text?
//
// This is the fault that was reported as "some text is not editable". It was
// never about the text. The engine is a single worker serving one request at
// a time in the order they arrive, and a page asks it for two things:
// the PICTURE of the page, measured at 252-590ms on the catalogue in
// question, and the LIST OF EDITABLE THINGS on it, measured at 0-8ms. Asked
// for in that order, the tiny job waits behind the huge one — and behind the
// huge one belonging to every other page that scrolled into view at the same
// moment.
//
// The page therefore looked finished and did nothing when clicked, for a
// second or more, and then started working. Which is indistinguishable from
// broken text unless you happen to wait.
//
// So the thing measured here is the ORDER those requests reach the engine,
// with several pages arriving at once — the case that makes the wait long
// enough to notice. The control runs the same document with the requests in
// the old order and must show the fault, or this proves nothing.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface HotspotReadyTestResult {
  errors: string[]
  /** Order the engine was asked for things, first eight entries. */
  requestOrder: string[]
  /** How many page pictures were requested before the FIRST page's text. */
  picturesAheadOfFirstText: number
  /** ...and before the last page's text. */
  picturesAheadOfLastText: number
  /** Simulated milliseconds of engine work before every page is clickable. */
  msUntilAllClickable: number
  /** The same figure with the requests in the old order — the control. */
  msUntilAllClickableOldOrder: number
  pagesMounted: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Measured on the reported catalogue: drawing a page against listing what
 * is on it. The gap between them is the whole bug. */
const PICTURE_MS = 400
const LIST_MS = 5

const PAGE = { index: 0, widthPts: 680, heightPts: 822, rotation: 0 }

function fakeLines(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    lineIndex: i, text: `line ${i}`, pieceCount: 1, fontSize: 8,
    bbox: { left: 40, bottom: 700 - i * 3, right: 320, top: 708 - i * 3 },
    matrix: { a: 8, b: 0, c: 0, d: 8, e: 40, f: 700 - i * 3 },
    fontName: "X", direction: "ltr" as const,
    color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false,
  }))
}

/**
 * Mounts the real page column and records what the engine is asked for, in
 * order. Nothing is actually rendered — the point is the QUEUE, not the
 * pixels.
 */
async function observe(pageCount: number): Promise<string[]> {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;overflow:auto"
  document.body.appendChild(host)
  const root = createRoot(host)
  const order: string[] = []

  try {
    const pages = Array.from({ length: pageCount }, (_, i) => ({ ...PAGE, index: i }))
    const text: Record<number, unknown> = {}
    const images: Record<number, unknown> = {}
    const vectors: Record<number, unknown> = {}
    const doc = {
      pages, docId: "t", revision: 0, phase: "ready", busy: false,
      pageText: text, pageImages: images, pageVectors: vectors,
      lastChange: null,
      renderPage: async (i: number) => { order.push(`picture:${i}`); return null },
      renderPageRegion: async () => null,
      renderCleanPatch: async () => null,
      renderImagePreview: async () => null,
      loadPageText: async (i: number) => {
        order.push(`text:${i}`)
        text[i] = { loaded: true, lines: fakeLines(20) }
      },
      loadPageImages: async (i: number) => {
        order.push(`images:${i}`)
        images[i] = { loaded: true, images: [] }
      },
      loadPageVectors: async (i: number) => {
        order.push(`vectors:${i}`)
        vectors[i] = { loaded: true, groups: [] }
      },
    } as unknown as UsePdfEngineDocumentResult

    root.render(createElement(PdfEnginePageColumn, {
      // Narrow pages so several are in view at once, which is the case that
      // made the wait long enough to report: each page in view adds another
      // picture that a later page's text could end up queued behind.
      doc, displayWidth: 260, gutter: 0,
      contentMode: "text" as const, selection: null, onSelect: () => {},
      drag: null, onMoveStart: () => {}, originPatch: null, imagePreview: null,
      onEditLine: () => {}, onReplaceImage: () => {}, onReplaceVector: () => {},
      onDropOnImage: () => {}, onDropOnPage: () => {}, onTransformImage: () => {},
      onDropAssetOnPage: () => {},
      // Nothing is locked in these measurements.
      locks: new Set<string>(),
    alsoSelected: [],
    cropping: null,
    onCropCancel: () => {},
    onCropCommit: () => {},
      onTransformVector: () => {},
      onResizeText: () => {},
    }))
    await wait(900)
    return order
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * How much engine time passes before every page is clickable, given the
 * order the requests were made in. A picture costs PICTURE_MS, a list costs
 * LIST_MS, and they are served strictly in turn.
 */
function msUntilAllClickable(order: string[], pages: number[]): number {
  const pending = new Set(pages)
  let clock = 0
  for (const entry of order) {
    const [kind, page] = entry.split(":")
    clock += kind === "picture" ? PICTURE_MS : LIST_MS
    if (kind === "text") {
      pending.delete(Number(page))
      if (pending.size === 0) return clock
    }
  }
  return clock
}

export async function runHotspotReadySelfTest(): Promise<HotspotReadyTestResult> {
  const out: HotspotReadyTestResult = {
    errors: [], requestOrder: [], picturesAheadOfFirstText: 0,
    picturesAheadOfLastText: 0, msUntilAllClickable: 0,
    msUntilAllClickableOldOrder: 0, pagesMounted: 0,
  }

  // Six pages, all in view at once — a short catalogue opened and scrolled,
  // which is when the wait was long enough to be reported as a bug.
  const PAGES = 6
  const order = await observe(PAGES)
  out.requestOrder = order.slice(0, 8)

  // Only the pages that actually came into view. A page still below the fold
  // has asked for nothing, and counting it would measure the viewport rather
  // than the queue.
  const seen = order
    .filter((e) => e.startsWith("text:"))
    .map((e) => Number(e.split(":")[1]))
  out.pagesMounted = seen.length

  const picturesBefore = (entry: string) => {
    const at = order.indexOf(entry)
    if (at < 0) return -1
    return order.slice(0, at).filter((e) => e.startsWith("picture:")).length
  }
  out.picturesAheadOfFirstText = seen.length ? picturesBefore(`text:${seen[0]}`) : -1
  out.picturesAheadOfLastText = seen.length
    ? picturesBefore(`text:${seen[seen.length - 1]}`)
    : -1
  out.msUntilAllClickable = msUntilAllClickable(order, seen)

  // The control: the same pages with every picture asked for before its own
  // lists, which is what the code used to do. If this does NOT come out
  // slower, the measurement above is not measuring the order at all.
  const oldOrder: string[] = []
  for (const i of seen) {
    oldOrder.push(`picture:${i}`, `text:${i}`, `images:${i}`, `vectors:${i}`)
  }
  out.msUntilAllClickableOldOrder = msUntilAllClickable(oldOrder, seen)

  // ---- verdicts ----
  if (order.length === 0) {
    out.errors.push("the column asked the engine for nothing at all")
    return out
  }
  if (out.picturesAheadOfFirstText > 0) {
    out.errors.push(
      `the first page's text waited behind ${out.picturesAheadOfFirstText} page`
      + " picture(s) — it must be asked for first")
  }
  if (out.pagesMounted < 3) {
    out.errors.push(
      `only ${out.pagesMounted} pages came into view — too few for the queue to`
      + " build up, so this measurement proves little")
  }
  if (out.picturesAheadOfLastText > 0) {
    out.errors.push(
      `the last page's text waited behind ${out.picturesAheadOfLastText} page`
      + " picture(s); with several pages in view that is the second or more"
      + " during which the document looks finished and cannot be clicked")
  }
  if (out.msUntilAllClickableOldOrder <= out.msUntilAllClickable) {
    out.errors.push(
      "the old order was not slower, so this test cannot tell the two apart")
  }
  if (out.msUntilAllClickable > 200) {
    out.errors.push(
      `every page takes ${out.msUntilAllClickable}ms of engine time to become`
      + " clickable, which is long enough to be noticed")
  }
  return out
}
