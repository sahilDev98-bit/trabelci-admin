/// <reference lib="webworker" />
/**
 * The PDF engine worker.
 *
 * Everything PDFium does happens here, off the UI thread. That is not a
 * nicety: editing every text line of a 14-page catalogue takes over a
 * second of solid CPU, and on the main thread that is a second of frozen
 * scrolling, frozen buttons and a stalled spinner. In a worker the UI stays
 * responsive and can show real progress.
 *
 * The worker owns all PDFium state (open documents, their scratch
 * allocators, their embedded-font caches). The UI thread never holds a
 * pointer — it holds a docId string — so there is no way for it to use a
 * handle after the document behind it has been closed.
 */
import { Scratch, type WrappedPdfiumModule } from "./core"
import { getPdfium, getFallbackFont, type FallbackFontKey } from "./loader"
import {
  openDocument, listTextObjects, rebuildGroupWithWrappedText, renderPageToRGBA,
  saveDocument, translateTextGroup, removeTextGroup, moveTextGroupToPage, DocumentFonts,
} from "./text"
import { groupIntoLines, effectiveFontSize, isRtlText } from "./grouping"
import {
  listImageObjects, replaceImageBytes, removeImageObject, setImageRect,
  moveImageObjectToPage, renderImageObject, transformImageObject,
} from "./image"
import { listVectorGroups, removeVectorGroup } from "./vector"
import { renderRegionWithout } from "./patch"
import { applyTextStyle, readTextStyle, scaleTextSize, alignTextGroup } from "./textStyle"
import { listPages, buildDocumentFromPlan } from "./pages"
import { addTextOverlay, addImageOverlay } from "./overlay"
import { loadFontMetrics, type FontMetrics } from "./layout"
import type {
  EngineMethods, EngineRequest, EngineResponse, EnginePage, EngineTextLine, EngineImage,
} from "./protocol"

interface OpenDoc {
  handle: number
  scratch: Scratch
  fonts: DocumentFonts
}

const docs = new Map<string, OpenDoc>()
let nextDocId = 1

/** Font bytes + parsed metrics, loaded once per worker and shared by every
 * document — the bytes are only re-embedded per document, which
 * DocumentFonts already de-duplicates. */
const fontCache = new Map<FallbackFontKey, { bytes: Uint8Array; metrics: FontMetrics }>()

async function font(key: FallbackFontKey) {
  let entry = fontCache.get(key)
  if (!entry) {
    const bytes = await getFallbackFont(key)
    entry = { bytes, metrics: loadFontMetrics(bytes) }
    fontCache.set(key, entry)
  }
  return entry
}

function requireDoc(docId: string): OpenDoc {
  const doc = docs.get(docId)
  if (!doc) throw new Error(`Unknown or already-closed document: ${docId}`)
  return doc
}

function toEnginePages(pdfium: WrappedPdfiumModule, handle: number): EnginePage[] {
  return listPages(pdfium, handle).map((p) => ({
    index: p.index, widthPts: p.widthPts, heightPts: p.heightPts, rotation: p.rotation,
  }))
}

/** Runs `fn` with the page loaded, and always closes it — a page left open
 * pins memory for the life of the document. */
function withPage<T>(pdfium: WrappedPdfiumModule, handle: number, pageIndex: number, fn: (page: number) => T): T {
  const page = pdfium.FPDF_LoadPage(handle, pageIndex)
  if (!page) throw new Error(`Failed to load page ${pageIndex}`)
  try {
    return fn(page)
  } finally {
    pdfium.FPDF_ClosePage(page)
  }
}

/** Both pages held open at once — a cross-page move detaches from one and
 * inserts into the other, so neither may be closed mid-transfer. */
function withTwoPages<T>(
  pdfium: WrappedPdfiumModule, handle: number, aIndex: number, bIndex: number,
  fn: (a: number, b: number) => T,
): T {
  const a = pdfium.FPDF_LoadPage(handle, aIndex)
  if (!a) throw new Error(`Failed to load page ${aIndex}`)
  const b = pdfium.FPDF_LoadPage(handle, bIndex)
  if (!b) {
    pdfium.FPDF_ClosePage(a)
    throw new Error(`Failed to load page ${bIndex}`)
  }
  try {
    return fn(a, b)
  } finally {
    pdfium.FPDF_ClosePage(b)
    pdfium.FPDF_ClosePage(a)
  }
}

