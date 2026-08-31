// Does the asset library actually put a logo on a page?
//
// Five claims, each with a control that has to fail for the proof to mean
// anything.
//
//   1. The shelf shows everything on it. Cheap, but it is what everything
//      below stands on. There is nothing to filter: the search box and
//      category chips were removed once the panel was in use, because a
//      couple of dozen tiles are all visible at once and the controls cost
//      two rows of chrome to solve a problem nobody had.
//
//   2. Dragging a tile marks the drag as carrying an asset — and the page can
//      tell WHILE THE POINTER IS STILL MOVING. This is the subtle one and the
//      reason this file exists: a browser refuses to hand over drag DATA
//      during dragover and will only list the drag's TYPES, so code that asks
//      "what is being dragged?" the obvious way gets nothing and the page
//      never lights up as a drop target. The control is a drag carrying
//      nothing, which must not light it up.
//
//   3. Dropping on a page reports the right asset at the right spot on the
//      page, in PDF points. A logo that lands somewhere other than where it
//      was dropped is the whole gesture wasted.
//
//   4. Dropping an asset onto an existing picture ADDS it on top rather than
//      replacing the picture — a logo belongs over a photo, not instead of
//      it. The control is a FILE dropped on the same picture, which must
//      still replace it: without that, simply deleting the replace path would
//      pass.
//
//   5. An SVG is converted before it is stored, so the library only ever holds
//      formats PDFium can embed — this is what makes a supplier's vector logo
//      usable. Driven by uploadSvgThroughPanel below and checked by the caller,
//      which is the only side that can see what actually went over the wire.
//
// The panel is mounted for real. Only the network is stubbed, and not by this
// file: the caller serves ASSET_FIXTURE from /pdf-assets. See run-asset-library.
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import i18n from "@/i18n"
import { PdfAssetPanel } from "./PdfAssetPanel"
import { PdfEnginePage } from "./PdfEnginePage"
import { PdfEngineWorkspace } from "./PdfEngineWorkspace"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"
import { ASSET_DRAG_MIME } from "./assetDrag"

/** What the caller must serve from GET /pdf-assets. Snake_case, because this
 * is the shape the API returns straight from Postgres. */
export const ASSET_FIXTURE = [
  {
    id: "1", name: "Varmora logo", category: "logo", supplier: "Varmora",
    file_url: "https://example.invalid/assets/varmora.png",
    mime_type: "image/png", width_px: 400, height_px: 200, file_size: 4096,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "2", name: "R11 slip rating", category: "icon", supplier: null,
    file_url: "https://example.invalid/assets/r11.png",
    mime_type: "image/png", width_px: 128, height_px: 128, file_size: 2048,
    created_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "4", name: "Supplier B logo", category: "logo", supplier: "Supplier B",
    file_url: "https://example.invalid/assets/supplier-b.png",
    mime_type: "image/png", width_px: 300, height_px: 100, file_size: 3072,
    created_at: "2026-01-04T00:00:00Z",
  },
  {
    id: "3", name: "NEW badge", category: "badge", supplier: null,
    file_url: "https://example.invalid/assets/new.png",
    mime_type: "image/png", width_px: 200, height_px: 80, file_size: 1024,
    created_at: "2026-01-03T00:00:00Z",
  },
]

