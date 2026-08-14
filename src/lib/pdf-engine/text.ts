// PDF-domain operations for the POC: open a doc, walk real page objects,
// read a text object's true properties (no hotspot guessing), replace its
// text directly, or rebuild it against a complete fallback font when the
// embedded face can't draw the new text. Render + save both go through
// PDFium itself, so "what you see" and "what got written" are the same
// engine's output by construction.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
// Imports the environment-agnostic core, NOT the Node entry point — this
// module must stay loadable in the browser, so it can never pull in
// node:fs transitively.
import { FONT_TYPE, PAGEOBJ_TYPE, Scratch } from "./core"
import { effectiveFontSize } from "./grouping"
import {
  layoutText, measureTextWidth, lineX, defaultAlignFor,
  type FontMetrics, type LayoutResult, type TextAlign,
} from "./layout"

export interface TextObjectInfo {
  index: number
  handle: number
  text: string
  fontSize: number
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number }
  bounds: { left: number; bottom: number; right: number; top: number } | null
  fontHandle: number
  fontBaseName: string
  isEmbedded: boolean
  fontFlags: number
  fontDataLength: number
  /** Fill colour, 0-255 each. */
  fill: { r: number; g: number; b: number; a: number }
}

export function openDocument(pdfium: WrappedPdfiumModule, bytes: Uint8Array, scratch: Scratch): number {
  const ptr = scratch.writeBuffer(bytes)
  const doc = pdfium.FPDF_LoadMemDocument(ptr, bytes.length, "")
  if (!doc) {
    const err = pdfium.FPDF_GetLastError()
    throw new Error(`FPDF_LoadMemDocument failed, FPDF_GetLastError=${err}`)
  }
  return doc
}

/** All TEXT-type objects on one page, with their real PDFium-reported
 * properties — never a reconstructed/guessed hotspot. */
export function listTextObjects(pdfium: WrappedPdfiumModule, page: number, scratch: Scratch): TextObjectInfo[] {
  const textPage = pdfium.FPDFText_LoadPage(page)
  const count = pdfium.FPDFPage_CountObjects(page)
  const out: TextObjectInfo[] = []

  for (let i = 0; i < count; i++) {
    const obj = pdfium.FPDFPage_GetObject(page, i)
    if (pdfium.FPDFPageObj_GetType(obj) !== PAGEOBJ_TYPE.TEXT) continue

    // Text: fixed generous buffer (short catalogue headings/labels), read
    // back as a NUL-terminated UTF-16LE string.
    const textBufBytes = 4096
    const textPtr = scratch.malloc(textBufBytes)
    pdfium.FPDFTextObj_GetText(obj, textPage, textPtr, textBufBytes)
    const text = scratch.readUtf16(textPtr)

    const sizePtr = scratch.malloc(4)
    pdfium.FPDFTextObj_GetFontSize(obj, sizePtr)
    const fontSize = scratch.readFloat(sizePtr)

    const matrixPtr = scratch.malloc(24)
    pdfium.FPDFPageObj_GetMatrix(obj, matrixPtr)
    const matrix = scratch.readMatrix(matrixPtr)

    let bounds: TextObjectInfo["bounds"] = null
    const lPtr = scratch.malloc(4), bPtr = scratch.malloc(4), rPtr = scratch.malloc(4), tPtr = scratch.malloc(4)
    const gotBounds = pdfium.FPDFPageObj_GetBounds(obj, lPtr, bPtr, rPtr, tPtr)
    if (gotBounds) {
      bounds = {
        left: scratch.readFloat(lPtr), bottom: scratch.readFloat(bPtr),
        right: scratch.readFloat(rPtr), top: scratch.readFloat(tPtr),
      }
    }

    const fontHandle = pdfium.FPDFTextObj_GetFont(obj)
    const nameBufBytes = 256
    const namePtr = scratch.malloc(nameBufBytes)
    pdfium.FPDFFont_GetBaseFontName(fontHandle, namePtr, nameBufBytes)
    const fontBaseName = pdfium.pdfium.UTF8ToString(namePtr)
    const isEmbedded = pdfium.FPDFFont_GetIsEmbedded(fontHandle) === 1
    const fontFlags = pdfium.FPDFFont_GetFlags(fontHandle)

    const fontDataLength = getFontDataLength(pdfium, fontHandle, scratch)

    const fr = scratch.malloc(4), fg = scratch.malloc(4), fb = scratch.malloc(4), fa = scratch.malloc(4)
    const fill = pdfium.FPDFPageObj_GetFillColor(obj, fr, fg, fb, fa)
      ? { r: scratch.readInt(fr), g: scratch.readInt(fg), b: scratch.readInt(fb), a: scratch.readInt(fa) }
      : { r: 0, g: 0, b: 0, a: 255 }

    out.push({ index: i, handle: obj, text, fontSize, matrix, bounds, fontHandle, fontBaseName, isEmbedded, fontFlags, fontDataLength, fill })
  }

  pdfium.FPDFText_ClosePage(textPage)
  return out
}

