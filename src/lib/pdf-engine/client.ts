/**
 * UI-thread client for the PDF engine worker.
 *
 * Presents ordinary awaitable methods, so calling code never deals with
 * postMessage plumbing. One instance owns one worker; create it when the
 * editor mounts and terminate() it when the editor unmounts, or the worker
 * (and the PDF it holds in WASM memory) outlives the screen that needed it.
 */
import type {
  EngineMethods, EngineMethodName, EngineRequest, EngineResponse,
  EnginePage, EngineTextLine, EngineImage, RenderedPage,
  EditTextOptions, TextOverlayRequest, ImageOverlayRequest, PagePlanRequest,
} from "./protocol"

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void }

export class PdfEngineClient {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private nextId = 1
  private terminated = false

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    this.worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const msg = event.data
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new Error(msg.error))
    }
    // A worker-level failure (a bad import, an out-of-memory abort) never
    // answers any in-flight request, so every caller would hang forever.
    // Failing them all loudly is the only honest response.
    this.worker.onerror = (event) => {
      const error = new Error(`PDF engine worker failed: ${event.message}`)
      for (const [, entry] of this.pending) entry.reject(error)
      this.pending.clear()
    }
  }

  private call<M extends EngineMethodName>(
    method: M,
    params: EngineMethods[M]["params"],
    transfer: Transferable[] = [],
  ): Promise<EngineMethods[M]["result"]> {
    if (this.terminated) return Promise.reject(new Error("PDF engine client has been terminated"))
    const id = this.nextId++
    const request: EngineRequest<M> = { id, method, params }
    return new Promise<EngineMethods[M]["result"]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage(request, transfer)
    })
  }

  /** Opens a PDF. The ArrayBuffer is TRANSFERRED — the caller's copy is
   * detached afterwards, which is what avoids duplicating a 9MB catalogue
   * in memory just to hand it over. */
  open(bytes: ArrayBuffer): Promise<{ docId: string; pages: EnginePage[] }> {
    return this.call("open", { bytes }, [bytes])
  }

  close(docId: string): Promise<{ closed: boolean }> {
    return this.call("close", { docId })
  }

  listPages(docId: string): Promise<{ pages: EnginePage[] }> {
    return this.call("listPages", { docId })
  }

  renderPage(docId: string, pageIndex: number, scale = 1): Promise<RenderedPage> {
    return this.call("renderPage", { docId, pageIndex, scale })
  }

  listTextLines(docId: string, pageIndex: number): Promise<{ lines: EngineTextLine[] }> {
    return this.call("listTextLines", { docId, pageIndex })
  }

  editTextLine(
    docId: string, pageIndex: number, lineIndex: number, newText: string, options?: EditTextOptions,
  ): Promise<EngineMethods["editTextLine"]["result"]> {
    return this.call("editTextLine", { docId, pageIndex, lineIndex, newText, options })
  }

  listImages(docId: string, pageIndex: number): Promise<{ images: EngineImage[] }> {
    return this.call("listImages", { docId, pageIndex })
  }

  replaceImage(
    docId: string, pageIndex: number, imageIndex: number, bytes: ArrayBuffer, kind: "png" | "jpeg",
  ): Promise<EngineMethods["replaceImage"]["result"]> {
    return this.call("replaceImage", { docId, pageIndex, imageIndex, bytes, kind }, [bytes])
  }

  removeImage(docId: string, pageIndex: number, imageIndex: number): Promise<{ ok: boolean }> {
    return this.call("removeImage", { docId, pageIndex, imageIndex })
  }

  /** Move/resize an image. Any image: a clipped photo's frame is carried
   * along by the same transform, so it keeps its shape wherever it lands. */
  setImageRect(
    docId: string, pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<EngineMethods["setImageRect"]["result"]> {
    return this.call("setImageRect", { docId, pageIndex, imageIndex, rect })
  }

  renderPageRegion(
    docId: string, pageIndex: number,
    rect: { left: number; bottom: number; right: number; top: number }, scale: number,
  ) {
    return this.call("renderPageRegion", { docId, pageIndex, rect, scale })
  }

  renderImagePreview(docId: string, pageIndex: number, imageIndex: number) {
    return this.call("renderImagePreview", { docId, pageIndex, imageIndex })
  }

  renderCleanPatch(
    docId: string, pageIndex: number, kind: "text" | "image", index: number, scale: number,
  ) {
    return this.call("renderCleanPatch", { docId, pageIndex, kind, index, scale })
  }

  listVectorGroups(docId: string, pageIndex: number) {
    return this.call("listVectorGroups", { docId, pageIndex })
  }

  removeVectorGroup(docId: string, pageIndex: number, vectorIndex: number): Promise<{ ok: boolean }> {
    return this.call("removeVectorGroup", { docId, pageIndex, vectorIndex })
  }

  replaceVectorGroupWithImage(
    docId: string, pageIndex: number, vectorIndex: number,
    bytes: ArrayBuffer, kind: "png" | "jpeg",
  ): Promise<{ ok: boolean }> {
    return this.call("replaceVectorGroupWithImage", { docId, pageIndex, vectorIndex, bytes, kind }, [bytes])
  }

  removeTextLine(docId: string, pageIndex: number, lineIndex: number): Promise<{ ok: boolean }> {
    return this.call("removeTextLine", { docId, pageIndex, lineIndex })
  }

  /** Shift a text line. dy is PDF-space, so positive moves it UP. */
  moveTextLineToPage(
    docId: string, sourcePageIndex: number, lineIndex: number,
    targetPageIndex: number, x: number, yBaseline: number,
  ): Promise<{ ok: boolean; newIndex: number }> {
    return this.call("moveTextLineToPage", { docId, sourcePageIndex, lineIndex, targetPageIndex, x, yBaseline })
  }

  moveImageToPage(
    docId: string, sourcePageIndex: number, imageIndex: number,
    targetPageIndex: number, rect: { x: number; y: number; width: number; height: number },
  ): Promise<{ ok: boolean; newIndex: number }> {
    return this.call("moveImageToPage", { docId, sourcePageIndex, imageIndex, targetPageIndex, rect })
  }

  styleTextLine(
    docId: string, pageIndex: number, lineIndex: number,
    style: { bold: boolean; italic: boolean; color: { r: number; g: number; b: number } },
  ): Promise<EngineMethods["styleTextLine"]["result"]> {
    return this.call("styleTextLine", { docId, pageIndex, lineIndex, style })
  }

  scaleTextLine(
    docId: string, pageIndex: number, lineIndex: number, factor: number,
  ): Promise<EngineMethods["scaleTextLine"]["result"]> {
    return this.call("scaleTextLine", { docId, pageIndex, lineIndex, factor })
  }

  alignTextLine(
    docId: string, pageIndex: number, lineIndex: number,
    alignment: "left" | "center" | "right",
  ): Promise<EngineMethods["alignTextLine"]["result"]> {
    return this.call("alignTextLine", { docId, pageIndex, lineIndex, alignment })
  }

  transformImage(
    docId: string, pageIndex: number, imageIndex: number,
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ): Promise<EngineMethods["transformImage"]["result"]> {
    return this.call("transformImage", { docId, pageIndex, imageIndex, op })
  }

  moveTextLine(
    docId: string, pageIndex: number, lineIndex: number, dx: number, dy: number,
  ): Promise<EngineMethods["moveTextLine"]["result"]> {
    return this.call("moveTextLine", { docId, pageIndex, lineIndex, dx, dy })
  }

  addTextOverlay(docId: string, pageIndex: number, overlay: TextOverlayRequest): Promise<{ ok: boolean }> {
    return this.call("addTextOverlay", { docId, pageIndex, overlay })
  }

  addImageOverlay(
    docId: string, pageIndex: number, overlay: ImageOverlayRequest, bytes: ArrayBuffer, kind: "png" | "jpeg",
  ): Promise<{ ok: boolean; newIndex: number }> {
    return this.call("addImageOverlay", { docId, pageIndex, overlay, bytes, kind }, [bytes])
  }

  /** Duplicate / reorder / delete / rotate, all expressed as the list of
   * pages the document should contain. */
  applyPagePlan(docId: string, plan: PagePlanRequest[]): Promise<{ docId: string; pages: EnginePage[] }> {
    return this.call("applyPagePlan", { docId, plan })
  }

  save(docId: string): Promise<{ bytes: ArrayBuffer }> {
    return this.call("save", { docId })
  }

  terminate(): void {
    this.terminated = true
    for (const [, entry] of this.pending) entry.reject(new Error("PDF engine client terminated"))
    this.pending.clear()
    this.worker.terminate()
  }
}

