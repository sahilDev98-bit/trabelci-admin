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
  /** How it is currently drawn, so the toolbar can show the right buttons
   * as pressed rather than assuming. */
  bold: boolean
  italic: boolean
  /** Fill colour, so a line moved to another page keeps its appearance. */
  color: { r: number; g: number; b: number; a: number }
}

export interface EngineImage {
  imageIndex: number
  bbox: PdfRect | null
  pixelWidth: number
  pixelHeight: number
  /** True when the page frames this image with a shape (circle, rounded
   * corners, silhouette). Reported for information only — the frame is
   * carried along when the image moves, so it no longer restricts
   * anything. */
  hasClipPath: boolean
  filters: string[]
}

/**
 * A piece of vector artwork — a logo, icon or drawn mark — grouped from the
 * many paths that actually make it up. See vector.ts for why.
 */
export interface EngineVectorGroup {
  vectorIndex: number
  bbox: PdfRect
  /** How many paths were merged into it, purely informational. */
  pathCount: number
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
  /** Explicit type size, for resizing text (which changes its size rather
   * than stretching a box). Omitted, the line keeps its original size. */
  fontSize?: number
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
  /**
   * A picture of one slot's area rendered WITHOUT that slot, so the place a
   * dragged object came from can look genuinely empty rather than covered.
   * The document is restored before this returns.
   */
  renderCleanPatch: {
    params: {
      docId: string; pageIndex: number
      kind: "text" | "image"
      index: number
      scale: number
    }
    result: { width: number; height: number; rgba: ArrayBuffer } | { width: 0; height: 0; rgba: ArrayBuffer }
  }
  /**
   * Just one image object, rendered on its own with its clip and
   * transparency — NOT a crop of the page.
   *
   * A crop shows everything painted in that area, including anything drawn
   * ON TOP of the image, so dragging a photo with a caption over it
   * previewed the caption moving too when only the photo would.
   */
  /** One rectangle of the page, so a change can repaint just the area it
   * touched instead of the whole page. */
  renderPageRegion: {
    params: { docId: string; pageIndex: number; rect: PdfRect; scale: number }
    result: { width: number; height: number; rgba: ArrayBuffer; x: number; y: number }
  }
  renderImagePreview: {
    params: { docId: string; pageIndex: number; imageIndex: number }
    result: { width: number; height: number; rgba: ArrayBuffer }
  }
  listVectorGroups: {
    params: { docId: string; pageIndex: number }
    result: { groups: EngineVectorGroup[] }
  }
  removeVectorGroup: {
    params: { docId: string; pageIndex: number; vectorIndex: number }
    result: { ok: boolean }
  }
  /** Swap a piece of artwork for an image, in the box the artwork occupied.
   * One call rather than a delete followed by an add: if the add failed
   * separately the artwork would already be gone. */
  replaceVectorGroupWithImage: {
    params: {
      docId: string; pageIndex: number; vectorIndex: number
      bytes: ArrayBuffer; kind: "png" | "jpeg"
    }
    result: { ok: boolean }
  }
  replaceImage: {
    params: { docId: string; pageIndex: number; imageIndex: number; bytes: ArrayBuffer; kind: "png" | "jpeg" }
    result: { ok: boolean; method?: string; changedRect?: PdfRect }
  }
  removeImage: { params: { docId: string; pageIndex: number; imageIndex: number }; result: { ok: boolean } }
  /** Move/resize an image. Valid for ANY image: a clipped photo's frame is
   * carried along by the same transform, so it keeps its shape. */
  setImageRect: {
    params: {
      docId: string; pageIndex: number; imageIndex: number
      rect: { x: number; y: number; width: number; height: number }
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  removeTextLine: { params: { docId: string; pageIndex: number; lineIndex: number }; result: { ok: boolean } }
  /** Shift a grouped text line. dy is in PDF space, so positive is UP. */
  /** Move a text line onto a DIFFERENT page, placing its left edge and
   * baseline at (x, yBaseline) in the target page's PDF points. */
  moveTextLineToPage: {
    params: {
      docId: string; sourcePageIndex: number; lineIndex: number
      targetPageIndex: number; x: number; yBaseline: number
    }
    /** newIndex: where the line ended up. -1 if it could not be located. */
    result: { ok: boolean; newIndex: number }
  }
  /** Move an image onto a DIFFERENT page, into the given rect (PDF points,
   * y measured from the bottom). */
  moveImageToPage: {
    params: {
      docId: string; sourcePageIndex: number; imageIndex: number
      targetPageIndex: number; rect: { x: number; y: number; width: number; height: number }
    }
    /** newIndex: where the image ended up. -1 if it could not be located. */
    result: { ok: boolean; newIndex: number }
  }
  /** Bold / italic / colour, applied to the text already in the document.
   * Does NOT rebuild it, so the page's own typeface survives. */
  styleTextLine: {
    params: {
      docId: string; pageIndex: number; lineIndex: number
      style: { bold: boolean; italic: boolean; color: { r: number; g: number; b: number } }
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  /** Grow or shrink a line about its own start, keeping its typeface. */
  scaleTextLine: {
    params: { docId: string; pageIndex: number; lineIndex: number; factor: number }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  /** Move a line to the left, centre or right of the page. */
  alignTextLine: {
    params: {
      docId: string; pageIndex: number; lineIndex: number
      alignment: "left" | "center" | "right"
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  /** Turn or flip an image in place — a matrix change, so no re-encoding. */
  transformImage: {
    params: {
      docId: string; pageIndex: number; imageIndex: number
      op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical"
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  moveTextLine: {
    params: { docId: string; pageIndex: number; lineIndex: number; dx: number; dy: number }
    /** newIndex: where the line ended up. Lines are numbered by POSITION, so
     * moving one renumbers it — see the worker for why this is reported.
     * changedRect: the area the edit touched, so the editor can repaint just
     * that instead of the whole page. */
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  addTextOverlay: { params: { docId: string; pageIndex: number; overlay: TextOverlayRequest }; result: { ok: boolean } }
  /** newIndex: where the added image ended up, so the caller can select it
   * immediately — an image you cannot see the handles of looks broken. */
  addImageOverlay: {
    params: { docId: string; pageIndex: number; overlay: ImageOverlayRequest; bytes: ArrayBuffer; kind: "png" | "jpeg" }
    result: { ok: boolean; newIndex: number }
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