/** Standard PDFium two-call pattern: probe the needed size, then fetch. */
export function getFontData(pdfium: WrappedPdfiumModule, fontHandle: number, scratch: Scratch): Uint8Array {
  const outLenPtr = scratch.malloc(4)
  pdfium.FPDFFont_GetFontData(fontHandle, 0, 0, outLenPtr)
  const needed = pdfium.pdfium.getValue(outLenPtr, "i32")
  if (!needed) return new Uint8Array(0)
  const dataPtr = scratch.malloc(needed)
  const outLenPtr2 = scratch.malloc(4)
  const ok = pdfium.FPDFFont_GetFontData(fontHandle, dataPtr, needed, outLenPtr2)
  if (!ok) return new Uint8Array(0)
  return scratch.readBytes(dataPtr, needed)
}

function getFontDataLength(pdfium: WrappedPdfiumModule, fontHandle: number, scratch: Scratch): number {
  const outLenPtr = scratch.malloc(4)
  pdfium.FPDFFont_GetFontData(fontHandle, 0, 0, outLenPtr)
  return pdfium.pdfium.getValue(outLenPtr, "i32")
}

/** Step 4 — the simplest possible operation: set new text directly on the
 * EXISTING text object (same font, same everything) and regenerate. */
export function directSetText(pdfium: WrappedPdfiumModule, page: number, textObj: number, newText: string, scratch: Scratch): boolean {
  const ptr = scratch.writeUtf16(newText)
  const ok = pdfium.FPDFText_SetText(textObj, ptr)
  if (!ok) return false
  return pdfium.FPDFPage_GenerateContent(page)
}

/** Step 6 — the professional fallback path: load a COMPLETE local font,
 * build a brand-new text object with it, copy the original's matrix
 * (position/scale/rotation) and fill colour, swap it in for the old
 * object, then regenerate. */
