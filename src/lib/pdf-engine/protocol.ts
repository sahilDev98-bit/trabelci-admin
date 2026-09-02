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
  /** Which bundled fallback face to draw with. Naming one turns OFF the
   * default of keeping the page's own typeface. */
  font?: "regular" | "bold" | "hebrew"
  /**
   * Forces the bundled face even when the page's own font could draw the
   * text — for someone who deliberately wants a different typeface rather
   * than the document's.
   */
  useBundledFont?: boolean
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

export interface EnginePageLayer {
  kind: "text" | "image" | "vector"
  /** Index within its own kind — what every other engine call takes. */
  index: number
  /** How many page objects this layer is made of; a line of text is often
   * several and a piece of artwork often dozens. */
  objectCount: number
  /** The words, for text layers, so a panel can show them. */
  text?: string
  bbox: PdfRect | null
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
    result: {
      ok: boolean; lines: string[]; fontSize: number
      shrunk: boolean; overflows: boolean
      /** Whether the page's own typeface was kept. False means a bundled
       * face was used and `fellBackBecause` says why — usually that the
       * embedded font is a subset with no glyph for a character typed. */
      usedDocumentFont?: boolean
      fellBackBecause?: string | null
      /** Characters neither the page's font nor the bundled fallback can
       * draw. They will not appear; naming them is the difference between a
       * message and a mystery. */
      unsupportedCharacters?: string | null
    }
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
  setVectorGroupRect: {
    params: {
      docId: string; pageIndex: number; vectorIndex: number
      rect: { x: number; y: number; width: number; height: number }
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
  }
  /** Turn or mirror a line of text, exactly as a picture or artwork turns.
   * Moves the glyphs; it does not re-lay the text out sideways. */
  transformTextLine: {
    params: {
      docId: string; pageIndex: number; lineIndex: number
      op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical"
    }
    result: { ok: boolean; newIndex: number }
  }
  transformVectorGroup: {
    params: {
      docId: string; pageIndex: number; vectorIndex: number
      op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical"
    }
    result: { ok: boolean; newIndex: number; changedRect?: PdfRect }
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
  /**
   * Insert a page from ANOTHER PDF into the open document.
   *
   * How a template is applied: the template's page is imported, bringing its
   * objects, fonts and images with it. Resolves with the whole page list,
   * since inserting renumbers every page after the new one.
   */
  insertPageFrom: {
    params: { docId: string; bytes: ArrayBuffer; atIndex: number }
    result: { ok: boolean; pageIndex: number; pages: EnginePage[] }
  }
  /** One page, written out as its own single-page document. The open
   * document is left untouched — the page is IMPORTED into a new one. */
  savePage: { params: { docId: string; pageIndex: number }; result: { bytes: ArrayBuffer } }
  save: { params: { docId: string }; result: { bytes: ArrayBuffer } }
  /**
   * Steps the document back or forward through its own history.
   *
   * `moved` is false when there was nowhere to go — pressing undo with an
   * empty history is not an error, it is simply nothing.
   *
   * `pages` comes back because the document is REPLACED wholesale: page
   * count and rotation can both differ from before, and everything the caller
   * knows about object indices is stale.
   */
  stepHistory: {
    params: { docId: string; direction: "undo" | "redo" }
    result: {
      moved: boolean
      pages?: EnginePage[]
      canUndo: boolean
      canRedo: boolean
      undoDepth: number
      redoDepth: number
    }
  }
  /**
   * Trim a picture to a region of itself.
   *
   * The region is in fractions of the picture, measured from its BOTTOM-left
   * — the same convention as the rest of PDF. The kept part stays exactly
   * where it was on the page.
   */
  cropImage: {
    params: {
      docId: string; pageIndex: number; imageIndex: number
      region: { left: number; bottom: number; right: number; top: number }
    }
    result: { ok: boolean; width: number; height: number }
  }
  /**
   * Shift several slots by the same amount, in one operation.
   *
   * One call rather than several, because a slot's index is its POSITION:
   * moving the first of a group renumbers the rest, so a second call using
   * the numbers read before the first would move the wrong things. Every
   * object here is resolved to a handle before anything is touched.
   */
  translateSlots: {
    params: {
      docId: string; pageIndex: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
      dxPts: number; dyPts: number
    }
    /** `slots` is where those objects ENDED UP. Moving renumbers them, so
     * without this the caller has to drop the selection — and a group that
     * deselects itself every time you nudge it is unusable. */
    result: {
      ok: boolean; moved: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
    }
  }
  /**
   * Delete several slots in ONE operation.
   *
   * Not a loop over removeTextLine/removeImage on the caller's side, and the
   * distinction is not cosmetic: an index is a POSITION, so removing one
   * object renumbers everything after it. Deleting three things by index one
   * after another removes the first, then whatever inherited the second's
   * number — destroying objects the user never selected.
   */
  removeSlots: {
    params: {
      docId: string; pageIndex: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
    }
    result: { ok: boolean; removed: number }
  }
  /**
   * Copy several slots in one operation.
   *
   * Reports where the ORIGINALS ended up, not the copies: inserting shifts
   * index numbers around, so without this the caller cannot keep the group
   * selected and copying it makes the selection fall apart.
   */
  duplicateSlots: {
    params: {
      docId: string; pageIndex: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
    }
    result: {
      ok: boolean; copied: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
    }
  }
  /**
   * Rotate or flip several slots as ONE unit.
   *
   * Every object turns about the selection's shared centre, so the group
   * keeps its arrangement — the alternative, each item spinning on its own
   * centre, scatters a laid-out block.
   */
  transformSlots: {
    params: {
      docId: string; pageIndex: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
      op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical"
    }
    /** `slots` is where those objects ended up, so the same things can stay
     * selected and be turned again. */
    result: {
      ok: boolean; transformed: number
      slots: { kind: "text" | "image" | "vector"; index: number }[]
    }
  }
  /**
   * Copy one slot, offset slightly from the original.
   *
   * `toPageIndex` lets the copy land on a different page, which is what makes
   * paste-onto-another-page the same operation as duplicate.
   */
  duplicateSlot: {
    params: {
      docId: string; pageIndex: number
      kind: "text" | "image" | "vector"; index: number
      toPageIndex?: number
      dxPts?: number; dyPts?: number
    }
    result: { ok: boolean; newIndex: number }
  }
  /**
   * Insert a blank page.
   *
   * Separate from applyPagePlan, which rearranges pages that already exist by
   * source index and so has nothing to point at for a page that never existed.
   */
  addBlankPage: {
    params: { docId: string; atIndex: number; widthPts: number; heightPts: number }
    result: { pages: EnginePage[] }
  }
  /** Everything on a page in painting order, BOTTOM first — the only notion
   * of "layer" a PDF has. */
  listLayers: {
    params: { docId: string; pageIndex: number }
    result: { layers: EnginePageLayer[] }
  }
  /** Move one layer to a new position in that order. */
  reorderLayer: {
    params: {
      docId: string; pageIndex: number
      kind: "text" | "image" | "vector"; index: number
      toPosition: number
    }
    result: { ok: boolean; newPosition: number }
  }
  historyState: {
    params: { docId: string }
    result: { canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number }
  }
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