export interface AssetLibraryTestResult {
  errors: string[]
  tilesShown: number
  /** Filing by supplier: the chooser and what it narrows to. */
  supplierOptions: string[]
  tilesForVarmora: number
  tilesForUnfiled: number
  tilesBackOnAll: number
  /** What a drag out of the panel is carrying. */
  dragTypes: string[]
  draggedAssetId: string
  /** Whether the page offered itself as a drop target during dragover. */
  pageLitUpForAsset: boolean
  /** Control: the same, for a drag carrying nothing. */
  pageLitUpForEmptyDrag: boolean
  /** What the drop reported. */
  droppedAssetId: string
  droppedXPts: number
  droppedYPts: number
  expectedXPts: number
  expectedYPts: number
  /** An asset dropped on a picture must ADD, never replace. */
  assetOnPictureWasAdded: boolean
  pictureOfferedItselfForAsset: boolean
  /** Control: a FILE on the same picture must still replace it. */
  fileReplacedImageIndex: number
  pictureOfferedItselfForFile: boolean
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(what: string, check: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await wait(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A real drag event carrying whatever the caller puts in it. Chromium can
 * construct a DataTransfer, which is what makes this measurable at all. */
function dragEvent(type: string, data: Record<string, string>, point?: { x: number; y: number }) {
  const dt = new DataTransfer()
  for (const [mime, value] of Object.entries(data)) dt.setData(mime, value)
  return new DragEvent(type, {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: point?.x ?? 0, clientY: point?.y ?? 0,
  })
}

export async function runAssetLibrarySelfTest(): Promise<AssetLibraryTestResult> {
  const out: AssetLibraryTestResult = {
    errors: [], tilesShown: 0,
    supplierOptions: [], tilesForVarmora: 0, tilesForUnfiled: 0, tilesBackOnAll: 0,
    dragTypes: [], draggedAssetId: "", pageLitUpForAsset: false,
    pageLitUpForEmptyDrag: false, droppedAssetId: "", droppedXPts: 0,
    droppedYPts: 0, expectedXPts: 0, expectedYPts: 0,
    assetOnPictureWasAdded: false, pictureOfferedItselfForAsset: false,
    fileReplacedImageIndex: -1, pictureOfferedItselfForFile: false,
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;display:flex"
  document.body.appendChild(host)
  const root = createRoot(host)
  await i18n.changeLanguage("en")

  try {
    // ── 1. The shelf ────────────────────────────────────────────────────
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root.render(createElement(QueryClientProvider, { client },
      createElement(PdfAssetPanel, { onPlaceAsset: () => {}, onClose: () => {} })))

    await until("the asset panel", () => !!document.querySelector("[data-pdf-asset-panel]"))
    await until("the tiles", () => document.querySelectorAll("[data-pdf-asset-tile]").length > 0)
    const tiles = () => Array.from(document.querySelectorAll<HTMLElement>("[data-pdf-asset-tile]"))
    out.tilesShown = tiles().length
    if (out.tilesShown !== ASSET_FIXTURE.length) {
      out.errors.push(`the shelf shows ${out.tilesShown} of ${ASSET_FIXTURE.length} assets`)
    }

    // ── 1b. Filing by supplier ──────────────────────────────────────────
    //
    // The brief asks for assets "organized by supplier/brand" — Varmora's
    // things together, Supplier B's together, and the ones belonging to
    // nobody (an R11 icon, a NEW badge) reachable on their own.
    const chooser = document.querySelector<HTMLSelectElement>("[data-pdf-asset-supplier]")
    if (!chooser) {
      out.errors.push("no supplier chooser, with two suppliers on the shelf")
    } else {
      out.supplierOptions = Array.from(chooser.options).map((o) => o.textContent?.trim() ?? "")

      const choose = async (value: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype, "value")?.set
        setter?.call(chooser, value)
        chooser.dispatchEvent(new Event("change", { bubbles: true }))
        await wait(80)
      }

      await choose("Varmora")
      out.tilesForVarmora = tiles().length
      await choose("__unfiled__")
      out.tilesForUnfiled = tiles().length
      await choose("")
      out.tilesBackOnAll = tiles().length

      if (out.tilesForVarmora !== 1) {
        out.errors.push(`Varmora's drawer holds ${out.tilesForVarmora} assets, expected 1`)
      }
      if (out.tilesForUnfiled !== 2) {
        out.errors.push(`the no-supplier drawer holds ${out.tilesForUnfiled} assets, expected 2`)
      }
      // The control for the whole mechanism: choosing a drawer must show
      // FEWER than everything, or "filtering" is doing nothing at all.
      if (out.tilesForVarmora >= out.tilesShown) {
        out.errors.push("choosing a supplier did not narrow the shelf")
      }
      if (out.tilesBackOnAll !== out.tilesShown) {
        out.errors.push(
          `going back to all suppliers showed ${out.tilesBackOnAll} of ${out.tilesShown}`)
      }
    }

    // ── 2. What a drag out of the panel carries ─────────────────────────
    const tile = tiles().find((el) => el.dataset.pdfAssetTile === "1")
    if (!tile) throw new Error("the Varmora tile is not on the shelf")
    const start = dragEvent("dragstart", {})
    tile.dispatchEvent(start)
    const dt = start.dataTransfer
    out.dragTypes = Array.from(dt?.types ?? [])
    out.draggedAssetId = dt?.getData(ASSET_DRAG_MIME) ?? ""
    if (!out.dragTypes.includes(ASSET_DRAG_MIME)) {
      out.errors.push(
        "the drag does not list the asset type, so a page cannot tell what is"
        + " coming while the pointer is still moving")
    }
    if (out.draggedAssetId !== "1") {
      out.errors.push(`the drag carries "${out.draggedAssetId}", expected the asset's id`)
    }

    // ── 3 & 4. The page on the receiving end ────────────────────────────
    root.unmount()
    host.remove()
    return await measurePageDrops(out)
  } catch (err) {
    out.errors.push(err instanceof Error ? err.message : String(err))
    try { root.unmount() } catch { /* already gone */ }
    host.remove()
    return out
  }
}

/** The page half: does a dropped asset arrive where it was dropped? */
async function measurePageDrops(out: AssetLibraryTestResult): Promise<AssetLibraryTestResult> {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0"
  document.body.appendChild(host)
  const root = createRoot(host)

  const page = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }
  const DISPLAY_WIDTH = 600 // 1pt = 1px, so the arithmetic is checkable by eye
  const IMAGE = {
    imageIndex: 0,
    bbox: { left: 100, bottom: 600, right: 300, top: 700 },
    width: 200, height: 100,
    pixelWidth: 400, pixelHeight: 200,
    hasClipPath: false, rotationDeg: 0, filters: [] as string[],
  }

  try {
    root.render(createElement(PdfEnginePage, {
      page,
      pageIndex: 0,
      // Nothing is locked in these measurements.
      locks: new Set<string>(),
    alsoSelected: [],
    cropping: null,
    onCropCancel: () => {},
    onCropCommit: () => {},
      displayWidth: DISPLAY_WIDTH,
      text: { loaded: true, lines: [] },
      images: { loaded: true, images: [IMAGE] },
      vectors: { loaded: true, groups: [] },
      contentMode: "images",
      revision: 0,
      lastChange: null,
      renderPage: async () => null,
      renderPageRegion: async () => null,
      loadPageText: async () => {},
      loadPageImages: async () => {},
      loadPageVectors: async () => {},
      onReplaceVector: () => {},
      onSelectLine: () => {},
      onReplaceImage: () => {},
      onDropOnImage: (_pageIndex: number, imageIndex: number, file: File) => {
        out.fileReplacedImageIndex = imageIndex
        void file
      },
      onDropOnPage: () => {
        // Reaching the FILE handler with an ASSET means the asset was not
        // recognised and the page fell through to "dragged off the desktop".
        out.errors.push("an asset drop was handled as a plain file drop")
      },
      onDropAssetOnPage: (_pageIndex: number, assetId: string, xPts: number, yFromTopPts: number) => {
        out.droppedAssetId = assetId
        out.droppedXPts = Math.round(xPts)
        out.droppedYPts = Math.round(yFromTopPts)
      },
      onTransformImage: () => {},
      onTransformVector: () => {},
      selection: null,
      onSelect: () => {},
      onMoveStart: () => {},
      draggingSlot: null,
      dropTargetPage: false,
      imagePreviewUrl: null,
      originPatchUrl: null,
      onResizeText: () => {},
    }))

    await until("the page surface", () => !!document.querySelector("[data-engine-page-index]"))
    const surface = document.querySelector<HTMLElement>("[data-engine-page-index]")
    if (!surface) throw new Error("the page did not mount")
    const box = surface.getBoundingClientRect()

    // Does it offer itself as a drop target while the pointer is moving? The
    // browser will not release drag DATA during dragover, only the type list,
    // so this is the check that catches reading the payload too early.
    const over = dragEvent("dragover", { [ASSET_DRAG_MIME]: "1" },
      { x: box.left + 10, y: box.top + 10 })
    surface.dispatchEvent(over)
    await wait(30)
    out.pageLitUpForAsset = over.defaultPrevented

    // The control. A drag carrying nothing this page accepts must be left
    // alone — otherwise the check above would pass for any drag at all.
    const emptyOver = dragEvent("dragover", { "text/plain": "hello" },
      { x: box.left + 10, y: box.top + 10 })
    surface.dispatchEvent(emptyOver)
    await wait(30)
    out.pageLitUpForEmptyDrag = emptyOver.defaultPrevented

    if (!out.pageLitUpForAsset) {
      out.errors.push("the page did not accept an asset drag while it was moving")
    }
    if (out.pageLitUpForEmptyDrag) {
      out.errors.push(
        "the page accepted a drag carrying nothing it can use — the drop-target"
        + " check is not actually testing anything")
    }

    // Dropped on bare paper, 180px right and 240px down from the top-left.
    // At 1pt = 1px that is 180pt and 240pt from the page's top-left corner.
    out.expectedXPts = 180
    out.expectedYPts = 240
    surface.dispatchEvent(dragEvent("drop", { [ASSET_DRAG_MIME]: "1" }, {
      x: box.left + out.expectedXPts,
      y: box.top + out.expectedYPts,
    }))
    await wait(60)

    if (out.droppedAssetId !== "1") {
      out.errors.push(`the drop reported asset "${out.droppedAssetId}", expected "1"`)
    }
    if (Math.abs(out.droppedXPts - out.expectedXPts) > 1
      || Math.abs(out.droppedYPts - out.expectedYPts) > 1) {
      out.errors.push(
        `the drop landed at ${out.droppedXPts},${out.droppedYPts}pt but was released`
        + ` at ${out.expectedXPts},${out.expectedYPts}pt`)
    }

    // ── Dropped ON an existing picture ──────────────────────────────
    //
    // An asset must ADD here, not replace. A logo, a badge, a certification
    // mark belongs on TOP of a photo — dropping one onto a photo used to
    // destroy the photo, which is never what dragging a logo over an image
    // was meant to do. A file dragged off the desktop still replaces, and
    // that difference is the whole point of this block.
    const slot = document.querySelector<HTMLElement>("[data-pdf-image-slot]")
    if (!slot) {
      out.errors.push("the page shows no image slot to drop onto")
      return out
    }

    // While the pointer is over the picture, the PICTURE must not offer
    // itself — the page should. That is what makes it visible before letting
    // go that nothing is about to be overwritten.
    //
    // Measured from what the slot LOOKS like, not from defaultPrevented. The
    // event bubbles from the slot up to the page, and the page legitimately
    // prevents it, so defaultPrevented is true no matter which of the two
    // accepted the drag — it cannot tell them apart. The highlight can: it is
    // set only by the slot's own handler, and it is also the thing the user
    // actually sees.
    const slotIsHighlighted = () =>
      (slot.className.includes("ring-emerald-500")
        || slot.querySelector('[class*="ring-emerald-500"]') !== null)

    slot.dispatchEvent(dragEvent("dragenter", { [ASSET_DRAG_MIME]: "3" },
      { x: box.left + 200, y: box.top + 150 }))
    slot.dispatchEvent(dragEvent("dragover", { [ASSET_DRAG_MIME]: "3" },
      { x: box.left + 200, y: box.top + 150 }))
    await wait(60)
    out.pictureOfferedItselfForAsset = slotIsHighlighted()

    out.droppedAssetId = ""
    out.droppedXPts = 0
    out.droppedYPts = 0
    const onPictureX = 200
    const onPictureY = 150
    slot.dispatchEvent(dragEvent("drop", { [ASSET_DRAG_MIME]: "3" },
      { x: box.left + onPictureX, y: box.top + onPictureY }))
    await wait(60)

    out.assetOnPictureWasAdded = out.droppedAssetId === "3"
    if (!out.assetOnPictureWasAdded) {
      out.errors.push(
        `dropping an asset on a picture reported "${out.droppedAssetId}" as an`
        + ' addition, expected "3" — it did not add')
    }
    if (out.fileReplacedImageIndex !== -1) {
      out.errors.push("dropping an asset on a picture REPLACED the picture")
    }
    if (Math.abs(out.droppedXPts - onPictureX) > 1
      || Math.abs(out.droppedYPts - onPictureY) > 1) {
      out.errors.push(
        `the asset landed at ${out.droppedXPts},${out.droppedYPts}pt but was`
        + ` released over the picture at ${onPictureX},${onPictureY}pt`)
    }

    // ── The control: a FILE on the same picture still replaces it ───────
    //
    // Without this, deleting the replace path entirely would pass every check
    // above. Swapping a photo for a better one is behaviour that was working
    // and must not have been broken by making assets behave differently.
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }))
    const fileDragEvent = (type: string) => new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: box.left + onPictureX, clientY: box.top + onPictureY,
    })
    slot.dispatchEvent(fileDragEvent("dragenter"))
    slot.dispatchEvent(fileDragEvent("dragover"))
    await wait(60)
    // Read the same way as above, so the two answers are comparable. This is
    // the control for that measurement as much as for the behaviour: if a
    // file does not highlight the picture either, the check is simply blind.
    out.pictureOfferedItselfForFile = slotIsHighlighted()

    slot.dispatchEvent(fileDragEvent("drop"))
    await wait(60)

    if (out.fileReplacedImageIndex !== 0) {
      out.errors.push(
        "a FILE dropped on a picture no longer replaces it — the asset change"
        + " broke the behaviour it was supposed to leave alone")
    }
    if (!out.pictureOfferedItselfForFile) {
      out.errors.push("the picture no longer offers itself as a target for a file")
    }
    if (out.pictureOfferedItselfForAsset) {
      out.errors.push(
        "the picture offered itself for an ASSET, so the hint while dragging"
        + " still says it is about to be replaced")
    }

    return out
  } catch (err) {
    out.errors.push(err instanceof Error ? err.message : String(err))
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}


