/**
 * Dev-only self test for full screen: does the page actually fit, and does
 * the toolbar follow the selection?
 *
 * The claim that justified building this is arithmetic, so it is checked as
 * arithmetic: filling the screen with the WHOLE page makes small text
 * SMALLER than the windowed view, and only zoom fixes it. If that were
 * wrong, the whole feature would be pointed the wrong way.
 *
 * The shell itself is then mounted for real, because "does it fit" is a
 * layout question no unit check can answer.
 *
 * Driven by scripts/pdf-engine-fullscreen-test.mjs.
 */
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEngineFullscreen } from "./PdfEngineFullscreen"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"
import {
  pageWidthForZoom, zoomLevelOf, stepZoom, zoomToFitSlot, PX_PER_PT,
} from "./zoom"

export interface FullscreenTestResult {
  errors: string[]
  /** The arithmetic behind the whole feature. */
  maths: Record<string, number>
  /** The mounted shell's real geometry. */
  overlayCoversViewport: boolean
  hasToolbar: boolean
  pageWidthFitWidth: number
  pageFitsWidth: boolean
  pageWidthFitPage: number
  wholePageVisible: boolean
  /** The toolbar changes with what is selected. */
  toolsWhenNothingSelected: number
  toolsWhenTextSelected: number
  toolbarChangedWithSelection: boolean
  /** The document tools must SURVIVE a selection. Selecting something used
   * to replace them, so adding an image — which selects it — made "Add
   * image" vanish with no obvious way back. */
  addToolsPresentWhenNothingSelected: boolean
  addToolsPresentWhenTextSelected: boolean
  addToolsPresentWhenImageSelected: boolean
  /** And the selection's own tools appear alongside, not instead. */
  selectionToolsAppear: boolean
  hasZoomControl: boolean
  /** Highest number of elements claiming to be the SAME page. Must be 1:
   * every drag resolves "where is page N?" through the DOM and takes the
   * first answer, so a second hidden copy silently hijacks the gesture. */
  maxElementsPerPage: number
  /** The same count with a second column deliberately mounted, proving this
   * check would actually catch the fault rather than passing regardless. */
  maxElementsPerPageWithDuplicate: number
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A4-ish, matching the real catalogue: 595 x 794pt. */
const PAGE = { index: 0, widthPts: 595, heightPts: 794, rotation: 0 }

/** Enough of a document for the shell; nothing here touches the engine. */
function fakeDoc(): UsePdfEngineDocumentResult {
  const noop = async () => {}
  return {
    phase: "ready", error: null, downloadPercent: null,
    pages: [PAGE, { ...PAGE, index: 1 }],
    docId: "test", revision: 0, busy: false,
    pageText: { 0: { loaded: true, lines: [] }, 1: { loaded: true, lines: [] } },
    pageImages: { 0: { loaded: true, images: [] }, 1: { loaded: true, images: [] } },
    pageVectors: { 0: { loaded: true, groups: [] }, 1: { loaded: true, groups: [] } },
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    renderPage: async () => null,
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

export async function runFullscreenSelfTest(): Promise<FullscreenTestResult> {
  const out: FullscreenTestResult = {
    errors: [], maths: {},
    overlayCoversViewport: false, hasToolbar: false,
    pageWidthFitWidth: 0, pageFitsWidth: false,
    pageWidthFitPage: 0, wholePageVisible: false,
    toolsWhenNothingSelected: 0, toolsWhenTextSelected: 0,
    toolbarChangedWithSelection: false, hasZoomControl: false,
    addToolsPresentWhenNothingSelected: false,
    addToolsPresentWhenTextSelected: false,
    addToolsPresentWhenImageSelected: false,
    selectionToolsAppear: false,
    maxElementsPerPage: 0, maxElementsPerPageWithDuplicate: 0,
  }

  // ── 1. the arithmetic the feature rests on ──
  // A laptop screen, minus browser chrome and the toolbar.
  const screen = { width: 1920, height: 1080 }
  const space = { width: screen.width - 32, height: screen.height - 140 }

  const fitWidth = pageWidthForZoom({ kind: "fit-width" }, PAGE, space)
  const fitPage = pageWidthForZoom({ kind: "fit-page" }, PAGE, space)
  const windowedToday = 1056 // the measured column in the windowed view

  out.maths = {
    windowedZoom: Number(zoomLevelOf(windowedToday, PAGE).toFixed(2)),
    fitWidthZoom: Number(zoomLevelOf(fitWidth, PAGE).toFixed(2)),
    fitPageZoom: Number(zoomLevelOf(fitPage, PAGE).toFixed(2)),
    // What a 6pt caption actually measures on screen, in pixels.
    sixPtWindowed: Number((6 * PX_PER_PT * zoomLevelOf(windowedToday, PAGE)).toFixed(1)),
    sixPtFitPage: Number((6 * PX_PER_PT * zoomLevelOf(fitPage, PAGE)).toFixed(1)),
    sixPtFitWidth: Number((6 * PX_PER_PT * zoomLevelOf(fitWidth, PAGE)).toFixed(1)),
    // And at the zoom "zoom to selection" would pick for a 3pt line.
    zoomForThreePt: Number(zoomToFitSlot(3).toFixed(2)),
    threePtZoomed: Number((3 * PX_PER_PT * zoomToFitSlot(3)).toFixed(1)),
  }

  // The counter-intuitive claim: fit-page is WORSE than the windowed view.
  if (!(out.maths.fitPageZoom < out.maths.windowedZoom)) {
    out.errors.push(
      "fit-page was expected to be smaller than the windowed view — the premise for adding zoom",
    )
  }
  // And fit-width is the one that helps.
  if (!(out.maths.fitWidthZoom > out.maths.windowedZoom)) {
    out.errors.push("fit-width should be larger than the windowed view")
  }
  // Zooming to a 3pt line must actually make it readable.
  if (out.maths.threePtZoomed < 16) {
    out.errors.push(`zooming to a 3pt line gives only ${out.maths.threePtZoomed}px — still unreadable`)
  }
  // The +/- steps must move.
  if (stepZoom(1, 1) <= 1 || stepZoom(1, -1) >= 1) {
    out.errors.push("the zoom steps do not move up and down")
  }

  // ── 2. the shell, mounted for real ──
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    const doc = fakeDoc()
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
      onDeselect: () => {},
      onDownload: () => {},
      downloading: false,
      busy: false,
      selection: null,
    }

    const mount = (selection: FullscreenTestResult extends never ? never : Parameters<
      typeof PdfEngineFullscreen
    >[0]["selection"]) => root.render(createElement(PdfEngineFullscreen, {
      doc,
      documentName: "REFIN_CATALOGO",
      onExit: () => {},
      onDisplayWidthChange: () => {},
      selection,
      column: { ...column, selection },
      toolbar: { ...toolbar, selection },
    }))

    mount(null)
    await wait(500)

    const overlay = document.querySelector<HTMLElement>("[data-pdf-fullscreen]")
    if (!overlay) { out.errors.push("the full-screen shell did not mount"); return out }
    const overlayRect = overlay.getBoundingClientRect()
    out.overlayCoversViewport =
      Math.abs(overlayRect.width - window.innerWidth) <= 2
      && Math.abs(overlayRect.height - window.innerHeight) <= 2
    if (!out.overlayCoversViewport) {
      out.errors.push(
        `the shell does not fill the screen: ${Math.round(overlayRect.width)}x${Math.round(overlayRect.height)} `
        + `vs ${window.innerWidth}x${window.innerHeight}`,
      )
    }

    const toolbarEl = document.querySelector<HTMLElement>("[data-pdf-toolbar]")
    out.hasToolbar = !!toolbarEl
    if (!toolbarEl) out.errors.push("no toolbar in full screen")
    out.hasZoomControl = !!document.querySelector("[data-pdf-toolbar] select")
    if (!out.hasZoomControl) out.errors.push("no zoom control in the toolbar")

    // Fit width is the default: the paper should use the screen's width.
    const surface = overlay.querySelector<HTMLElement>("[data-engine-page-index]")
    if (!surface) {
      out.errors.push("no page rendered in full screen")
    } else {
      const pageRect = surface.getBoundingClientRect()
      out.pageWidthFitWidth = Math.round(pageRect.width)
      const area = overlay.querySelector<HTMLElement>(".overflow-auto")
      const areaWidth = area ? area.clientWidth - 32 : 0
      out.pageFitsWidth = Math.abs(pageRect.width - areaWidth) <= 4
      if (!out.pageFitsWidth) {
        out.errors.push(
          `fit-width did not fill the area: page ${Math.round(pageRect.width)}px in ${areaWidth}px`,
        )
      }
    }

    /** Are the always-available document tools on screen? */
    const addToolsPresent = () => {
      const labels = Array.from(document.querySelectorAll("[data-pdf-toolbar] button"))
        .map((b) => b.getAttribute("aria-label") ?? "")
      return labels.some((l) => /add text/i.test(l)) && labels.some((l) => /add image/i.test(l))
    }

    out.toolsWhenNothingSelected = document.querySelectorAll("[data-pdf-toolbar] button").length
    out.addToolsPresentWhenNothingSelected = addToolsPresent()

    mount({ pageIndex: 0, kind: "text", index: 0 })
    await wait(300)
    out.toolsWhenTextSelected = document.querySelectorAll("[data-pdf-toolbar] button").length
    out.addToolsPresentWhenTextSelected = addToolsPresent()
    out.selectionToolsAppear = !!document.querySelector("[data-pdf-toolbar-selection]")
    // Selecting must ADD, never replace: more buttons, not different ones.
    out.toolbarChangedWithSelection =
      out.toolsWhenTextSelected > out.toolsWhenNothingSelected

    mount({ pageIndex: 0, kind: "image", index: 0 })
    await wait(300)
    out.addToolsPresentWhenImageSelected = addToolsPresent()

    if (!out.addToolsPresentWhenNothingSelected) {
      out.errors.push("Add text / Add image are missing with nothing selected")
    }
    if (!out.addToolsPresentWhenTextSelected || !out.addToolsPresentWhenImageSelected) {
      out.errors.push(
        "Add text / Add image disappear once something is selected — after adding an "
        + "image, which selects it, there would be no way to add another",
      )
    }
    if (!out.selectionToolsAppear) {
      out.errors.push("no selection tools appeared for a selected item")
    }
    if (!out.toolbarChangedWithSelection) {
      out.errors.push("selecting something added no tools at all")
    }

    // ── exactly one element per page ──
    const countPerPage = () => {
      const tally = new Map<string, number>()
      for (const el of document.querySelectorAll<HTMLElement>("[data-engine-page-index]")) {
        const i = el.dataset.enginePageIndex ?? "?"
        tally.set(i, (tally.get(i) ?? 0) + 1)
      }
      return Math.max(0, ...tally.values())
    }
    out.maxElementsPerPage = countPerPage()
    if (out.maxElementsPerPage > 1) {
      out.errors.push(
        `${out.maxElementsPerPage} elements claim to be the same page — a drag would `
        + "measure whichever came first in the DOM, not the one on screen",
      )
    }

    // Control: with a second column deliberately present the count MUST go
    // up, or this check proves nothing about the real arrangement.
    const decoy = document.createElement("div")
    decoy.innerHTML = '<div data-engine-page-index="0"></div><div data-engine-page-index="1"></div>'
    document.body.appendChild(decoy)
    out.maxElementsPerPageWithDuplicate = countPerPage()
    decoy.remove()
    if (out.maxElementsPerPageWithDuplicate <= out.maxElementsPerPage) {
      out.errors.push("the duplicate-page check does not actually detect duplicates")
    }

    // Fit page: the WHOLE page has to be visible at once.
    out.pageWidthFitPage = Math.round(fitPage)
    out.wholePageVisible = (fitPage * PAGE.heightPts) / PAGE.widthPts <= space.height + 1
    if (!out.wholePageVisible) out.errors.push("fit-page does not show the whole page")

    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
