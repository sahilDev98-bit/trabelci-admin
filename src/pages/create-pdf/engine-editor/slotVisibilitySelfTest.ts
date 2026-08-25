// Can you SEE which things are editable, without touching them?
//
// This is the fault behind "this text is not editable". The text always was:
// the box was drawn at one pixel and thirty percent opacity, which on white
// paper at ordinary zoom is invisible. So a line that could be clicked
// looked exactly like a line that could not, and the only ones that looked
// editable were the ones already selected — which draw a solid two-pixel
// ring.
//
// Taste is not testable, but "can it be seen" is: the ring is drawn as a box
// shadow, and the alpha of that colour is a number. This pins it above the
// level where it disappeared, for all three kinds of slot, so nobody can
// quietly fade them again.
import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { PdfEnginePageColumn } from "./PdfEnginePageColumn"
import type { UsePdfEngineDocumentResult } from "./usePdfEngineDocument"

export interface SlotVisibilityTestResult {
  errors: string[]
  /** Alpha of the resting outline, 0-1, for each kind of slot. */
  textAlpha: number
  imageAlpha: number
  /** The level it used to be drawn at, which nobody could see. */
  previousAlpha: number
  /** Control: the reader must return 0 for something with no ring... */
  readsZeroForNoRing: boolean
  /** ...and a real number for something that plainly has one. Without this,
   * a reader that always returned 0 would pass the check above and fail
   * every slot, which is precisely what happened first time. */
  readsAlphaForAKnownRing: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const PAGE = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }

/**
 * The strongest alpha in an element's box-shadow, which is what a ring is
 * drawn with. Returns 0 when there is no shadow at all.
 *
 * Handles the modern colour spaces as well as rgb(): the browser reports
 * these rings as `oklab(0.623 -0.03 -0.21 / 0.7)`, and a reader that only
 * understood `rgba()` returned zero for every slot — which looks exactly
 * like the fault it is supposed to detect. Hence the positive control in
 * the test below.
 */
function ringAlpha(el: Element): number {
  const shadow = getComputedStyle(el).boxShadow
  if (!shadow || shadow === "none") return 0
  let best = 0
  for (const m of shadow.matchAll(/(?:rgba?|oklab|oklch|lab|lch|hsla?|color)\(([^)]+)\)/g)) {
    const body = m[1]
    // Both spellings of "and this much alpha": a fourth comma-separated
    // number, or anything after a slash.
    const slash = body.split("/")
    const alpha = slash.length > 1
      ? parseFloat(slash[1].trim())
      : (() => {
        const parts = body.split(",").map((v) => parseFloat(v.trim()))
        return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1
      })()
    // Fully transparent entries are Tailwind's ring scaffolding, not the ring.
    if (Number.isFinite(alpha) && alpha > best) best = alpha
  }
  return best
}

export async function runSlotVisibilitySelfTest(): Promise<SlotVisibilityTestResult> {
  const out: SlotVisibilityTestResult = {
    errors: [], textAlpha: 0, imageAlpha: 0, previousAlpha: 0.3,
    readsZeroForNoRing: false, readsAlphaForAKnownRing: 0,
  }

  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;background:#fff"
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    const line = {
      lineIndex: 0, text: "Porcelain", pieceCount: 1, fontSize: 8,
      bbox: { left: 40, bottom: 700, right: 300, top: 712 },
      matrix: { a: 8, b: 0, c: 0, d: 8, e: 40, f: 700 },
      fontName: "X", direction: "ltr" as const,
      color: { r: 0, g: 0, b: 0, a: 255 }, bold: false, italic: false,
    }
    const image = {
      imageIndex: 0, bbox: { left: 40, bottom: 300, right: 300, top: 560 },
      pixelWidth: 10, pixelHeight: 10, hasClipPath: false, filters: [],
    }
    const noop = async () => {}
    const doc = {
      pages: [PAGE], docId: "t", revision: 0, phase: "ready", busy: false,
      pageText: { 0: { loaded: true, lines: [line] } },
      pageImages: { 0: { loaded: true, images: [image] } },
      pageVectors: { 0: { loaded: true, groups: [] } },
      lastChange: null,
      renderPage: async () => null, renderPageRegion: async () => null,
      renderCleanPatch: async () => null, renderImagePreview: async () => null,
      loadPageText: noop, loadPageImages: noop, loadPageVectors: noop,
    } as unknown as UsePdfEngineDocumentResult

    const n = () => {}
    root.render(createElement(PdfEnginePageColumn, {
      doc, displayWidth: 600, gutter: 0, contentMode: "text" as const, selection: null,
      onSelect: n, drag: null, onMoveStart: n, originPatch: null, imagePreview: null,
      onEditLine: n, onReplaceImage: n, onReplaceVector: n, onDropOnImage: n,
      onDropOnPage: n, onTransformImage: n, onTransformVector: n, onResizeText: n,
    } as never))
    await wait(400)

    const textSlot = host.querySelector("[data-pdf-text-slot]")
    const imageSlot = host.querySelector("[data-pdf-image-slot]")
    if (!textSlot || !imageSlot) {
      out.errors.push("the page did not render a text slot and an image slot")
      return out
    }
    out.textAlpha = Number(ringAlpha(textSlot).toFixed(2))
    out.imageAlpha = Number(ringAlpha(imageSlot).toFixed(2))

    // Control: something with no ring at all must read as nothing, or the
    // numbers above mean nothing either.
    const bare = document.createElement("div")
    host.appendChild(bare)
    out.readsZeroForNoRing = ringAlpha(bare) === 0
    bare.className = "ring-1 ring-blue-500/70"
    out.readsAlphaForAKnownRing = Number(ringAlpha(bare).toFixed(2))
    bare.remove()

    // ---- verdicts ----
    if (!out.readsZeroForNoRing) {
      out.errors.push("the outline reader reports a ring where there is none")
    }
    if (out.readsAlphaForAKnownRing < 0.6) {
      out.errors.push(
        `the outline reader saw only ${out.readsAlphaForAKnownRing} on a ring known`
        + " to be 0.7 — it cannot read the ring, so the numbers below mean nothing")
    }
    if (out.textAlpha <= out.previousAlpha) {
      out.errors.push(
        `editable text is outlined at ${out.textAlpha} opacity — at or below the`
        + ` ${out.previousAlpha} that was invisible on white paper and was`
        + " reported as text that could not be edited")
    }
    if (out.imageAlpha <= out.previousAlpha) {
      out.errors.push(`editable images are outlined at only ${out.imageAlpha} opacity`)
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