export function rebuildWithFallbackFont(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  original: TextObjectInfo,
  newText: string,
  fallbackFontBytes: Uint8Array,
  scratch: Scratch,
): { ok: boolean; newHandle?: number; error?: string } {
  const fontDataPtr = scratch.writeBuffer(fallbackFontBytes)
  // isCid=true: a simple (non-CID) 8-bit font is capped at 256 encoded
  // glyphs, which is fine for ASCII but not for arbitrary Unicode
  // (Hebrew included) — CID/Type0 is the generally-correct choice.
  const newFont = pdfium.FPDFText_LoadFont(document, fontDataPtr, fallbackFontBytes.length, FONT_TYPE.TRUETYPE, true)
  if (!newFont) return { ok: false, error: "FPDFText_LoadFont returned 0" }

  const newObj = pdfium.FPDFPageObj_CreateTextObj(document, newFont, original.fontSize)
  if (!newObj) return { ok: false, error: "FPDFPageObj_CreateTextObj returned 0" }

  const textPtr = scratch.writeUtf16(newText)
  if (!pdfium.FPDFText_SetText(newObj, textPtr)) return { ok: false, error: "FPDFText_SetText on rebuilt object failed" }

  const matrixPtr = scratch.malloc(24)
  const p = pdfium.pdfium
  p.setValue(matrixPtr + 0, original.matrix.a, "float")
  p.setValue(matrixPtr + 4, original.matrix.b, "float")
  p.setValue(matrixPtr + 8, original.matrix.c, "float")
  p.setValue(matrixPtr + 12, original.matrix.d, "float")
  p.setValue(matrixPtr + 16, original.matrix.e, "float")
  p.setValue(matrixPtr + 20, original.matrix.f, "float")
  if (!pdfium.FPDFPageObj_SetMatrix(newObj, matrixPtr)) return { ok: false, error: "FPDFPageObj_SetMatrix failed" }

  // Best-effort colour copy — black (0,0,0,255) if the original's fill
  // colour can't be read, rather than failing the whole rebuild over it.
  const rPtr = scratch.malloc(4), gPtr = scratch.malloc(4), bPtr = scratch.malloc(4), aPtr = scratch.malloc(4)
  if (pdfium.FPDFPageObj_GetFillColor(original.handle, rPtr, gPtr, bPtr, aPtr)) {
    pdfium.FPDFPageObj_SetFillColor(newObj, p.getValue(rPtr, "i32"), p.getValue(gPtr, "i32"), p.getValue(bPtr, "i32"), p.getValue(aPtr, "i32"))
  } else {
    pdfium.FPDFPageObj_SetFillColor(newObj, 0, 0, 0, 255)
  }

  if (!pdfium.FPDFPage_RemoveObject(page, original.handle)) return { ok: false, error: "FPDFPage_RemoveObject failed" }
  pdfium.FPDFPageObj_Destroy(original.handle)
  pdfium.FPDFPage_InsertObject(page, newObj)

  const generated = pdfium.FPDFPage_GenerateContent(page)
  return { ok: generated, newHandle: newObj }
}

/** Same idea as rebuildWithFallbackFont, but for a GROUP of raw PDFium
 * objects that together make up one visual line (see grouping.ts) — e.g. a
 * word PDFium stored as 2 separate objects due to kerning, or a line PDFium
 * stored as one object per word. Anchors the new single object at the
 * FIRST (leftmost) piece's own position/size/colour — the correct anchor
 * for LTR text — then removes every piece in the group, not just one. */
