/**
 * The message contract between the UI thread and the PDF engine worker.
 *
 * Kept in its own module so both sides import the SAME types: a mismatch
 * between what the client sends and what the worker expects would only
 * show up at runtime, inside a worker, where it is markedly harder to
 * debug than a compile error.
 */
import type { PdfMatrix, PdfRect } from "./core"
import type { TextAlign } from "./layout"

/** One editable line of existing text, as the engine sees it. */
export interface EngineTextLine {
  /** Index into the page's grouped-line list, stable only until the next
   * edit on that page — callers should re-list after editing. */
  lineIndex: number
  text: string
  /** How many raw PDF objects this line was assembled from. */
  pieceCount: number
  fontSize: number
  bbox: PdfRect
  matrix: PdfMatrix
  fontName: string
  direction: "ltr" | "rtl"
}

export interface EngineImage {
  imageIndex: number
  bbox: PdfRect | null
  pixelWidth: number
  pixelHeight: number
  hasClipPath: boolean
  filters: string[]
}

export interface EnginePage {
  index: number
  widthPts: number
  heightPts: number
  rotation: number
}

export interface RenderedPage {
  width: number
  height: number
  /** RGBA bytes, transferred (not copied) back to the caller. */
  rgba: ArrayBuffer
}

export interface EditTextOptions {
  maxWidth?: number
  maxHeight?: number
  lineHeightRatio?: number
  minFontScale?: number
  align?: TextAlign
  /** Which bundled fallback face to draw with. */
  font?: "regular" | "bold" | "hebrew"
}

export interface TextOverlayRequest {
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  color: { r: number; g: number; b: number; a?: number }
  rotation?: number
  align?: TextAlign
  font?: "regular" | "bold" | "hebrew"
}

export interface ImageOverlayRequest {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export interface PagePlanRequest {
  sourceIndex: number
  rotationDelta?: number
}

/** Every callable operation, as params -> result. The client derives its
 * public API from this, so adding an operation in one place types it in
 * both. */
export interface EngineMethods {
  open: { params: { bytes: ArrayBuffer }; result: { docId: string; pages: EnginePage[] } }
  close: { params: { docId: string }; result: { closed: boolean } }
  listPages: { params: { docId: string }; result: { pages: EnginePage[] } }
  renderPage: { params: { docId: string; pageIndex: number; scale: number }; result: RenderedPage }
  listTextLines: { params: { docId: string; pageIndex: number }; result: { lines: EngineTextLine[] } }
  editTextLine: {
    params: { docId: string; pageIndex: number; lineIndex: number; newText: string; options?: EditTextOptions }
    result: { ok: boolean; lines: string[]; fontSize: number; shrunk: boolean; overflows: boolean }
  }
  listImages: { params: { docId: string; pageIndex: number }; result: { images: EngineImage[] } }
  replaceImage: {
    params: { docId: string; pageIndex: number; imageIndex: number; bytes: ArrayBuffer; kind: "png" | "jpeg" }
    result: { ok: boolean }
  }
  removeImage: { params: { docId: string; pageIndex: number; imageIndex: number }; result: { ok: boolean } }
  addTextOverlay: { params: { docId: string; pageIndex: number; overlay: TextOverlayRequest }; result: { ok: boolean } }
  addImageOverlay: {
    params: { docId: string; pageIndex: number; overlay: ImageOverlayRequest; bytes: ArrayBuffer; kind: "png" | "jpeg" }
    result: { ok: boolean }
  }
  applyPagePlan: { params: { docId: string; plan: PagePlanRequest[] }; result: { docId: string; pages: EnginePage[] } }
  save: { params: { docId: string }; result: { bytes: ArrayBuffer } }
}

export type EngineMethodName = keyof EngineMethods

export interface EngineRequest<M extends EngineMethodName = EngineMethodName> {
  id: number
  method: M
  params: EngineMethods[M]["params"]
}

export type EngineResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
