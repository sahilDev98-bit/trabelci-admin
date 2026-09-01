// The strip of pages down the side, and the bar floating over the bottom.
//
// Both exist to answer "where am I, and how do I get somewhere else", so
// what is actually tested is that they and the document agree — in both
// directions. A strip that highlights page 3 while the reader is looking at
// page 5 is worse than no strip at all.
//
// The other thing checked here is what the strip COSTS. It draws every page
// through the same single worker that draws the page being edited, so a
// strip that redraws all fourteen thumbnails after every nudge would put a
// queue in front of the editing — the same fault that made dragging stutter
// before. The engine reports which page an edit touched, and only that one
// may be redrawn.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEngineWorkspace } from "./PdfEngineWorkspace"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface ViewerChromeTestResult {
  errors: string[]
  thumbnailCount: number
  pageCount: number
  /** Every thumbnail eventually gets a picture. */
  thumbnailsWithPicture: number
  /** Exactly one is marked as the page being looked at. */
  markedCurrent: number
  currentAfterScroll: number
  currentAfterThumbnailClick: number
  /** The bottom bar's own counter, which must say the same thing. */
  barLabel: string
  barLabelAfterNext: string
  /** Renders asked of the engine: first for all pages, then after an edit
   * that named ONE page. */
  rendersInitial: number
  rendersAfterOnePageEdit: number
  rendersAfterUnknownEdit: number
  /** Full page repaints caused by an edit that touched ONE page. Every page
   * the reader has scrolled past stays mounted, so without care each of
   * them redraws on every edit — hundreds of milliseconds of worker time
   * spent redrawing pages nothing happened to. */
  pageRendersAfterOnePageEdit: number
  pagesEverSeen: number
  /** Scrollbar gutters, in pixels: the browser's default, and the two the
   * editor styles. Different values are what proves the styling applied. */
  defaultScrollbarPx: number
  pageScrollbarPx: number
  /** Both scrollers carry the class, and the rule for it is loaded. */
  themedClassApplied: boolean
  scrollbarRuleLoaded: boolean
  prevDisabledOnFirstPage: boolean
  nextDisabledOnLastPage: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

const PAGE = { index: 0, widthPts: 595, heightPts: 794, rotation: 0 }