export function rebuildGroupWithFallbackFont(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  group: TextObjectInfo[],
  newText: string,
  fallbackFontBytes: Uint8Array,
  scratch: Scratch,
): { ok: boolean; newHandle?: number; error?: string } {
  const anchor = group[0]
  const fontDataPtr = scratch.writeBuffer(fallbackFontBytes)
  const newFont = pdfium.FPDFText_LoadFont(document, fontDataPtr, fallbackFontBytes.length, FONT_TYPE.TRUETYPE, true)
  if (!newFont) return { ok: false, error: "FPDFText_LoadFont returned 0" }

  const newObj = pdfium.FPDFPageObj_CreateTextObj(document, newFont, anchor.fontSize)
  if (!newObj) return { ok: false, error: "FPDFPageObj_CreateTextObj returned 0" }

  const textPtr = scratch.writeUtf16(newText)
  if (!pdfium.FPDFText_SetText(newObj, textPtr)) return { ok: false, error: "FPDFText_SetText on rebuilt object failed" }

  const matrixPtr = scratch.malloc(24)
  const p = pdfium.pdfium
  p.setValue(matrixPtr + 0, anchor.matrix.a, "float")
  p.setValue(matrixPtr + 4, anchor.matrix.b, "float")
  p.setValue(matrixPtr + 8, anchor.matrix.c, "float")
  p.setValue(matrixPtr + 12, anchor.matrix.d, "float")
  p.setValue(matrixPtr + 16, anchor.matrix.e, "float")
  p.setValue(matrixPtr + 20, anchor.matrix.f, "float")
  if (!pdfium.FPDFPageObj_SetMatrix(newObj, matrixPtr)) return { ok: false, error: "FPDFPageObj_SetMatrix failed" }

  const rPtr = scratch.malloc(4), gPtr = scratch.malloc(4), bPtr = scratch.malloc(4), aPtr = scratch.malloc(4)
  if (pdfium.FPDFPageObj_GetFillColor(anchor.handle, rPtr, gPtr, bPtr, aPtr)) {
    pdfium.FPDFPageObj_SetFillColor(newObj, p.getValue(rPtr, "i32"), p.getValue(gPtr, "i32"), p.getValue(bPtr, "i32"), p.getValue(aPtr, "i32"))
  } else {
    pdfium.FPDFPageObj_SetFillColor(newObj, 0, 0, 0, 255)
  }

  // Remove EVERY piece in the group — leaving even one behind would draw a
  // leftover fragment of the old word next to the new one.
  for (const piece of group) {
    if (!pdfium.FPDFPage_RemoveObject(page, piece.handle)) return { ok: false, error: `FPDFPage_RemoveObject failed for piece "${piece.text}"` }
    pdfium.FPDFPageObj_Destroy(piece.handle)
  }
  pdfium.FPDFPage_InsertObject(page, newObj)

  const generated = pdfium.FPDFPage_GenerateContent(page)
  return { ok: generated, newHandle: newObj }
}

/**
 * Per-document cache of loaded font handles.
 *
 * FPDFText_LoadFont EMBEDS a fresh copy of the font file into the document
 * every time it is called. Calling it once per edit therefore grows the
 * output by roughly the font's size per edit — measured at ~63KB each,
 * which turned a 3.4MB catalog into a 122MB download after 1,350 edits.
 * Loading each distinct font once per document and reusing the handle
 * removes that entirely.
 *
 * Scoped to one document deliberately: a font handle belongs to the
 * document it was loaded into, so it must never outlive it or be shared
 * across documents.
 */
export class DocumentFonts {
  private byFont = new Map<Uint8Array, number>()
  private pdfium: WrappedPdfiumModule
  private document: number

  // Written out longhand rather than as constructor parameter properties:
  // this project sets erasableSyntaxOnly, which bans TypeScript-only
  // runtime syntax so the sources stay strippable to plain JavaScript.
  constructor(pdfium: WrappedPdfiumModule, document: number) {
    this.pdfium = pdfium
    this.document = document
  }

  /** The font handle for these bytes in this document, loading it only on
   * first use. Keyed by array identity, which is what callers naturally
   * have (one Uint8Array read per font file at startup). */
  handleFor(fontBytes: Uint8Array, scratch: Scratch): number {
    const existing = this.byFont.get(fontBytes)
    if (existing) return existing
    const ptr = scratch.writeBuffer(fontBytes)
    const handle = this.pdfium.FPDFText_LoadFont(this.document, ptr, fontBytes.length, FONT_TYPE.TRUETYPE, true)
    if (handle) this.byFont.set(fontBytes, handle)
    return handle
  }
}

/** One text object created for one wrapped line. */
export interface PlacedLine {
  text: string
  handle: number
  x: number
  baselineY: number
  width: number
}