/**
 * Where an object ended up after being moved.
 *
 * Needed because an index is not a stable identity here. Text lines are
 * grouped and then sorted BY POSITION (see grouping.ts), so moving a line
 * up the page genuinely renumbers it; a cross-page move renumbers on the
 * page it lands on. Keeping the editor's selection pointing at the old
 * number would quietly select a DIFFERENT line after the move.
 *
 * The object handles survive every move path — translate, transform, and
 * the detach/re-insert used across pages — so the thing that moved can be
 * found again exactly rather than guessed at by position or content.
 */
function textLineIndexOfHandle(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch, handle: number,
): number {
  const objs = listTextObjects(pdfium, page, scratch).filter((o) => o.text.trim() !== "")
  return groupIntoLines(objs).findIndex((g) => g.objects.some((o) => o.handle === handle))
}

function imageIndexOfHandle(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch, handle: number,
): number {
  return listImageObjects(pdfium, page, scratch).findIndex((im) => im.handle === handle)
}

const handlers: {
  [M in keyof EngineMethods]: (
    params: EngineMethods[M]["params"],
    ctx: { pdfium: WrappedPdfiumModule; transfer: Transferable[] },
  ) => Promise<EngineMethods[M]["result"]> | EngineMethods[M]["result"]
} = {
  open: ({ bytes }, { pdfium }) => {
    const scratch = new Scratch(pdfium)
    const handle = openDocument(pdfium, new Uint8Array(bytes), scratch)
    const docId = `doc${nextDocId++}`
    docs.set(docId, { handle, scratch, fonts: new DocumentFonts(pdfium, handle) })
    return { docId, pages: toEnginePages(pdfium, handle) }
  },

  close: ({ docId }, { pdfium }) => {
    const doc = docs.get(docId)
    if (!doc) return { closed: false }
    pdfium.FPDF_CloseDocument(doc.handle)
    doc.scratch.free()
    docs.delete(docId)
    return { closed: true }
  },

  listPages: ({ docId }, { pdfium }) => ({ pages: toEnginePages(pdfium, requireDoc(docId).handle) }),

  renderPage: ({ docId, pageIndex, scale }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const { width, height, rgba } = renderPageToRGBA(pdfium, page, scale, doc.scratch)
      // Copy into a standalone buffer so it can be TRANSFERRED to the UI
      // thread (zero-copy) rather than structured-cloned.
      const out = new Uint8Array(rgba.length)
      out.set(rgba)
      transfer.push(out.buffer)
      return { width, height, rgba: out.buffer }
    })
  },

  listTextLines: ({ docId, pageIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const lines: EngineTextLine[] = groupIntoLines(objs).map((line, lineIndex) => {
        const left = Math.min(...line.objects.map((o) => o.bounds?.left ?? o.matrix.e))
        const right = Math.max(...line.objects.map((o) => o.bounds?.right ?? o.matrix.e))
        const bottom = Math.min(...line.objects.map((o) => o.bounds?.bottom ?? o.matrix.f))
        const top = Math.max(...line.objects.map((o) => o.bounds?.top ?? o.matrix.f))
        return {
          lineIndex,
          text: line.text,
          pieceCount: line.objects.length,
          fontSize: effectiveFontSize(line.anchor),
          bbox: { left, bottom, right, top },
          matrix: line.anchor.matrix,
          fontName: line.anchor.fontBaseName,
          direction: isRtlText(line.text) ? "rtl" : "ltr",
          color: line.anchor.fill,
          ...(() => {
            const style = readTextStyle(pdfium, line.anchor)
            return { bold: style.bold, italic: style.italic }
          })(),
        }
      })
      return { lines }
    })
  },

  editTextLine: async ({ docId, pageIndex, lineIndex, newText, options }, { pdfium }) => {
    const doc = requireDoc(docId)
    const { bytes, metrics } = await font(options?.font ?? (isRtlText(newText) ? "hebrew" : "regular"))
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const r = rebuildGroupWithWrappedText(
        pdfium, doc.handle, page, line.objects, newText, bytes, metrics, doc.scratch,
        {
          maxWidth: options?.maxWidth,
          fontSize: options?.fontSize,
          maxHeight: options?.maxHeight,
          lineHeightRatio: options?.lineHeightRatio,
          minFontScale: options?.minFontScale,
          align: options?.align,
          fonts: doc.fonts,
        },
      )
      if (!r.ok) throw new Error(r.error ?? "text edit failed")
      return {
        ok: true,
        lines: r.layout?.lines ?? [],
        fontSize: r.layout?.fontSize ?? 0,
        shrunk: r.layout?.shrunk ?? false,
        overflows: r.layout?.overflows ?? false,
      }
    })
  },

  listImages: ({ docId, pageIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const images: EngineImage[] = listImageObjects(pdfium, page, doc.scratch).map((im, imageIndex) => ({
        imageIndex,
        bbox: im.bounds,
        pixelWidth: im.pixelWidth,
        pixelHeight: im.pixelHeight,
        hasClipPath: im.hasClipPath,
        filters: im.filters,
      }))
      return { images }
    })
  },

  replaceImage: ({ docId, pageIndex, imageIndex, bytes, kind }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${pageIndex}`)
      const r = replaceImageBytes(pdfium, page, target.handle, new Uint8Array(bytes), kind, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "image replace failed")
      pdfium.FPDFPage_GenerateContent(page)
      return { ok: true }
    })
  },

  removeImage: ({ docId, pageIndex, imageIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${pageIndex}`)
      const r = removeImageObject(pdfium, page, target.handle)
      if (!r.ok) throw new Error(r.error ?? "image remove failed")
      return { ok: true }
    })
  },

  setImageRect: ({ docId, pageIndex, imageIndex, rect }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${pageIndex}`)
      // The current matrix goes with it so a clipped photo's frame is
      // carried along instead of being left behind.
      const r = setImageRect(pdfium, page, target.handle, rect, target.bounds)
      if (!r.ok) throw new Error(r.error ?? "could not move the image")
      return { ok: true, newIndex: imageIndexOfHandle(pdfium, page, doc.scratch, target.handle) }
    })
  },

  renderImagePreview: ({ docId, pageIndex, imageIndex }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      const empty = { width: 0, height: 0, rgba: new ArrayBuffer(0) }
      if (!target) return empty
      const rendered = renderImageObject(pdfium, doc.handle, page, target.handle, doc.scratch)
      if (!rendered) return empty
      const out = new Uint8Array(rendered.rgba).buffer
      transfer.push(out)
      return { width: rendered.width, height: rendered.height, rgba: out }
    })
  },

  renderCleanPatch: ({ docId, pageIndex, kind, index, scale }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const empty = { width: 0 as const, height: 0 as const, rgba: new ArrayBuffer(0) }

      let objects: { index: number; handle: number }[] = []
      let rect: { left: number; bottom: number; right: number; top: number } | null = null

      if (kind === "text") {
        const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
        const line = groupIntoLines(objs)[index]
        if (!line) return empty
        objects = line.objects.map((o) => ({ index: o.index, handle: o.handle }))
        // The union of the pieces' own boxes, which is the area the line
        // actually covers — a caption's slot is not one rectangle in the PDF.
        const bounds = line.objects.map((o) => o.bounds).filter((b) => b !== null)
        if (bounds.length === 0) return empty
        rect = {
          left: Math.min(...bounds.map((b) => b!.left)),
          bottom: Math.min(...bounds.map((b) => b!.bottom)),
          right: Math.max(...bounds.map((b) => b!.right)),
          top: Math.max(...bounds.map((b) => b!.top)),
        }
      } else {
        const target = listImageObjects(pdfium, page, doc.scratch)[index]
        if (!target?.bounds) return empty
        objects = [{ index: target.index, handle: target.handle }]
        rect = target.bounds
      }

      if (!rect || rect.right <= rect.left || rect.top <= rect.bottom) return empty
      const patch = renderRegionWithout(pdfium, page, objects, rect, scale, doc.scratch)
      // Copied into its own buffer so it can be transferred rather than
      // cloned across the worker boundary.
      const out = new Uint8ClampedArray(patch.rgba).buffer
      transfer.push(out)
      return { width: patch.width, height: patch.height, rgba: out }
    })
  },

  listVectorGroups: ({ docId, pageIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => ({
      groups: listVectorGroups(pdfium, page, doc.scratch).map((g) => ({
        vectorIndex: g.index,
        bbox: g.bbox,
        pathCount: g.pathCount,
      })),
    }))
  },

  removeVectorGroup: ({ docId, pageIndex, vectorIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listVectorGroups(pdfium, page, doc.scratch)[vectorIndex]
      if (!target) throw new Error(`No artwork at index ${vectorIndex} on page ${pageIndex}`)
      const r = removeVectorGroup(pdfium, page, target.handles)
      if (!r.ok) throw new Error(r.error ?? "could not delete the artwork")
      return { ok: true }
    })
  },

  replaceVectorGroupWithImage: ({ docId, pageIndex, vectorIndex, bytes, kind }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listVectorGroups(pdfium, page, doc.scratch)[vectorIndex]
      if (!target) throw new Error(`No artwork at index ${vectorIndex} on page ${pageIndex}`)
      // The image goes in exactly the box the artwork occupied, so a swapped
      // logo lands where the old one was rather than at a corner.
      const { left, bottom, right, top } = target.bbox
      const removed = removeVectorGroup(pdfium, page, target.handles)
      if (!removed.ok) throw new Error(removed.error ?? "could not remove the artwork")
      const r = addImageOverlay(
        pdfium, doc.handle, page,
        { x: left, y: bottom, width: right - left, height: top - bottom },
        new Uint8Array(bytes), kind, doc.scratch,
      )
      if (!r.ok) throw new Error(r.error ?? "could not place the replacement image")
      // Regenerated again: removeVectorGroup already wrote the page once,
      // and the new image object is only committed to the content stream by
      // a further pass. Without this the artwork vanishes and nothing takes
      // its place.
      if (!pdfium.FPDFPage_GenerateContent(page)) {
        throw new Error("GenerateContent failed after placing the replacement image")
      }
      return { ok: true }
    })
  },

  removeTextLine: ({ docId, pageIndex, lineIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const r = removeTextGroup(pdfium, page, line.objects)
      if (!r.ok) throw new Error(r.error ?? "could not delete the text")
      return { ok: true }
    })
  },

  moveTextLineToPage: ({ docId, sourcePageIndex, lineIndex, targetPageIndex, x, yBaseline }, { pdfium }) => {
    const doc = requireDoc(docId)
    if (sourcePageIndex === targetPageIndex) throw new Error("source and target page are the same")
    return withTwoPages(pdfium, doc.handle, sourcePageIndex, targetPageIndex, (src, dst) => {
      const objs = listTextObjects(pdfium, src, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${sourcePageIndex}`)
      const anchorHandle = line.anchor.handle
      const r = moveTextGroupToPage(pdfium, src, dst, line.objects, line.anchor, x, yBaseline, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not move the text to that page")
      return { ok: true, newIndex: textLineIndexOfHandle(pdfium, dst, doc.scratch, anchorHandle) }
    })
  },

  moveImageToPage: ({ docId, sourcePageIndex, imageIndex, targetPageIndex, rect }, { pdfium }) => {
    const doc = requireDoc(docId)
    if (sourcePageIndex === targetPageIndex) throw new Error("source and target page are the same")
    return withTwoPages(pdfium, doc.handle, sourcePageIndex, targetPageIndex, (src, dst) => {
      const target = listImageObjects(pdfium, src, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${sourcePageIndex}`)
      const r = moveImageObjectToPage(pdfium, src, dst, target.handle, rect, target.bounds)
      if (!r.ok) throw new Error(r.error ?? "could not move the image to that page")
      return { ok: true, newIndex: imageIndexOfHandle(pdfium, dst, doc.scratch, target.handle) }
    })
  },

  styleTextLine: ({ docId, pageIndex, lineIndex, style }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const r = applyTextStyle(pdfium, page, line.objects, style, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not style the text")
      return { ok: true, newIndex: textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle) }
    })
  },

  scaleTextLine: ({ docId, pageIndex, lineIndex, factor }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const r = scaleTextSize(pdfium, page, line.objects, line.anchor, factor, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not resize the text")
      return { ok: true, newIndex: textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle) }
    })
  },

  alignTextLine: ({ docId, pageIndex, lineIndex, alignment }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      // The same margin new content is inset by, so an aligned line lines up
      // with anything else placed on the page.
      const r = alignTextGroup(pdfium, page, line.objects, alignment, 24, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not align the text")
      return { ok: true, newIndex: textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle) }
    })
  },

  transformImage: ({ docId, pageIndex, imageIndex, op }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${pageIndex}`)
      const r = transformImageObject(pdfium, page, target.handle, target.bounds, op)
      if (!r.ok) throw new Error(r.error ?? "could not transform the image")
      return { ok: true, newIndex: imageIndexOfHandle(pdfium, page, doc.scratch, target.handle) }
    })
  },

  moveTextLine: ({ docId, pageIndex, lineIndex, dx, dy }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter((o) => o.text.trim() !== "")
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const r = translateTextGroup(pdfium, page, line.objects, dx, dy, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not move the text")
      return { ok: true, newIndex: textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle) }
    })
  },

  addTextOverlay: async ({ docId, pageIndex, overlay }, { pdfium }) => {
    const doc = requireDoc(docId)
    const { bytes, metrics } = await font(overlay.font ?? (isRtlText(overlay.text) ? "hebrew" : "regular"))
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const r = addTextOverlay(pdfium, doc.handle, page, overlay, bytes, metrics, doc.scratch, doc.fonts)
      if (!r.ok) throw new Error(r.error ?? "text overlay failed")
      pdfium.FPDFPage_GenerateContent(page)
      return { ok: true }
    })
  },

  addImageOverlay: ({ docId, pageIndex, overlay, bytes, kind }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const r = addImageOverlay(pdfium, doc.handle, page, overlay, new Uint8Array(bytes), kind, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "image overlay failed")
      pdfium.FPDFPage_GenerateContent(page)
      // Reported so the caller can select it straight away. An image that
      // lands with no handles showing reads as "nothing happened", which is
      // how the fixed top-left placement felt when a logo covered its
      // corners.
      const added = r.handles?.[0]
      const newIndex = added !== undefined
        ? imageIndexOfHandle(pdfium, page, doc.scratch, added)
        : listImageObjects(pdfium, page, doc.scratch).length - 1
      return { ok: true, newIndex }
    })
  },

  applyPagePlan: ({ docId, plan }, { pdfium }) => {
    const doc = requireDoc(docId)
    const built = buildDocumentFromPlan(pdfium, doc.handle, plan, doc.scratch)
    if (!built.ok || !built.document) throw new Error(built.error ?? "page plan failed")

    // The plan produces a NEW document. Swap it in under the same id and
    // dispose of the old one, so callers keep one stable handle for the
    // whole session instead of having to re-bind after every page change.
    pdfium.FPDF_CloseDocument(doc.handle)
    doc.handle = built.document
    doc.fonts = new DocumentFonts(pdfium, built.document)
    return { docId, pages: toEnginePages(pdfium, built.document) }
  },

  save: ({ docId }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    const saved = saveDocument(pdfium, doc.handle, doc.scratch)
    const out = new Uint8Array(saved.length)
    out.set(saved)
    transfer.push(out.buffer)
    return { bytes: out.buffer }
  },
}

self.onmessage = async (event: MessageEvent<EngineRequest>) => {
  const { id, method, params } = event.data
  const transfer: Transferable[] = []
  try {
    const pdfium = await getPdfium()
    const handler = handlers[method] as (
      p: unknown, c: { pdfium: WrappedPdfiumModule; transfer: Transferable[] },
    ) => Promise<unknown> | unknown
    if (!handler) throw new Error(`Unknown engine method: ${method}`)
    const result = await handler(params, { pdfium, transfer })
    const response: EngineResponse = { id, ok: true, result }
    ;(self as DedicatedWorkerGlobalScope).postMessage(response, transfer)
  } catch (err) {
    const response: EngineResponse = {
      id, ok: false,
      error: err instanceof Error ? `${err.message}` : String(err),
    }
    ;(self as DedicatedWorkerGlobalScope).postMessage(response)
  }
}