/**
 * Puts an SVG through the panel's own upload path and returns once the request
 * has been made.
 *
 * The check that matters happens on the OTHER side of this call: the caller
 * intercepts the upload and looks at the bytes. Nothing in the browser can see
 * what was sent as clearly as the thing receiving it, and asserting here on
 * what we believe we sent would only be re-checking our own arithmetic.
 */
export async function uploadSvgThroughPanel(): Promise<{ chosenBytes: number; supplierTyped: string }> {
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;display:flex"
  document.body.appendChild(host)
  const root = createRoot(host)
  await i18n.changeLanguage("en")

  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root.render(createElement(QueryClientProvider, { client },
      createElement(PdfAssetPanel, { onPlaceAsset: () => {}, onClose: () => {} })))
    await until("the asset panel", () => !!document.querySelector("[data-pdf-asset-panel]"))

    // A supplier logo the way suppliers actually ship them.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">'
      + '<circle cx="30" cy="30" r="22" fill="#e11d48"/></svg>'
    const file = new File([svg], "varmora-logo.svg", { type: "image/svg+xml" })

    const input = document.querySelector<HTMLInputElement>("[data-pdf-asset-panel] input[type='file']")
    if (!input) throw new Error("the panel has no file input")
    // A FileList cannot be constructed directly; a DataTransfer is the only
    // way to put a File onto an input from script.
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event("change", { bubbles: true }))

    // Choosing files no longer uploads them: the panel asks whose they are
    // first. The dialog is rendered in a portal at the end of the document,
    // so it is found from `document` rather than from inside the panel.
    await until("the supplier dialog", () => !!document.getElementById("asset-supplier"))
    const supplierField = document.getElementById("asset-supplier") as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value")?.set
    setter?.call(supplierField, "Varmora")
    supplierField.dispatchEvent(new Event("input", { bubbles: true }))
    await wait(60)

    const confirm = Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Add")
    if (!confirm) throw new Error("the supplier dialog has no Add button")
    confirm.click()

    // Waits for the upload to have been ATTEMPTED, not to have succeeded —
    // the caller decides what the server says.
    await wait(1500)
    return { chosenBytes: file.size, supplierTyped: "Varmora" }
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * Puts the asset panel on screen and leaves it there, for looking at.
 *
 * The checks above are blind to LAYOUT, and layout under Hebrew is where this
 * editor has gone wrong before — a border or an icon pinned to the physical
 * left stays on the left when everything around it flips. The caller sets the
 * document direction and takes a picture.
 */
