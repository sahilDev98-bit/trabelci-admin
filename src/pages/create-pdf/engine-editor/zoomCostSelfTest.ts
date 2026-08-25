// How expensive is it to redraw the page column at a new width?
//
// This decides how wheel-zoom has to be built. Zooming changes the width
// every page is drawn at, and that width reaches every slot on every page —
// a caption's box is positioned by multiplying its PDF coordinates by the
// current scale, so a new width re-renders all of them. A real catalogue
// page carries a couple of hundred slots and the pages you have scrolled
// past stay mounted, so "all of them" can be well over a thousand.
//
// A wheel fires about twenty times a second. If one width change costs more
// than a frame (~16ms), zooming cannot simply set a new width per event and
// the gesture needs a cheaper stand-in until it settles. If it costs much
// less, the simple thing is also the right thing.
//
// Measured against a REAL document rather than invented slots, because the
// number that matters is the one this editor actually produces.
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"

import { PdfEngineClient } from "@/lib/pdf-engine"
import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface ZoomCostTestResult {
  errors: string[]
  pages: number
  slots: number
  /** Milliseconds for one width change, worst and typical. */
  worstMs: number
  medianMs: number
  samples: number[]
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runZoomCostSelfTest(pdfUrl: string): Promise<ZoomCostTestResult> {
  const out: ZoomCostTestResult = {
    errors: [], pages: 0, slots: 0, worstMs: 0, medianMs: 0, samples: [],
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;overflow:auto"
  document.body.appendChild(host)
  const root = createRoot(host)
  const engine = new PdfEngineClient()

  try {
    const bytes = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer())
    const { docId, pages } = await engine.open(bytes.slice().buffer)
    out.pages = pages.length

    // Every page's slots loaded up front: this is the state the editor is
    // in once someone has scrolled through the document, which is exactly
    // when zooming is slowest and therefore the case worth measuring.
    const pageText: Record<number, { loaded: true; lines: unknown[] }> = {}
    const pageImages: Record<number, { loaded: true; images: unknown[] }> = {}
    const pageVectors: Record<number, { loaded: true; groups: unknown[] }> = {}
    for (let i = 0; i < pages.length; i++) {
      const lines = (await engine.listTextLines(docId, i)).lines
      const images = (await engine.listImages(docId, i)).images
      const groups = (await engine.listVectorGroups(docId, i)).groups
      pageText[i] = { loaded: true, lines }
      pageImages[i] = { loaded: true, images }
      pageVectors[i] = { loaded: true, groups }
      out.slots += lines.length + images.length + groups.length
    }

    // Only the fields the column actually reads. Rendering is stubbed out:
    // this measures the LAYOUT cost of a width change, which is the thing
    // that has to fit in a frame — the engine's own redraw is already known
    // to cost hundreds of milliseconds and is handled separately.
    const doc = {
      pages, pageText, pageImages, pageVectors, revision: 0, lastChange: null,
      renderPage: async () => null,
      renderPageRegion: async () => null,
      loadPageText: async () => {},
      loadPageImages: async () => {},
      loadPageVectors: async () => {},
    } as unknown as UsePdfEngineDocumentResult

    const render = (displayWidth: number) => root.render(createElement(PdfEnginePageColumn, {
      doc,
      displayWidth,
      gutter: 0,
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
    }))

    render(700)
    await wait(600)

    // Twelve width changes, the size of the steps a wheel produces. Timed
    // with flushSync and a forced layout read, so the number covers React's
    // work AND the browser's — a measurement that stops before layout would
    // flatter the result and prove nothing about smoothness.
    const samples: number[] = []
    for (let i = 0; i < 12; i++) {
      const width = 700 * Math.pow(1.1, i + 1)
      const t = performance.now()
      flushSync(() => render(width))
      void host.firstElementChild?.getBoundingClientRect().height
      samples.push(performance.now() - t)
      await wait(30)
    }

    out.samples = samples.map((s) => Number(s.toFixed(1)))
    out.worstMs = Number(Math.max(...samples).toFixed(1))
    const sorted = [...samples].sort((a, b) => a - b)
    out.medianMs = Number(sorted[Math.floor(sorted.length / 2)].toFixed(1))
    if (out.slots < 100) {
      out.errors.push(`only ${out.slots} slots — too few for this measurement to mean anything`)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
    engine.terminate()
  }
}