export interface WrapRebuildOptions {
  /** Width to wrap inside. Defaults to the original group's own width,
   * which preserves the page's column/design intent. */
  maxWidth?: number
  /** Draw at this size instead of the original's. Resizing text means
   * changing its type size — a text object has no width or height of its
   * own to stretch, unlike an image. */
  fontSize?: number
  /** Baseline-to-baseline spacing as a multiple of font size. */
  lineHeightRatio?: number
  /** Height budget for auto-shrink. Omit to keep the original size and
   * simply let the block grow downward. */
  maxHeight?: number
  /** Floor for auto-shrink, as a fraction of the original size (default
   * 0.7). Exposed because the right answer is a judgement call the caller
   * owns: a heading squeezed into a tight box either shrinks past what
   * still looks designed, or overflows — there is no third option, and
   * which one is preferable depends on the page. */
  minFontScale?: number
  align?: TextAlign
  /** Reuse already-embedded fonts instead of embedding a fresh copy per
   * edit. Strongly recommended whenever more than one edit is made to the
   * same document — see DocumentFonts for what it costs not to. */
  fonts?: DocumentFonts
  /** Skip regenerating the page's content stream on this call. Every
   * FPDFPage_GenerateContent writes a NEW content stream for the page and
   * the superseded one stays in the file, so calling it once per edit on a
   * 300-object page costs one whole page stream per edit. Batch callers
   * should set this and call FPDFPage_GenerateContent once when done. */
  deferContentGeneration?: boolean
}

export interface WrapRebuildResult {
  ok: boolean
  error?: string
  lines?: PlacedLine[]
  layout?: LayoutResult
}

/**
 * Replace a group of text objects with WRAPPED text: the replacement is
 * measured, broken into lines that fit the box width, and drawn as one
 * text object per line, stacked downward from the original's baseline.
 *
 * This is what stops longer replacement text running off the page edge —
 * the failure visible on REFIN's six-column legal page, where an overlong
 * line does not merely look untidy but collides with the neighbouring
 * column.
 *
 * Each line becomes its own PDF text object rather than one object
 * containing newlines: a PDF text object has a single position, so "\n"
 * inside one carries no vertical meaning. Stacking real objects at
 * computed baselines is how multi-line text actually works in PDF.
 */
