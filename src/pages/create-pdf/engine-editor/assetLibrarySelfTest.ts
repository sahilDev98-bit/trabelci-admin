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
//   4. Dropping onto an existing picture replaces THAT picture rather than
//      adding a second one — how a template's placeholder logo gets swapped.
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
    id: "3", name: "NEW badge", category: "badge", supplier: null,
    file_url: "https://example.invalid/assets/new.png",
    mime_type: "image/png", width_px: 200, height_px: 80, file_size: 1024,
    created_at: "2026-01-03T00:00:00Z",
  },
]

export interface AssetLibraryTestResult {
  errors: string[]
  tilesShown: number
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
  /** Dropping onto a picture must replace that picture, not add one. */
  droppedOnImageIndex: number
  droppedOnImageAssetId: string
  addedInsteadOfReplaced: boolean
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
    dragTypes: [], draggedAssetId: "", pageLitUpForAsset: false,
    pageLitUpForEmptyDrag: false, droppedAssetId: "", droppedXPts: 0,
    droppedYPts: 0, expectedXPts: 0, expectedYPts: 0,
    droppedOnImageIndex: -1, droppedOnImageAssetId: "", addedInsteadOfReplaced: false,
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
      onDropOnImage: () => {},
      onDropOnPage: () => {
        // Reaching the FILE handler means the asset was not recognised and
        // the page fell through to "an image dragged off the desktop".
        out.errors.push("an asset drop was handled as a plain file drop")
      },
      onDropAssetOnPage: (_pageIndex: number, assetId: string, xPts: number, yFromTopPts: number) => {
        out.droppedAssetId = assetId
        out.droppedXPts = Math.round(xPts)
        out.droppedYPts = Math.round(yFromTopPts)
      },
      onDropAssetOnImage: (_pageIndex: number, imageIndex: number, assetId: string) => {
        out.droppedOnImageIndex = imageIndex
        out.droppedOnImageAssetId = assetId
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

    // Dropped ON the picture: that slot is replaced, and the page-level
    // handler must NOT also fire, or one gesture would both swap the logo and
    // add a second copy of it.
    const before = out.droppedAssetId
    out.droppedAssetId = ""
    const slot = document.querySelector<HTMLElement>("[data-pdf-image-slot]")
      ?? document.querySelector<HTMLElement>("[data-pdf-image-slot='0']")
    if (!slot) {
      out.errors.push("the page shows no image slot to drop onto")
    } else {
      slot.dispatchEvent(dragEvent("drop", { [ASSET_DRAG_MIME]: "3" }, {
        x: box.left + 200, y: box.top + 150,
      }))
      await wait(60)
      out.addedInsteadOfReplaced = out.droppedAssetId !== ""
      if (out.droppedOnImageAssetId !== "3") {
        out.errors.push(
          `dropping on a picture reported "${out.droppedOnImageAssetId}", expected "3"`)
      }
      if (out.droppedOnImageIndex !== 0) {
        out.errors.push(`the wrong picture was targeted: index ${out.droppedOnImageIndex}`)
      }
      if (out.addedInsteadOfReplaced) {
        out.errors.push("dropping onto a picture ALSO added a new one")
      }
    }
    void before

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
export async function uploadSvgThroughPanel(): Promise<{ chosenBytes: number }> {
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

    // Waits for the upload to have been ATTEMPTED, not to have succeeded —
    // the caller decides what the server says.
    await wait(1500)
    return { chosenBytes: file.size }
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