let inspection: { root: ReturnType<typeof createRoot>; host: HTMLElement } | null = null

export async function showAssetPanel(language: "en" | "he"): Promise<void> {
  // Torn down first: two mounts would leave the older panel on top, swallowing
  // the clicks meant for the newer one.
  inspection?.root.unmount()
  inspection?.host.remove()
  await i18n.changeLanguage(language)

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;display:flex;background:var(--muted,#f4f4f5)"
  document.body.appendChild(host)
  const root = createRoot(host)
  inspection = { root, host }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(createElement(QueryClientProvider, { client },
    createElement(PdfAssetPanel, { onPlaceAsset: () => {}, onClose: () => {} })))
  await until("the asset panel", () => !!document.querySelector("[data-pdf-asset-panel]"))
}

/**
 * Mounts the whole workspace — thumbnails, page area, asset panel — for
 * measuring how a drag behaves against a document taller than the window.
 *
 * The panel and the pages have to be in one layout for this: what is being
 * measured is dragging OUT of the panel and ACROSS the page area, and a panel
 * mounted on its own has no page area to drag across.
 */
export async function showWorkspaceForDrag(pageCount = 12): Promise<void> {
  inspection?.root.unmount()
  inspection?.host.remove()
  await i18n.changeLanguage("en")

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0"
  document.body.appendChild(host)
  const root = createRoot(host)
  inspection = { root, host }

  const page = { index: 0, widthPts: 595, heightPts: 794, rotation: 0 }
  const pages = Array.from({ length: pageCount }, (_, i) => ({ ...page, index: i }))
  const empty = Object.fromEntries(pages.map((_, i) => [i, { loaded: true, lines: [], images: [], groups: [] }]))
  const noop = async () => {}
  const doc = {
    phase: "ready", error: null, downloadPercent: null,
    pages, docId: "t", revision: 0, busy: false,
    pageText: Object.fromEntries(pages.map((_, i) => [i, { loaded: true, lines: [] }])),
    pageImages: Object.fromEntries(pages.map((_, i) => [i, { loaded: true, images: [] }])),
    pageVectors: Object.fromEntries(pages.map((_, i) => [i, { loaded: true, groups: [] }])),
    loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    renderPage: async () => null, renderPageRegion: async () => null,
    renderCleanPatch: async () => null, renderImagePreview: async () => null,
    lastChange: null, save: async () => new Blob(),
  } as unknown as UsePdfEngineDocumentResult
  void empty

  const column = {
    contentMode: "text" as const, selection: null, onSelect: () => {},
    drag: null, onMoveStart: () => {}, originPatch: null, imagePreview: null,
    onEditLine: () => {}, onReplaceImage: () => {}, onReplaceVector: () => {},
    onDropOnImage: () => {}, onDropOnPage: () => {}, onDropAssetOnPage: () => {},
    locks: new Set<string>(),
    alsoSelected: [],
    cropping: null,
    onCropCancel: () => {},
    onCropCommit: () => {},
    onTransformText: () => {}, onTransformImage: () => {}, onTransformVector: () => {}, onResizeText: () => {},
  }
  const toolbar = {
    selection: null, contentMode: "text" as const, onToggleContentMode: () => {},
    onAddText: () => {}, onAddImage: () => {},
    assetPanelOpen: true, onToggleAssetPanel: () => {},
    canUndo: false, canRedo: false, onUndo: () => {}, onRedo: () => {},
    onAddPage: () => {}, selectionLocked: false, onToggleLock: () => {},
      onDuplicate: () => {},
      cropping: false, onToggleCrop: () => {}, onSetFont: () => {},
    layersPanelOpen: false, onToggleLayersPanel: () => {},
    productPanelOpen: false, onToggleProductPanel: () => {},
    onOpenOrganizer: () => {}, onEditSelectedText: () => {},
    onReplaceSelectedImage: () => {}, onReplaceSelectedVector: () => {},
    onDeleteSelected: () => {}, textStyle: null, onToggleBold: () => {},
    onToggleItalic: () => {}, onTextColor: () => {}, onScaleText: () => {},
    onAlignText: () => {}, onTransformText: () => {}, onTransformImage: () => {}, onTransformVector: () => {},
    onDeselect: () => {}, onDownload: () => {}, downloading: false, busy: false,
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root.render(createElement(QueryClientProvider, { client },
    createElement(PdfEngineWorkspace, {
      doc, documentName: "drag test", onExit: () => {},
      onDisplayWidthChange: () => {}, selection: null, column, toolbar,
      leftPanel: createElement(PdfAssetPanel, { onPlaceAsset: () => {}, onClose: () => {} }),
    })))
  await until("the workspace", () => !!document.querySelector("[data-pdf-workspace]"))
  await until("the pages", () => document.querySelectorAll("[data-engine-page-index]").length > 1)
}