export function rebuildGroupWithWrappedText(
  pdfium: WrappedPdfiumModule,
  document: number,
  page: number,
  group: TextObjectInfo[],
  newText: string,
  fallbackFontBytes: Uint8Array,
  metrics: FontMetrics,
  scratch: Scratch,
  opts: WrapRebuildOptions = {},
): WrapRebuildResult {
  const anchor = group[0]

  // Geometry of the original block, from PDFium's own reported bounds.
  const left = Math.min(...group.map((o) => o.bounds?.left ?? o.matrix.e))
  const right = Math.max(...group.map((o) => o.bounds?.right ?? o.matrix.e))
  const boxWidth = opts.maxWidth ?? Math.max(1, right - left)
  const requestedSize = opts.fontSize && opts.fontSize > 0 ? opts.fontSize : effectiveFontSize(anchor)

  const layout = layoutText(metrics, newText, requestedSize, {
    maxWidth: boxWidth,
    lineHeightRatio: opts.lineHeightRatio,
    maxHeight: opts.maxHeight,
    minFontScale: opts.minFontScale,
  })
  const align = opts.align ?? defaultAlignFor(layout.direction)

  const newFont = opts.fonts
    ? opts.fonts.handleFor(fallbackFontBytes, scratch)
    : pdfium.FPDFText_LoadFont(document, scratch.writeBuffer(fallbackFontBytes), fallbackFontBytes.length, FONT_TYPE.TRUETYPE, true)
  if (!newFont) return { ok: false, error: "FPDFText_LoadFont returned 0" }

  // Read the original's colour ONCE, before any object is destroyed.
  const p = pdfium.pdfium
  const rPtr = scratch.malloc(4), gPtr = scratch.malloc(4), bPtr = scratch.malloc(4), aPtr = scratch.malloc(4)
  let fill: [number, number, number, number] = [0, 0, 0, 255]
  if (pdfium.FPDFPageObj_GetFillColor(anchor.handle, rPtr, gPtr, bPtr, aPtr)) {
    fill = [p.getValue(rPtr, "i32"), p.getValue(gPtr, "i32"), p.getValue(bPtr, "i32"), p.getValue(aPtr, "i32")]
  }

  const baseY = anchor.matrix.f
  const placed: PlacedLine[] = []

  for (let i = 0; i < layout.lines.length; i++) {
    const lineText = layout.lines[i]
    const obj = pdfium.FPDFPageObj_CreateTextObj(document, newFont, layout.fontSize)
    if (!obj) return { ok: false, error: `CreateTextObj failed on line ${i}` }
    if (!pdfium.FPDFText_SetText(obj, scratch.writeUtf16(lineText))) {
      return { ok: false, error: `SetText failed on line ${i}` }
    }

    const lineWidth = measureTextWidth(metrics, lineText, layout.fontSize)
    const x = lineX(left, boxWidth, lineWidth, align)
    // PDF's y axis grows UPWARD, so each successive line sits LOWER by
    // subtracting the line height.
    const y = baseY - i * layout.lineHeight

    // Identity scale: the size already lives on the text object, so the
    // matrix carries position only. Mixing both would multiply them.
    const m = scratch.malloc(24)
    p.setValue(m + 0, 1, "float")
    p.setValue(m + 4, 0, "float")
    p.setValue(m + 8, 0, "float")
    p.setValue(m + 12, 1, "float")
    p.setValue(m + 16, x, "float")
    p.setValue(m + 20, y, "float")
    if (!pdfium.FPDFPageObj_SetMatrix(obj, m)) return { ok: false, error: `SetMatrix failed on line ${i}` }

    pdfium.FPDFPageObj_SetFillColor(obj, fill[0], fill[1], fill[2], fill[3])
    pdfium.FPDFPage_InsertObject(page, obj)
    placed.push({ text: lineText, handle: obj, x, baselineY: y, width: lineWidth })
  }

  // Remove the originals only AFTER the replacements exist, so a failure
  // partway through never leaves the page with the old text deleted and
  // nothing drawn in its place.
  for (const piece of group) {
    if (!pdfium.FPDFPage_RemoveObject(page, piece.handle)) {
      return { ok: false, error: `RemoveObject failed for "${piece.text}"` }
    }
    pdfium.FPDFPageObj_Destroy(piece.handle)
  }

  const generated = opts.deferContentGeneration ? true : pdfium.FPDFPage_GenerateContent(page)
  return { ok: generated, lines: placed, layout }
}

/**
 * Delete a whole grouped line from the page.
 *
 * Removes EVERY object in the group: a line assembled from several pieces
 * (see grouping.ts) would otherwise be left half-deleted, with the visible
 * remainder impossible to select because the group it belonged to no
 * longer matches.
 */