export async function runViewerChromeSelfTest(): Promise<ViewerChromeTestResult> {
  const out: ViewerChromeTestResult = {
    errors: [], thumbnailCount: 0, pageCount: 0, thumbnailsWithPicture: 0,
    markedCurrent: 0, currentAfterScroll: 0, currentAfterThumbnailClick: 0,
    barLabel: "", barLabelAfterNext: "",
    rendersInitial: 0, rendersAfterOnePageEdit: 0, rendersAfterUnknownEdit: 0,
    pageRendersAfterOnePageEdit: 0, pagesEverSeen: 0,
    defaultScrollbarPx: 0, pageScrollbarPx: 0,
    themedClassApplied: false, scrollbarRuleLoaded: false,
    prevDisabledOnFirstPage: false, nextDisabledOnLastPage: false,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  const PAGES = 6
  // Counted apart, because they are two different economies sharing one
  // worker: the strip draws tiny pages, the column draws the one being
  // read. A total would hide either fault behind the other.
  let thumbRenders = 0
  let pageRenders = 0
  const THUMBNAIL_SCALE_LIMIT = 0.5
  const noop = async () => {}
  const pages = Array.from({ length: PAGES }, (_, i) => ({ ...PAGE, index: i }))
  const loaded: Record<number, unknown> = {}
  for (let i = 0; i < PAGES; i++) loaded[i] = { loaded: true, lines: [], images: [], groups: [] }

  const base = {
    phase: "ready", error: null, downloadPercent: null,
    pages, docId: "test", busy: false,
    pageText: loaded, pageImages: loaded, pageVectors: loaded,
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    // Counted, and returns a real raster so the strip can make a picture.
    renderPage: async (_i: number, scale: number) => {
      if (scale < THUMBNAIL_SCALE_LIMIT) thumbRenders++
      else pageRenders++
      const width = Math.max(1, Math.round(PAGE.widthPts * scale))
      const height = Math.max(1, Math.round(PAGE.heightPts * scale))
      return { width, height, rgba: new ArrayBuffer(width * height * 4) }
    },
    renderPageRegion: async () => null,
    renderCleanPatch: async () => null,
    renderImagePreview: async () => null,
    editText: noop, moveText: async () => -1, moveTextToPage: async () => -1,
    moveImageToPage: async () => -1, removeText: noop,
    replaceImage: noop, removeImage: noop, setImageRect: async () => -1,
    removeVector: noop, replaceVector: noop,
    addTextOverlay: noop, addImageOverlay: noop, applyPagePlan: noop,
    save: async () => new Blob(),
  }

  const column = {
    contentMode: "text" as const, selection: null, onSelect: () => {},
    drag: null, onMoveStart: () => {}, originPatch: null, imagePreview: null,
    onEditLine: () => {}, onReplaceImage: () => {}, onReplaceVector: () => {},
    onDropOnImage: () => {}, onDropOnPage: () => {}, onTransformImage: () => {},
    onResizeText: () => {},
  }
  const toolbar = {
    contentMode: "text" as const, onToggleContentMode: () => {},
    onAddText: () => {}, onAddImage: () => {}, onOpenOrganizer: () => {},
    onEditSelectedText: () => {}, onReplaceSelectedImage: () => {},
    onReplaceSelectedVector: () => {}, onDeleteSelected: () => {},
    onStyleSelectedText: () => {}, onScaleSelectedText: () => {},
    onAlignSelectedText: () => {}, onTransformSelectedImage: () => {},
  }

  const render = (doc: UsePdfEngineDocumentResult) => root.render(
    createElement(PdfEngineWorkspace, {
      doc, documentName: "test.pdf", onExit: () => {}, thumbnailRailOpen: true,
    onDisplayWidthChange: () => {},
      column: column as never, toolbar: toolbar as never, selection: null,
    }))

  try {
    render({ ...base, revision: 0, lastChange: null } as unknown as UsePdfEngineDocumentResult)
    await wait(1200)

    const rail = host.querySelector<HTMLElement>("[data-pdf-thumbnail-rail]")
    const bar = host.querySelector<HTMLElement>("[data-pdf-viewport-bar]")
    const scroller = host.querySelector<HTMLElement>("[data-pdf-workspace] .overflow-auto")
    if (!rail || !bar || !scroller) {
      out.errors.push(
        `missing chrome: rail=${!!rail} bar=${!!bar} pages=${!!scroller}`)
      return out
    }

    const thumbs = () => Array.from(rail.querySelectorAll<HTMLButtonElement>("button"))
    out.pageCount = PAGES
    out.thumbnailCount = thumbs().length
    out.thumbnailsWithPicture = rail.querySelectorAll("img").length
    out.markedCurrent = rail.querySelectorAll('[aria-current="true"]').length
    out.rendersInitial = thumbRenders

    // ── the scrollbars are the app's, not the operating system's ──
    // Verified two ways, because neither is enough alone. The class being
    // on the element proves nothing if the rule was never written; the rule
    // existing proves nothing if it names a class no element carries.
    //
    // The gutter WIDTH is the real proof — a styled bar is narrower than
    // the browser's own — but it can only be taken where the browser draws
    // a bar that occupies space at all. Headless Chrome uses overlay
    // scrollbars and reports zero, so that check is made conditional rather
    // than deleted: on a machine with ordinary scrollbars it still runs.
    out.themedClassApplied = scroller.classList.contains("themed-scrollbar")
      && !!rail.querySelector(".themed-scrollbar")
    out.scrollbarRuleLoaded = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule) =>
          "selectorText" in rule
          && typeof (rule as CSSStyleRule).selectorText === "string"
          && (rule as CSSStyleRule).selectorText
            .includes(".themed-scrollbar::-webkit-scrollbar-thumb"))
      } catch {
        // A stylesheet from another origin cannot be read; none of ours are.
        return false
      }
    })

    const control = document.createElement("div")
    control.style.cssText = "position:fixed;top:-9999px;width:100px;height:100px;overflow-y:scroll"
    control.innerHTML = '<div style="height:400px"></div>'
    document.body.appendChild(control)
    out.defaultScrollbarPx = control.offsetWidth - control.clientWidth
    control.remove()
    out.pageScrollbarPx = scroller.offsetWidth - scroller.clientWidth

    const barText = () => (bar.textContent ?? "").replace(/\s+/g, " ").trim()
    out.barLabel = barText()

    // ── the bar's buttons ──
    const barButtons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))
    const prev = barButtons.find((b) => /previous/i.test(b.getAttribute("aria-label") ?? ""))
    const next = barButtons.find((b) => /next/i.test(b.getAttribute("aria-label") ?? ""))
    if (!prev || !next) {
      out.errors.push("the floating bar has no page buttons")
      return out
    }
    out.prevDisabledOnFirstPage = prev.disabled

    next.click()
    await wait(250)
    out.barLabelAfterNext = barText()

    // ── scrolling the document moves the strip's highlight ──
    const target = scroller.querySelector<HTMLElement>('[data-engine-page-index="3"]')
    if (target) {
      scroller.scrollTop += target.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
      await wait(250)
    }
    const currentIndex = () => thumbs()
      .findIndex((b) => b.getAttribute("aria-current") === "true") + 1
    out.currentAfterScroll = currentIndex()

    // ── and clicking the strip moves the document ──
    thumbs()[1]?.click()
    await wait(300)
    out.currentAfterThumbnailClick = currentIndex()

    // ── the last page: next must be spent ──
    for (let i = 0; i < PAGES + 2; i++) {
      next.click()
      await frame()
    }
    await wait(300)
    out.nextDisabledOnLastPage =
      Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => /next/i.test(b.getAttribute("aria-label") ?? ""))?.disabled ?? false

    // ── what the strip costs ──
    // An edit that names the page it touched may redraw THAT page and no
    // others, or the strip becomes a queue in front of the editing.
    thumbRenders = 0
    pageRenders = 0
    render({
      ...base, revision: 1,
      lastChange: { pageIndex: 2, rect: { left: 0, bottom: 0, right: 10, top: 10 }, revision: 1 },
    } as unknown as UsePdfEngineDocumentResult)
    await wait(700)
    out.rendersAfterOnePageEdit = thumbRenders
    out.pageRendersAfterOnePageEdit = pageRenders
    out.pagesEverSeen = host.querySelectorAll("[data-engine-page-index]").length

    // An edit that names no page has to redraw everything — there is no way
    // to know what moved. Included so the economy above is not mistaken for
    // the strip simply never updating.
    thumbRenders = 0
    render({
      ...base, revision: 2, lastChange: null,
    } as unknown as UsePdfEngineDocumentResult)
    await wait(1200)
    out.rendersAfterUnknownEdit = thumbRenders

    // ---- verdicts ----
    if (out.thumbnailCount !== PAGES) {
      out.errors.push(`the strip shows ${out.thumbnailCount} pages, the document has ${PAGES}`)
    }
    if (out.thumbnailsWithPicture !== PAGES) {
      out.errors.push(
        `${out.thumbnailsWithPicture} of ${PAGES} thumbnails drew a picture`)
    }
    if (out.markedCurrent !== 1) {
      out.errors.push(`${out.markedCurrent} thumbnails are marked as current; exactly 1 must be`)
    }
    if (!out.barLabel.includes(`1 / ${PAGES}`)) {
      out.errors.push(`the floating bar reads "${out.barLabel}", expected "1 / ${PAGES}"`)
    }
    if (!out.barLabelAfterNext.includes(`2 / ${PAGES}`)) {
      out.errors.push(`after Next the bar reads "${out.barLabelAfterNext}", expected page 2`)
    }
    if (out.currentAfterScroll !== 4) {
      out.errors.push(
        `scrolled to page 4, the strip highlights page ${out.currentAfterScroll}`)
    }
    if (out.currentAfterThumbnailClick !== 2) {
      out.errors.push(
        `clicked thumbnail 2, the document went to page ${out.currentAfterThumbnailClick}`)
    }
    if (!out.themedClassApplied) {
      out.errors.push("the page area or the strip is not using the themed scrollbar")
    }
    if (!out.scrollbarRuleLoaded) {
      out.errors.push("no themed-scrollbar rule is loaded, so the class styles nothing")
    }
    // Only where the browser draws a bar that takes up room; headless
    // Chrome's overlay scrollbars report zero for everything.
    if (out.defaultScrollbarPx > 0 && out.pageScrollbarPx === out.defaultScrollbarPx) {
      out.errors.push(
        `the page area's scrollbar is still the browser's own (${out.pageScrollbarPx}px)`)
    }
    if (!out.prevDisabledOnFirstPage) {
      out.errors.push("Previous is offered on the first page")
    }
    if (!out.nextDisabledOnLastPage) {
      out.errors.push("Next is still offered on the last page")
    }
    if (out.rendersInitial < PAGES) {
      out.errors.push(`only ${out.rendersInitial} renders for ${PAGES} thumbnails`)
    }
    if (out.rendersAfterOnePageEdit > 1) {
      out.errors.push(
        `an edit to one page redrew ${out.rendersAfterOnePageEdit} thumbnails`)
    }
    if (out.pagesEverSeen < 3) {
      out.errors.push(
        `only ${out.pagesEverSeen} pages are mounted, too few to show whether untouched`
        + " pages are being redrawn")
    }
    if (out.pageRendersAfterOnePageEdit > 1) {
      out.errors.push(
        `an edit to one page fully redrew ${out.pageRendersAfterOnePageEdit} pages —`
        + " pages nothing happened to are being redrawn")
    }
    if (out.rendersAfterUnknownEdit < PAGES) {
      out.errors.push(
        `an edit of unknown extent redrew only ${out.rendersAfterUnknownEdit} thumbnails,`
        + " so the strip can go stale")
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