/**
 * Paints ONE rectangle of an already-painted page, leaving the rest of the
 * canvas untouched.
 *
 * This is what makes an edit feel instant. A full page repaint at editing
 * zoom costs 145-417ms; the edit itself costs about 7ms, so nearly all the
 * lag the user saw after moving or resizing something was the page being
 * redrawn in its entirety to show one changed caption.
 *
 * Deliberately does NOT resize the canvas — resizing clears it, which would
 * wipe the page this patch is meant to touch up. A caller whose canvas is
 * the wrong size must repaint in full instead.
 */
export function drawPagePatch(
  canvas: HTMLCanvasElement,
  patch: { width: number; height: number; rgba: ArrayBuffer; x: number; y: number },
): boolean {
  if (patch.width <= 0 || patch.height <= 0) return false
  const ctx = canvas.getContext("2d")
  if (!ctx) return false
  const data = ctx.createImageData(patch.width, patch.height)
  data.data.set(new Uint8ClampedArray(patch.rgba))
  // putImageData ignores transforms and clipping and writes raw pixels, so
  // the patched area is bit-for-bit what the engine produced — the same
  // pixels a full repaint would have put there.
  ctx.putImageData(data, patch.x, patch.y)
  return true
}

/** Paints a rendered page into a canvas. Kept here so callers don't have
 * to know the engine returns raw RGBA rather than an image. */
export function drawRenderedPage(canvas: HTMLCanvasElement, page: RenderedPage): void {
  canvas.width = page.width
  canvas.height = page.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const imageData = ctx.createImageData(page.width, page.height)
  imageData.data.set(new Uint8ClampedArray(page.rgba))
  ctx.putImageData(imageData, 0, 0)
}