export function removeTextGroup(
  pdfium: WrappedPdfiumModule,
  page: number,
  group: TextObjectInfo[],
): { ok: boolean; error?: string } {
  for (const piece of group) {
    if (!pdfium.FPDFPage_RemoveObject(page, piece.handle)) {
      return { ok: false, error: `FPDFPage_RemoveObject failed for "${piece.text}"` }
    }
    pdfium.FPDFPageObj_Destroy(piece.handle)
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/**
 * Shift a whole grouped line by a delta, in PDF points.
 *
 * Translates EVERY object in the group rather than just the anchor: a line
 * assembled from several pieces (see grouping.ts) would otherwise come
 * apart, with the first fragment moving and the rest staying put.
 *
 * Positive dy moves the line UP the page, following PDF's own axis, so a
 * caller converting from screen coordinates must flip it.
 */
export function translateTextGroup(
  pdfium: WrappedPdfiumModule,
  page: number,
  group: TextObjectInfo[],
  dx: number,
  dy: number,
  scratch: Scratch,
): { ok: boolean; error?: string } {
  for (const piece of group) {
    const m = piece.matrix
    const ptr = scratch.malloc(24)
    const p = pdfium.pdfium
    p.setValue(ptr + 0, m.a, "float")
    p.setValue(ptr + 4, m.b, "float")
    p.setValue(ptr + 8, m.c, "float")
    p.setValue(ptr + 12, m.d, "float")
    p.setValue(ptr + 16, m.e + dx, "float")
    p.setValue(ptr + 20, m.f + dy, "float")
    if (!pdfium.FPDFPageObj_SetMatrix(piece.handle, ptr)) {
      return { ok: false, error: `SetMatrix failed while moving "${piece.text}"` }
    }
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/**
 * Move a whole grouped line onto a DIFFERENT page of the same document.
 *
 * Deliberately a detach-and-re-attach, not a delete-and-rebuild. PDFium
 * hands ownership of the object back on FPDFPage_RemoveObject, and
 * re-registers its resources against whichever page it is inserted into
 * when that page's content is regenerated. So the object arrives carrying
 * its ORIGINAL embedded font — including a subset face that only contains
 * the glyphs this document happens to draw. Rebuilding the line from a
 * fallback font instead would silently change the typeface of any moved
 * catalogue heading, which is exactly the giveaway of a bad PDF editor.
 * (Verified end-to-end through a save/reopen round trip: an object can look
 * right in memory and still write a page whose resource dictionary lacks
 * the font, which renders blank.)
 *
 * `x`/`yBaseline` place the group's ANCHOR piece; every other piece keeps
 * its offset relative to that anchor, so a line assembled from several
 * fragments arrives intact instead of coming apart.
 *
 * The anchor is passed in rather than derived here: grouping.ts anchors an
 * RTL line on its RIGHTMOST piece (that being where the line actually
 * starts), and it is the same anchor whose matrix the UI was given to
 * compute these coordinates from. Re-deriving it as "leftmost" would put
 * every Hebrew line down a line-width away from where it was dropped.
 */
export function moveTextGroupToPage(
  pdfium: WrappedPdfiumModule,
  sourcePage: number,
  targetPage: number,
  group: TextObjectInfo[],
  anchor: TextObjectInfo,
  x: number,
  yBaseline: number,
  scratch: Scratch,
): { ok: boolean; error?: string } {
  if (group.length === 0) return { ok: false, error: "empty text group" }

  const dx = x - anchor.matrix.e
  const dy = yBaseline - anchor.matrix.f

  for (const piece of group) {
    if (!pdfium.FPDFPage_RemoveObject(sourcePage, piece.handle)) {
      return { ok: false, error: `FPDFPage_RemoveObject failed for "${piece.text}"` }
    }
    const m = piece.matrix
    const ptr = scratch.malloc(24)
    const p = pdfium.pdfium
    p.setValue(ptr + 0, m.a, "float")
    p.setValue(ptr + 4, m.b, "float")
    p.setValue(ptr + 8, m.c, "float")
    p.setValue(ptr + 12, m.d, "float")
    p.setValue(ptr + 16, m.e + dx, "float")
    p.setValue(ptr + 20, m.f + dy, "float")
    if (!pdfium.FPDFPageObj_SetMatrix(piece.handle, ptr)) {
      return { ok: false, error: `SetMatrix failed while moving "${piece.text}"` }
    }
    pdfium.FPDFPage_InsertObject(targetPage, piece.handle)
  }

  // BOTH pages changed and both must be regenerated — skipping the source
  // leaves the old page still drawing text it no longer owns.
  if (!pdfium.FPDFPage_GenerateContent(sourcePage)) {
    return { ok: false, error: "GenerateContent failed on the source page" }
  }
  if (!pdfium.FPDFPage_GenerateContent(targetPage)) {
    return { ok: false, error: "GenerateContent failed on the target page" }
  }
  return { ok: true }
}

/** Render one page to raw RGBA pixels, entirely through PDFium (no pdf.js
 * anywhere in this POC) — this IS the "preview".
 *
 * Returns raw pixels rather than an encoded image so the same call serves
 * both environments: Node encodes them to PNG (see render-png.ts), the
 * browser blits them straight into a canvas via ImageData. Encoding here
 * would have forced a Node-only dependency into shared code. */
export function renderPageToRGBA(
  pdfium: WrappedPdfiumModule, page: number, scale: number, scratch: Scratch,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const widthPt = pdfium.FPDF_GetPageWidthF(page)
  const heightPt = pdfium.FPDF_GetPageHeightF(page)
  const width = Math.max(1, Math.round(widthPt * scale))
  const height = Math.max(1, Math.round(heightPt * scale))

  const bitmap = pdfium.FPDFBitmap_Create(width, height, 0)
  if (!bitmap) throw new Error("FPDFBitmap_Create failed")
  // White background — FPDF_RenderPageBitmap only paints where content
  // exists; without this the buffer is whatever memory happened to hold.
  pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
  pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0)

  const bufPtr = pdfium.FPDFBitmap_GetBuffer(bitmap)
  const raw = scratch.readBytes(bufPtr, width * 4 * height)

  // PDFium's FPDFBitmap_Create(..., alpha=0) buffer is BGRx; both consumers
  // want RGBA, so the channel swap happens once, here.
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = raw[i * 4 + 2]
    rgba[i * 4 + 1] = raw[i * 4 + 1]
    rgba[i * 4 + 2] = raw[i * 4 + 0]
    rgba[i * 4 + 3] = 255
  }

  pdfium.FPDFBitmap_Destroy(bitmap)
  return { width, height, rgba }
}

/** Save the current in-memory document to real PDF bytes, via PDFium's own
 * FPDF_SaveAsCopy — the same engine that rendered it also writes it.
 * Returns Uint8Array (not Buffer) so this stays browser-safe. */
export function saveDocument(pdfium: WrappedPdfiumModule, document: number, scratch: Scratch): Uint8Array {
  const chunks: Uint8Array[] = []
  // FPDF_FILEWRITE is {version:int, WriteBlock:funcptr}. WriteBlock has the
  // C signature: int WriteBlock(FPDF_FILEWRITE* pThis, const void* data, unsigned long size).
  // HEAPU8 is read FRESH on every callback, never hoisted into a local.
  // Emscripten REPLACES the heap views whenever WASM memory grows, and a
  // large save grows it mid-write — a reference captured beforehand is
  // detached by the time the next chunk arrives, failing the save with
  // "Cannot perform Construct on a detached ArrayBuffer".
  const heapOf = (m: unknown) => (m as { HEAPU8: Uint8Array }).HEAPU8
  const writeBlock = pdfium.pdfium.addFunction((_pThis: number, data: number, size: number) => {
    chunks.push(new Uint8Array(heapOf(pdfium.pdfium).subarray(data, data + size)))
    return 1
  }, "iiii")

  // struct FPDF_FILEWRITE { int version; int (*WriteBlock)(...); } — two
  // 4-byte fields, function pointer stored as the second word.
  const fileWritePtr = scratch.malloc(8)
  pdfium.pdfium.setValue(fileWritePtr + 0, 1, "i32")
  pdfium.pdfium.setValue(fileWritePtr + 4, writeBlock, "i32")

  // flags=2 is FPDF_NO_INCREMENTAL: rewrite the file wholesale instead of
  // appending a change log. Incremental saves keep every superseded object
  // in the file, so a document edited object-by-object keeps all the OLD
  // text objects too — invisible, but paid for in bytes on every download.
  const ok = pdfium.FPDF_SaveAsCopy(document, fileWritePtr, 2)
  pdfium.pdfium.removeFunction(writeBlock)
  if (!ok) throw new Error("FPDF_SaveAsCopy failed")

  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}
