// Does the PAGE actually take the fast path?
//
// The engine side of partial repaint is checked against real pixels by
// scripts/pdf-engine-partialrepaint-test.mjs. This checks the other half,
// which is where the subtle bugs live: a page only patches when the picture
// on its canvas is genuinely the one the patch was computed against. Get the
// bookkeeping wrong — read a stale change, miss that the zoom moved, patch a
// page the edit did not touch — and the canvas shows a page that never
// existed, silently, because nothing throws.
//
// So every guard is exercised with a case that MUST fall back to a full
// repaint, and the one case that should patch is checked by reading the
// canvas: the patched pixels changed, the rest did not.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePage } from "./PdfEnginePage"
import type { PdfRect } from "@/lib/pdf-engine"

export interface PartialRepaintTestResult {
  errors: string[]
  /** name -> what the page did: "full", "patch", or "nothing". */
  actions: Record<string, string>
  patchedPixel: string | null
  untouchedPixel: string | null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A solid raster of one colour, standing in for a rendered page. */
function solid(width: number, height: number, r: number, g: number, b: number) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba: rgba.buffer }
}

export async function runPartialRepaintSelfTest(): Promise<PartialRepaintTestResult> {
  const out: PartialRepaintTestResult = {
    errors: [], actions: {}, patchedPixel: null, untouchedPixel: null,
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0"
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    const page = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }
    const calls = { full: 0, region: 0 }
    let lastRegionRequest: { rect: PdfRect; scale: number } | null = null

    const render = (props: {
      revision: number
      displayWidth: number
      lastChange: { pageIndex: number; rect: PdfRect; revision: number } | null
    }) => root.render(createElement(PdfEnginePage, {
      page,
      pageIndex: 0,
      displayWidth: props.displayWidth,
      text: { loaded: true, lines: [] },
      images: { loaded: true, images: [] },
      vectors: { loaded: true, groups: [] },
      contentMode: "text",
      revision: props.revision,
      lastChange: props.lastChange,
      // The page is painted RED, patches are GREEN, so reading one pixel
      // says which of the two put it there.
      renderPage: async (_p: number, scale: number) => {
        calls.full++
        return solid(
          Math.round(page.widthPts * scale), Math.round(page.heightPts * scale),
          255, 0, 0,
        )
      },
      renderPageRegion: async (_p: number, rect: PdfRect, scale: number) => {
        calls.region++
        lastRegionRequest = { rect, scale }
        const width = Math.max(1, Math.round((rect.right - rect.left) * scale))
        const height = Math.max(1, Math.round((rect.top - rect.bottom) * scale))
        return {
          ...solid(width, height, 0, 255, 0),
          x: Math.round(rect.left * scale),
          y: Math.round((page.heightPts - rect.top) * scale),
        }
      },
      loadPageText: async () => {},
      loadPageImages: async () => {},
      loadPageVectors: async () => {},
      onReplaceVector: () => {},
      onSelectLine: () => {},
      onReplaceImage: () => {},
      onDropOnImage: () => {},
      onDropOnPage: () => {},
      onTransformImage: () => {},
      selection: null,
      onSelect: () => {},
      onMoveStart: () => {},
      draggingSlot: null,
      dropTargetPage: false,
      imagePreviewUrl: null,
      originPatchUrl: null,
      onResizeText: () => {},
    }))

    /** Runs one step and reports what the page did about it. */
    const step = async (
      name: string,
      props: Parameters<typeof render>[0],
    ) => {
      const before = { ...calls }
      render(props)
      await wait(250)
      const full = calls.full - before.full
      const region = calls.region - before.region
      out.actions[name] = full > 0 ? "full" : region > 0 ? "patch" : "nothing"
      return out.actions[name]
    }

    const SMALL: PdfRect = { left: 100, bottom: 600, right: 260, top: 660 }
    // 60% of the page — past the point where patching is worth it.
    const HUGE: PdfRect = { left: 0, bottom: 0, right: 600, top: 480 }

    // The first paint has nothing to patch onto.
    await step("first paint", { revision: 0, displayWidth: 600, lastChange: null })
    // The one case that should take the fast path.
    await step("edit on this page", {
      revision: 1, displayWidth: 600,
      lastChange: { pageIndex: 0, rect: SMALL, revision: 1 },
    })
    // ---- everything below MUST fall back ----
    await step("edit reporting no area", { revision: 2, displayWidth: 600, lastChange: null })
    await step("edit on another page", {
      revision: 3, displayWidth: 600,
      lastChange: { pageIndex: 1, rect: SMALL, revision: 3 },
    })
    await step("change from an older revision", {
      revision: 4, displayWidth: 600,
      lastChange: { pageIndex: 0, rect: SMALL, revision: 3 },
    })
    await step("change covering most of the page", {
      revision: 5, displayWidth: 600,
      lastChange: { pageIndex: 0, rect: HUGE, revision: 5 },
    })
    await step("zoom changed with the edit", {
      revision: 6, displayWidth: 900,
      lastChange: { pageIndex: 0, rect: SMALL, revision: 6 },
    })

    const expected: Record<string, string> = {
      "first paint": "full",
      "edit on this page": "patch",
      "edit reporting no area": "full",
      "edit on another page": "full",
      "change from an older revision": "full",
      "change covering most of the page": "full",
      "zoom changed with the edit": "full",
    }
    for (const [name, want] of Object.entries(expected)) {
      const got = out.actions[name]
      if (got !== want) out.errors.push(`${name}: expected a ${want} repaint, got "${got}"`)
    }

    // ---- and the patch has to land in the right place on the canvas ----
    // Painted fresh so the canvas is red, then patched once, then read.
    calls.full = 0
    calls.region = 0
    render({ revision: 10, displayWidth: 600, lastChange: null })
    await wait(250)
    render({
      revision: 11, displayWidth: 600,
      lastChange: { pageIndex: 0, rect: SMALL, revision: 11 },
    })
    await wait(250)

    const canvas = host.querySelector("canvas")
    if (!canvas) {
      out.errors.push("no canvas rendered")
      return out
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx || !lastRegionRequest) {
      out.errors.push("the page never asked for a region to patch with")
      return out
    }
    const { rect, scale } = lastRegionRequest as { rect: PdfRect; scale: number }
    const inside = ctx.getImageData(
      Math.round(rect.left * scale) + 4,
      Math.round((page.heightPts - rect.top) * scale) + 4, 1, 1).data
    const outside = ctx.getImageData(4, 4, 1, 1).data
    out.patchedPixel = `${inside[0]},${inside[1]},${inside[2]}`
    out.untouchedPixel = `${outside[0]},${outside[1]},${outside[2]}`
    if (out.patchedPixel !== "0,255,0") {
      out.errors.push(`inside the patched area the canvas is ${out.patchedPixel}, not the patch`)
    }
    if (out.untouchedPixel !== "255,0,0") {
      out.errors.push(`outside it the canvas is ${out.untouchedPixel}, not the page it was`)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
