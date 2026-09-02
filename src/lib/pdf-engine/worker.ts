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
import { Scratch, type PdfRect, type WrappedPdfiumModule } from "./core"
import { getPdfium, getFallbackFont, type FallbackFontKey } from "./loader"
import {
  openDocument, listTextObjects, rebuildGroupWithWrappedText, renderPageToRGBA,
  type TextObjectInfo,
  saveDocument, translateTextGroup, removeTextGroup, moveTextGroupToPage, DocumentFonts, getFontData
} from "./text"
import { groupIntoLines, effectiveFontSize, isRtlText } from "./grouping"
import { flattenFormsIfLossless } from "./flatten"
import {
  listImageObjects, replaceImageBytes, removeImageObject, setImageRect,
  moveImageObjectToPage, renderImageObject, transformImageObject,
} from "./image"
import {
  listVectorGroups, removeVectorGroup, setVectorGroupRect,
} from "./vector"
import { renderRegion, renderRegionWithout } from "./patch"
import { applyTextStyle, readTextStyle, scaleTextSize, alignTextGroup } from "./textStyle"
import { listPages, buildDocumentFromPlan } from "./pages"
import { addTextOverlay, addImageOverlay } from "./overlay"
import { loadFontMetrics, measureTextWidth, type FontMetrics } from "./layout"
import { DocumentHistory } from "./history"
import { listPageLayers, reorderLayer } from "./layers"
import { clonePageObject, DUPLICATE_OFFSET_PTS } from "./duplicate"
import { cropImageObject } from "./crop"
import { transformObjectGroup } from "./objectGroup"
import { probeFontCoverage } from "./fontProbe"
import type {
  EngineMethods, EngineMethodName, EngineRequest, EngineResponse,
  EnginePage, EngineTextLine, EngineImage,
} from "./protocol"

interface OpenDoc {
  handle: number
  scratch: Scratch
  fonts: DocumentFonts
  history: DocumentHistory
}

/**
 * Every method that CHANGES the document.
 *
 * Listed once, here, rather than each handler remembering to record itself.
 * A handler added later that forgets to opt in would simply not be undoable,
 * and nobody would notice until they tried — whereas a list in one place can
 * be read against the handler map and checked.
 *
 * Deliberately excludes `open` and `close` (there is no "before" to return
 * to) and every read-only method.
 *
 * Typed as EngineMethodName rather than string, and that is load-bearing: the
 * first version of this list carried "removeVector" and "replaceVector",
 * neither of which exists — the real names are removeVectorGroup and
 * replaceVectorGroupWithImage. Deleting or replacing a piece of artwork would
 * simply not have been undoable, silently, and nothing would have failed.
 * With the name typed, a wrong one is a compile error.
 */
const MUTATING_METHODS = new Set<EngineMethodName>([
  "editTextLine", "removeTextLine", "moveTextLine", "moveTextLineToPage",
  "styleTextLine", "scaleTextLine", "alignTextLine",
  "replaceImage", "removeImage", "setImageRect", "transformImage",
  "moveImageToPage", "addImageOverlay", "addTextOverlay",
  "replaceVectorGroupWithImage", "removeVectorGroup", "reorderLayer",
  "setVectorGroupRect", "transformVectorGroup", "transformTextLine",
  "applyPagePlan", "addBlankPage", "duplicateSlot", "translateSlots", "cropImage",
  "removeSlots", "transformSlots", "duplicateSlots",
])

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

/**
 * Where a set of objects ENDED UP, after an operation renumbered them.
 *
 * The point of this is keeping a selection alive. A slot index is a position,
 * so moving or turning a group renumbers it, and the editor's held indices
 * become wrong the instant the operation lands. Clearing the selection was
 * the safe answer and a bad one: after every rotate the user had to
 * re-select everything to rotate again.
 *
 * A HANDLE, unlike an index, is an identity. It survives a transform — the
 * object is changed in place, never recreated — so the objects can be found
 * again afterwards and their new numbers reported back.
 *
 * Deduplicated, because two selected lines can land on one baseline and be
 * grouped into a single line by the operation; reporting that line twice
 * would put a duplicate in the selection.
 */
function locateSlots(
  pdfium: WrappedPdfiumModule, page: number, scratch: OpenDoc["scratch"],
  anchors: { kind: "text" | "image" | "vector"; handle: number }[],
): { kind: "text" | "image" | "vector"; index: number }[] {
  const textLines = groupIntoLines(listTextObjects(pdfium, page, scratch).filter(isEditableText))
  const images = listImageObjects(pdfium, page, scratch)
  const groups = listVectorGroups(pdfium, page, scratch)

  const found: { kind: "text" | "image" | "vector"; index: number }[] = []
  const seen = new Set<string>()
  for (const anchor of anchors) {
    let index = -1
    if (anchor.kind === "text") {
      index = textLines.findIndex((l) => l.objects.some((o) => o.handle === anchor.handle))
    } else if (anchor.kind === "image") {
      index = images.findIndex((i) => i.handle === anchor.handle)
    } else {
      index = groups.findIndex((g) => g.handles.includes(anchor.handle))
    }
    if (index < 0) continue
    const key = `${anchor.kind}:${index}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ kind: anchor.kind, index })
  }
  return found
}

/**
 * The same idea as locateSlots, but by BOX rather than by handle.
 *
 * Needed because a handle is only an identity WITHIN one page load. Close the
 * page and open it again and the handles are new — measured: reporting slots
 * by handle works for turning and moving, which happen inside a single
 * withPage, and returns the wrong objects entirely after duplicating, which
 * opens the page several times.
 *
 * A box survives that, and it identifies an object exactly as long as the
 * object has not moved — which is precisely the case this is used for.
 */
function locateSlotsByBox(
  pdfium: WrappedPdfiumModule, page: number, scratch: OpenDoc["scratch"],
  wanted: { kind: "text" | "image" | "vector"; bbox: PdfRect }[],
): { kind: "text" | "image" | "vector"; index: number }[] {
  const textLines = groupIntoLines(listTextObjects(pdfium, page, scratch).filter(isEditableText))
  const images = listImageObjects(pdfium, page, scratch)
  const groups = listVectorGroups(pdfium, page, scratch)

  // Tight. A copy lands a visible distance from its original, so this can
  // never confuse the two; loose enough only for floating-point drift.
  const near = (a: PdfRect, b: PdfRect) =>
    Math.abs(a.left - b.left) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5
    && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.top - b.top) < 0.5

  const found: { kind: "text" | "image" | "vector"; index: number }[] = []
  const seen = new Set<string>()
  for (const { kind, bbox } of wanted) {
    let index = -1
    if (kind === "text") {
      index = textLines.findIndex((line) => near(lineBox(line), bbox))
    } else if (kind === "image") {
      index = images.findIndex((i) => i.bounds !== null && near(i.bounds, bbox))
    } else {
      index = groups.findIndex((g) => near(g.bbox, bbox))
    }
    if (index < 0) continue
    const key = `${kind}:${index}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ kind, index })
  }
  return found
}

/** A grouped line's box: the union of the pieces it was assembled from. */
function lineBox(line: { objects: { bounds: PdfRect | null }[] }): PdfRect {
  const boxes = line.objects.map((o) => o.bounds).filter((b): b is PdfRect => b !== null)
  if (boxes.length === 0) return { left: 0, bottom: 0, right: 0, top: 0 }
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    bottom: Math.min(...boxes.map((b) => b.bottom)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.max(...boxes.map((b) => b.top)),
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
  const objs = listTextObjects(pdfium, page, scratch).filter(isEditableText)
  return groupIntoLines(objs).findIndex((g) => g.objects.some((o) => o.handle === handle))
}

function imageIndexOfHandle(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch, handle: number,
): number {
  return listImageObjects(pdfium, page, scratch).findIndex((im) => im.handle === handle)
}

/**
 * The area of the page an edit actually touched.
 *
 * Reported from the worker because only it holds the object before AND after
 * the change — the union of where it was and where it now is. The editor
 * uses it to repaint just that rectangle instead of the whole page, which is
 * the difference between roughly 20ms and 400ms per action.
 *
 * Padded slightly: a synthetic bold strokes OUTSIDE the glyph outline, and
 * anti-aliasing bleeds a pixel or two past any bounding box, so repainting
 * the exact box can leave a faint edge of the old drawing behind.
 */
const CHANGED_RECT_PAD_PTS = 3

/**
 * Which text objects this editor will offer as editable lines.
 *
 * Blank pieces are dropped because there is nothing to edit in them, and so
 * is anything still inside a Form XObject. Text in a form is normally lifted
 * onto the page when the document is opened — but that is only done when it
 * provably changes nothing on screen, and on files where it would have, the
 * form stays. PDFium cannot rewrite a form's instructions, so an edit to
 * text inside one is discarded when the file is saved.
 *
 * Offering a box for it anyway would be the worst of the options: it would
 * look editable, accept the edit, and lose it silently at the moment the
 * customer downloads their catalogue. Better to leave it plainly not
 * editable, as it was.
 */
function isEditableText(o: TextObjectInfo): boolean {
  return o.text.trim() !== "" && o.parentForm === null
}

function unionRect(
  a: PdfRect | null | undefined, b: PdfRect | null | undefined,
): PdfRect | undefined {
  if (!a) return b ?? undefined
  if (!b) return a ?? undefined
  return {
    left: Math.min(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
  }
}

function padRect(r: PdfRect | undefined): PdfRect | undefined {
  if (!r) return undefined
  return {
    left: r.left - CHANGED_RECT_PAD_PTS,
    bottom: r.bottom - CHANGED_RECT_PAD_PTS,
    right: r.right + CHANGED_RECT_PAD_PTS,
    top: r.top + CHANGED_RECT_PAD_PTS,
  }
}

/** The bounding box of one grouped text line, by index. */
function textLineRect(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch, index: number,
): PdfRect | undefined {
  const objs = listTextObjects(pdfium, page, scratch).filter(isEditableText)
  const line = groupIntoLines(objs)[index]
  if (!line) return undefined
  const bounds = line.objects.map((o) => o.bounds).filter((b): b is NonNullable<typeof b> => b !== null)
  if (bounds.length === 0) return undefined
  return {
    left: Math.min(...bounds.map((b) => b.left)),
    bottom: Math.min(...bounds.map((b) => b.bottom)),
    right: Math.max(...bounds.map((b) => b.right)),
    top: Math.max(...bounds.map((b) => b.top)),
  }
}

function imageRect(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch, index: number,
): PdfRect | undefined {
  return listImageObjects(pdfium, page, scratch)[index]?.bounds ?? undefined
}

const handlers: {
  [M in keyof EngineMethods]: (
    params: EngineMethods[M]["params"],
    ctx: { pdfium: WrappedPdfiumModule; transfer: Transferable[] },
  ) => Promise<EngineMethods[M]["result"]> | EngineMethods[M]["result"]
} = {
  open: ({ bytes }, { pdfium }) => {
    const firstScratch = new Scratch(pdfium)
    const firstAttempt = openDocument(pdfium, new Uint8Array(bytes), firstScratch)
    const docId = `doc${nextDocId++}`

    // Text inside a Form XObject is drawn on the page but is not a child of
    // it, so nothing downstream could see it: it had no edit box and could
    // not be selected, while identical text beside it worked. Editing it
    // where it sits is not possible either — PDFium never rewrites a form's
    // instructions, so the change is silently lost on save.
    //
    // Done once here, at the door, so no code past this point has to know
    // that forms exist. It is only kept when it provably changes nothing on
    // screen; when it does not, the document is thrown away and reopened
    // untouched, and that text stays uneditable rather than the design being
    // damaged to make it editable.
    let handle = firstAttempt
    let scratch = firstScratch
    if (!flattenFormsIfLossless(pdfium, handle, scratch)) {
      pdfium.FPDF_CloseDocument(handle)
      scratch.free()
      scratch = new Scratch(pdfium)
      handle = openDocument(pdfium, new Uint8Array(bytes), scratch)
    }

    docs.set(docId, {
      handle, scratch,
      fonts: new DocumentFonts(pdfium, handle),
      history: new DocumentHistory(),
    })
    return { docId, pages: toEnginePages(pdfium, handle) }
  },

  close: ({ docId }, { pdfium }) => {
    const doc = docs.get(docId)
    if (!doc) return { closed: false }
    pdfium.FPDF_CloseDocument(doc.handle)
    doc.scratch.free()
    // Freed explicitly: the history can be holding a hundred megabytes, and
    // leaving it to the garbage collector while a tab opens the next document
    // is how a session ends up holding two documents' worth of snapshots.
    doc.history.clear()
    docs.delete(docId)
    return { closed: true }
  },

  /**
   * Steps the document back or forward through its own history.
   *
   * The whole document is REPLACED: the old handle is closed and the snapshot
   * is opened in its place. Everything the UI is holding about the document —
   * which line is at which index, where the images are — is therefore stale
   * afterwards, which is why the pages are returned and the caller reloads.
   */
  stepHistory: ({ docId, direction }, { pdfium }) => {
    const doc = requireDoc(docId)
    const current = saveDocument(pdfium, doc.handle, doc.scratch)
    // Copied out of the WASM heap: saveDocument's buffer is scratch memory
    // and the next operation will write over it.
    const currentCopy = new Uint8Array(current.length)
    currentCopy.set(current)

    const target = direction === "undo"
      ? doc.history.undo(currentCopy)
      : doc.history.redo(currentCopy)
    if (!target) return { moved: false, ...doc.history.state() }

    pdfium.FPDF_CloseDocument(doc.handle)
    doc.scratch.free()
    const scratch = new Scratch(pdfium)
    const handle = openDocument(pdfium, target, scratch)
    docs.set(docId, {
      handle, scratch,
      fonts: new DocumentFonts(pdfium, handle),
      history: doc.history,
    })
    return {
      moved: true,
      pages: toEnginePages(pdfium, handle),
      ...doc.history.state(),
    }
  },

  historyState: ({ docId }) => requireDoc(docId).history.state(),

  /**
   * Copy a slot, onto this page or another one.
   *
   * Three kinds, two strategies. Pictures and artwork are rebuilt from what
   * can be read off the original (see duplicate.ts). TEXT is redrawn through
   * the same overlay call every new line goes through, because that call
   * already owns fonts, wrapping and right-to-left — duplicating text any
   * other way would be a second implementation of the hardest part of this
   * editor, and the two would drift.
   *
   * The copy is offset from the original rather than placed exactly on top:
   * a copy you cannot see is indistinguishable from nothing having happened.
   */
  cropImage: ({ docId, pageIndex, imageIndex, region }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const image = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!image) throw new Error(`No picture at index ${imageIndex} on page ${pageIndex}`)
      const r = cropImageObject(pdfium, image.handle, region, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not trim that picture")
      pdfium.FPDFPage_GenerateContent(page)
      return { ok: true, width: r.width ?? 0, height: r.height ?? 0 }
    })
  },

  translateSlots: ({ docId, pageIndex, slots, dxPts, dyPts }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      // EVERY handle is resolved before ANY object moves. A slot index is a
      // position, and moving one object renumbers the others — resolving as
      // we go would translate whatever had inherited the next number.
      const handles: number[] = []
      // One per slot, so the moved objects can be found again afterwards and
      // stay selected — moving renumbers them exactly as turning does.
      const anchors: { kind: "text" | "image" | "vector"; handle: number }[] = []
      const textLines = groupIntoLines(
        listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
      const images = listImageObjects(pdfium, page, doc.scratch)
      const groups = listVectorGroups(pdfium, page, doc.scratch)

      for (const slot of slots) {
        if (slot.kind === "text") {
          const line = textLines[slot.index]
          if (!line) continue
          handles.push(...line.objects.map((o) => o.handle))
          anchors.push({ kind: "text", handle: line.objects[0].handle })
        } else if (slot.kind === "image") {
          const image = images[slot.index]
          if (!image) continue
          handles.push(image.handle)
          anchors.push({ kind: "image", handle: image.handle })
        } else {
          const group = groups[slot.index]
          if (!group) continue
          handles.push(...group.handles)
          anchors.push({ kind: "vector", handle: group.handles[0] })
        }
      }
      if (handles.length === 0) return { ok: false, moved: 0, slots: [] }

      for (const handle of handles) {
        pdfium.FPDFPageObj_Transform(handle, 1, 0, 0, 1, dxPts, dyPts)
        // The clip travels with the object, or a shape-clipped photo would
        // slide out from behind its own mask.
        pdfium.FPDFPageObj_TransformClipPath(handle, 1, 0, 0, 1, dxPts, dyPts)
      }
      pdfium.FPDFPage_GenerateContent(page)
      return {
        ok: true,
        moved: handles.length,
        slots: locateSlots(pdfium, page, doc.scratch, anchors),
      }
    })
  },

  removeSlots: ({ docId, pageIndex, slots }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      // The same rule translateSlots follows, and for the same reason: a slot
      // index is a POSITION, so removing one object renumbers every object
      // after it. Deleting three things by index one at a time deletes the
      // first, then whatever inherited the second's number — which is how a
      // group delete quietly destroys the wrong objects.
      //
      // So every handle is resolved BEFORE anything is removed. Handles are
      // identities; they stay valid while their neighbours disappear.
      const textLines = groupIntoLines(
        listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
      const images = listImageObjects(pdfium, page, doc.scratch)
      const groups = listVectorGroups(pdfium, page, doc.scratch)

      // The text objects themselves are kept, not just their handles:
      // removeTextGroup takes the objects, and holding them is exactly as
      // safe — they were all resolved before anything was removed.
      const textGroups: (typeof textLines)[number]["objects"][] = []
      const imageHandles: number[] = []
      const vectorGroups: number[][] = []

      for (const slot of slots) {
        if (slot.kind === "text") {
          const line = textLines[slot.index]
          if (line) textGroups.push(line.objects)
        } else if (slot.kind === "image") {
          const image = images[slot.index]
          if (image) imageHandles.push(image.handle)
        } else {
          const group = groups[slot.index]
          if (group) vectorGroups.push([...group.handles])
        }
      }

      let removed = 0
      for (const objects of textGroups) {
        if (removeTextGroup(pdfium, page, objects).ok) removed++
      }
      for (const handle of imageHandles) {
        if (removeImageObject(pdfium, page, handle).ok) removed++
      }
      for (const handles of vectorGroups) {
        if (removeVectorGroup(pdfium, page, handles).ok) removed++
      }

      if (removed > 0) pdfium.FPDFPage_GenerateContent(page)
      return { ok: removed > 0, removed }
    })
  },

  transformSlots: ({ docId, pageIndex, slots, op }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      // Same rule as translateSlots and removeSlots: resolve everything
      // first. A transform MOVES an object, and text lines are numbered by
      // where they sit on the page, so turning one renumbers its neighbours.
      const textLines = groupIntoLines(
        listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
      const images = listImageObjects(pdfium, page, doc.scratch)
      const groups = listVectorGroups(pdfium, page, doc.scratch)

      const handles: number[] = []
      const boxes: { left: number; bottom: number; right: number; top: number }[] = []
      // One handle per SLOT, kept so the same objects can be found again
      // after the turn has renumbered them — that is what lets the selection
      // survive the operation.
      const anchors: { kind: "text" | "image" | "vector"; handle: number }[] = []

      for (const slot of slots) {
        if (slot.kind === "text") {
          const line = textLines[slot.index]
          if (!line) continue
          handles.push(...line.objects.map((o) => o.handle))
          for (const o of line.objects) if (o.bounds) boxes.push(o.bounds)
          anchors.push({ kind: "text", handle: line.objects[0].handle })
        } else if (slot.kind === "image") {
          const image = images[slot.index]
          if (!image) continue
          handles.push(image.handle)
          if (image.bounds) boxes.push(image.bounds)
          anchors.push({ kind: "image", handle: image.handle })
        } else {
          const group = groups[slot.index]
          if (!group) continue
          handles.push(...group.handles)
          boxes.push(group.bbox)
          anchors.push({ kind: "vector", handle: group.handles[0] })
        }
      }
      if (handles.length === 0 || boxes.length === 0) {
        return { ok: false, transformed: 0, slots: [] }
      }

      // ONE box around the whole selection, and every object turned about
      // ITS centre. That is what makes a group rotate as a single unit — the
      // items swing around each other and keep their arrangement — rather
      // than each spinning on the spot, which scatters a laid-out block.
      const bbox = {
        left: Math.min(...boxes.map((b) => b.left)),
        bottom: Math.min(...boxes.map((b) => b.bottom)),
        right: Math.max(...boxes.map((b) => b.right)),
        top: Math.max(...boxes.map((b) => b.top)),
      }

      const r = transformObjectGroup(pdfium, page, handles, bbox, op)
      if (!r.ok) throw new Error(r.error ?? "could not turn the selection")
      // Reported so the caller can keep the same things selected. Without
      // this the editor has to drop the selection, and turning something
      // twice means selecting it all over again in between.
      return {
        ok: true,
        transformed: handles.length,
        slots: locateSlots(pdfium, page, doc.scratch, anchors),
      }
    })
  },

  duplicateSlots: async ({ docId, pageIndex, slots }, ctx) => {
    const doc = requireDoc(docId)
    const { pdfium } = ctx

    // The SOURCES are recorded before any copy is inserted, so they can be
    // found again at the end. Inserting shifts index numbers around — a copy
    // landing above an original pushes it down — and the selection has to
    // survive that, or copying a group makes it fall apart.
    //
    // By BOX, not by handle. Duplicating opens and closes the page several
    // times, and a handle is only an identity within ONE page load: recorded
    // handles came back pointing at completely different lines. The originals
    // do not move, so their boxes still name them exactly.
    const sourceBoxes = withPage(pdfium, doc.handle, pageIndex, (page) => {
      const textLines = groupIntoLines(
        listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
      const images = listImageObjects(pdfium, page, doc.scratch)
      const groups = listVectorGroups(pdfium, page, doc.scratch)
      const found: { kind: "text" | "image" | "vector"; bbox: PdfRect }[] = []
      for (const slot of slots) {
        if (slot.kind === "text") {
          const line = textLines[slot.index]
          if (line) found.push({ kind: "text", bbox: lineBox(line) })
        } else if (slot.kind === "image") {
          const image = images[slot.index]
          if (image?.bounds) found.push({ kind: "image", bbox: image.bounds })
        } else {
          const group = groups[slot.index]
          if (group) found.push({ kind: "vector", bbox: group.bbox })
        }
      }
      return found
    })

    // LOWEST first. Text lines are numbered top-down by position and a copy
    // lands below its original, so working upward means each insertion only
    // renumbers lines that have already been dealt with.
    const ordered = [...slots].sort((a, b) => b.index - a.index)
    let copied = 0
    for (const slot of ordered) {
      const r = await handlers.duplicateSlot(
        { docId, pageIndex, kind: slot.kind, index: slot.index }, ctx)
      if (r.newIndex >= 0) copied++
    }

    return {
      ok: copied > 0,
      copied,
      // Where the ORIGINALS are now. Keeping them selected — rather than the
      // copies — means the group can be copied again, or dragged away leaving
      // the copies behind, which is what "duplicate" is usually for.
      slots: withPage(pdfium, doc.handle, pageIndex, (page) =>
        locateSlotsByBox(pdfium, page, doc.scratch, sourceBoxes)),
    }
  },

  duplicateSlot: async ({ docId, pageIndex, kind, index, toPageIndex, dxPts, dyPts }, { pdfium }) => {
    const doc = requireDoc(docId)
    const dx = dxPts ?? DUPLICATE_OFFSET_PTS
    const dy = dyPts ?? -DUPLICATE_OFFSET_PTS
    const target = toPageIndex ?? pageIndex

    if (kind === "text") {
      // Read on the source page, drawn on the target one — they are often the
      // same page, but pasting across pages is the same operation.
      const line = withPage(pdfium, doc.handle, pageIndex, (page) => {
        const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
        return groupIntoLines(objs)[index] ?? null
      })
      if (!line) throw new Error(`No text line at index ${index} on page ${pageIndex}`)

      const anchor = line.anchor
      // effectiveFontSize, not the matrix alone. A text object carries its
      // size in TWO places — the font size on the object and the scale in its
      // matrix — and which one holds it depends on where the object came
      // from. Text read from the original PDF usually has it in the matrix;
      // text this editor has written has matrix scale 1 and the size on the
      // object. Reading only the matrix therefore gave 1pt for anything that
      // had been edited or added, and the copy came out unreadably small
      // while copying untouched text looked perfect.
      const size = effectiveFontSize(anchor)
      const { bytes, metrics } = await font(isRtlText(line.text) ? "hebrew" : "regular")

      /**
       * How wide to make the copy's box.
       *
       * The original's own width is the starting point, but it cannot be the
       * answer on its own: the copy is redrawn in a bundled face whose
       * letters measure slightly differently, so a box sized to the original's
       * exact ink WRAPPED the copy — "Added line" came out as "Added" over
       * "line". A line is one line by definition, and its copy must be too.
       *
       * So the box is widened to whatever this text actually needs, when that
       * is more. Only when: a box made needlessly wide would push a
       * right-to-left copy to the wrong side, since right-aligned text sits
       * against the box's right edge.
       */
      const originalWidth = line.objects.reduce((w, o) => Math.max(w, o.bounds?.right ?? 0), 0)
        - Math.min(...line.objects.map((o) => o.bounds?.left ?? 0))
      const needed = measureTextWidth(metrics, line.text, size)
      const width = Math.max(1, originalWidth || size * 8, needed + 1)

      return withPage(pdfium, doc.handle, target, (page) => {
        const r = addTextOverlay(pdfium, doc.handle, page, {
          text: line.text,
          x: anchor.matrix.e + dx,
          y: anchor.matrix.f + dy,
          width,
          fontSize: size,
          // The overlay wants r/g/b only; the alpha the source carries is
          // not something a new line can express.
          color: { r: anchor.fill.r, g: anchor.fill.g, b: anchor.fill.b },
        }, bytes, metrics, doc.scratch, doc.fonts)
        if (!r.ok) throw new Error(r.error ?? "could not copy that text")
        pdfium.FPDFPage_GenerateContent(page)
        const after = groupIntoLines(
          listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
        // Identified by position, the same way any freshly added line is.
        let newIndex = -1
        let best = Infinity
        after.forEach((candidate, i) => {
          const left = Math.min(...candidate.objects.map((o) => o.bounds?.left ?? 0))
          const bottom = Math.min(...candidate.objects.map((o) => o.bounds?.bottom ?? 0))
          const distance = Math.hypot(left - (anchor.matrix.e + dx), bottom - (anchor.matrix.f + dy))
          if (distance < best) { best = distance; newIndex = i }
        })
        return { ok: true, newIndex }
      })
    }

    return withPage(pdfium, doc.handle, pageIndex, (sourcePage) => {
      const handles = kind === "image"
        ? (() => {
          const image = listImageObjects(pdfium, sourcePage, doc.scratch)[index]
          if (!image) throw new Error(`No picture at index ${index} on page ${pageIndex}`)
          return [image.handle]
        })()
        : (() => {
          const group = listVectorGroups(pdfium, sourcePage, doc.scratch)[index]
          if (!group) throw new Error(`No artwork at index ${index} on page ${pageIndex}`)
          return group.handles
        })()

      const drawOn = (page: number) => {
        let made = 0
        for (const handle of handles) {
          const r = clonePageObject(pdfium, doc.handle, page, handle, doc.scratch, dx, dy)
          if (r.ok) made += 1
        }
        if (made === 0) throw new Error("nothing could be copied")
        pdfium.FPDFPage_GenerateContent(page)
        return made
      }

      if (target === pageIndex) {
        drawOn(sourcePage)
        const newIndex = kind === "image"
          ? listImageObjects(pdfium, sourcePage, doc.scratch).length - 1
          : listVectorGroups(pdfium, sourcePage, doc.scratch).length - 1
        return { ok: true, newIndex }
      }

      return withPage(pdfium, doc.handle, target, (targetPage) => {
        drawOn(targetPage)
        const newIndex = kind === "image"
          ? listImageObjects(pdfium, targetPage, doc.scratch).length - 1
          : listVectorGroups(pdfium, targetPage, doc.scratch).length - 1
        return { ok: true, newIndex }
      })
    })
  },

  addBlankPage: ({ docId, atIndex, widthPts, heightPts }, { pdfium }) => {
    const doc = requireDoc(docId)
    const count = pdfium.FPDF_GetPageCount(doc.handle)
    // Clamped rather than trusted: PDFium takes an index without checking it,
    // and an out-of-range one is undefined behaviour rather than an error.
    const at = Math.max(0, Math.min(count, Math.round(atIndex)))
    const page = pdfium.FPDFPage_New(doc.handle, at, widthPts, heightPts)
    if (!page) throw new Error("could not add a page")
    // A page with no content stream is not a valid page; generating one on an
    // empty page produces the empty stream it needs.
    pdfium.FPDFPage_GenerateContent(page)
    pdfium.FPDF_ClosePage(page)
    return { pages: toEnginePages(pdfium, doc.handle) }
  },

  listLayers: ({ docId, pageIndex }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => ({
      // The panel wants what is on TOP at the top of its list, but the engine
      // works bottom-first because that is the page's own order. Reversed
      // here, once, so no caller has to remember which way round it is.
      layers: listPageLayers(pdfium, page, doc.scratch).map((l) => ({
        kind: l.kind, index: l.index,
        objectCount: l.objectIndices.length,
        text: l.text, bbox: l.bbox,
      })).reverse(),
    }))
  },

  reorderLayer: ({ docId, pageIndex, kind, index, toPosition }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const total = listPageLayers(pdfium, page, doc.scratch).length
      // The caller counts from the TOP, matching what it shows; the engine
      // counts from the bottom. Converted here rather than at either end.
      const fromBottom = total - 1 - toPosition
      const r = reorderLayer(pdfium, page, doc.scratch, { kind, index }, fromBottom)
      if (!r.ok) throw new Error(r.error ?? "could not move that layer")
      return { ok: true, newPosition: total - 1 - (r.newPosition ?? fromBottom) }
    })
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
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
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
    const fallback = await font(options?.font ?? (isRtlText(newText) ? "hebrew" : "regular"))
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)

      /**
       * Keep the page's OWN typeface when it can actually draw the new words.
       *
       * This is what stops a heading changing appearance the moment it is
       * edited, which every earlier version of this editor did. It is also
       * where the obvious implementation is dangerous: a font embedded in a
       * PDF is almost always a SUBSET carrying only the glyphs the document
       * originally used, so a line reading "Carnaby" edited to "Yash" once
       * rendered as "ash" — the Y simply did not exist.
       *
       * So the font is checked against the exact characters being written
       * before it is trusted, using the same coverage probe built for that
       * bug. Anything not fully covered falls back to a bundled face and
       * SAYS so, rather than dropping letters silently.
       */
      let chosen = fallback
      let usedDocumentFont = false
      let fellBackBecause: string | null = null
      const wantsDocumentFont = options?.font === undefined && !options?.useBundledFont

      if (wantsDocumentFont && line.anchor.fontHandle) {
        const embedded = getFontData(pdfium, line.anchor.fontHandle, doc.scratch)
        if (embedded.length === 0) {
          fellBackBecause = "the page's font is not embedded in the file"
        } else {
          const coverage = probeFontCoverage(embedded, newText)
          if (!coverage.parsed) {
            fellBackBecause = "the page's font could not be read"
          } else if (!coverage.allSafe) {
            const missing = coverage.chars.filter((c) => !c.safe).map((c) => c.char).join("")
            fellBackBecause = `the page's font has no ${missing.length > 1 ? "glyphs" : "glyph"} for ${missing}`
          } else {
            chosen = { bytes: embedded, metrics: loadFontMetrics(embedded) }
            usedDocumentFont = true
          }
        }
      }
      /**
       * The fallback is checked too, and this is not belt-and-braces.
       *
       * Falling back is only a rescue if the face fallen back TO can draw the
       * characters. The bundled faces are Latin and Hebrew; a degree sign, a
       * trademark mark or a Cyrillic name is in neither, so the letters would
       * simply not appear — which is the same silent loss the fallback exists
       * to prevent, arrived at one step later.
       *
       * Nothing is refused: the user asked for those words and gets what can
       * be drawn of them. But the ones that cannot be drawn are NAMED, so it
       * is a message rather than a mystery.
       */
      let unsupported = ""
      if (!usedDocumentFont) {
        const fallbackCoverage = probeFontCoverage(chosen.bytes, newText)
        if (fallbackCoverage.parsed && !fallbackCoverage.allSafe) {
          unsupported = fallbackCoverage.chars.filter((c) => !c.safe).map((c) => c.char).join("")
        }
      }

      const { bytes, metrics } = chosen
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
        usedDocumentFont,
        fellBackBecause,
        unsupportedCharacters: unsupported || null,
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
      const beforeRect = target.bounds ?? undefined
      const r = setImageRect(pdfium, page, target.handle, rect, target.bounds)
      if (!r.ok) throw new Error(r.error ?? "could not move the image")
      const newIndex = imageIndexOfHandle(pdfium, page, doc.scratch, target.handle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, imageRect(pdfium, page, doc.scratch, newIndex))),
      }
    })
  },

  renderPageRegion: ({ docId, pageIndex, rect, scale }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const patch = renderRegion(pdfium, page, rect, scale, doc.scratch)
      const out = new Uint8ClampedArray(patch.rgba).buffer
      transfer.push(out)
      return { width: patch.width, height: patch.height, rgba: out, x: patch.x, y: patch.y }
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
        const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
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

  setVectorGroupRect: ({ docId, pageIndex, vectorIndex, rect }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listVectorGroups(pdfium, page, doc.scratch)[vectorIndex]
      if (!target) throw new Error(`No artwork at index ${vectorIndex} on page ${pageIndex}`)
      const beforeRect = target.bbox
      const r = setVectorGroupRect(pdfium, page, target.handles, target.bbox, rect)
      if (!r.ok) throw new Error(r.error ?? "could not move the artwork")
      // Re-found by position rather than by index: moving artwork can change
      // where it sorts among the other groups on the page.
      const after = listVectorGroups(pdfium, page, doc.scratch)
      const newIndex = after.findIndex((g) => g.handles[0] === target.handles[0])
      return {
        ok: true,
        newIndex: newIndex >= 0 ? newIndex : vectorIndex,
        changedRect: padRect(unionRect(beforeRect, after[newIndex]?.bbox)),
      }
    })
  },

  /**
   * Turn or mirror a line of TEXT, exactly as a picture or a piece of artwork
   * turns.
   *
   * A line is several objects — one per run of identical styling — so they are
   * transformed together about the line's own centre. Turning each piece about
   * its own centre would scatter the words.
   *
   * Note what this does NOT do: it moves the glyphs, it does not re-lay the
   * text out sideways. That is the same thing that happens to a rotated
   * picture, and it is what "rotate" means for something already drawn.
   */
  transformTextLine: ({ docId, pageIndex, lineIndex, op }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)

      const boxes = line.objects.map((o) => o.bounds).filter((b): b is NonNullable<typeof b> => b !== null)
      if (boxes.length === 0) throw new Error("that text has no measurable box to turn about")
      const bbox = {
        left: Math.min(...boxes.map((b) => b.left)),
        bottom: Math.min(...boxes.map((b) => b.bottom)),
        right: Math.max(...boxes.map((b) => b.right)),
        top: Math.max(...boxes.map((b) => b.top)),
      }

      const r = transformObjectGroup(
        pdfium, page, line.objects.map((o) => o.handle), bbox, op)
      if (!r.ok) throw new Error(r.error ?? "could not turn that text")

      // Lines are numbered by POSITION, and turning one moves it, so its
      // number can change. Reported back the same way every other mover does.
      const after = groupIntoLines(
        listTextObjects(pdfium, page, doc.scratch).filter(isEditableText))
      const newIndex = after.findIndex((l) => l.text === line.text)
      return { ok: true, newIndex }
    })
  },

  transformVectorGroup: ({ docId, pageIndex, vectorIndex, op }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listVectorGroups(pdfium, page, doc.scratch)[vectorIndex]
      if (!target) throw new Error(`No artwork at index ${vectorIndex} on page ${pageIndex}`)
      const beforeRect = target.bbox
      const r = transformObjectGroup(pdfium, page, target.handles, target.bbox, op)
      if (!r.ok) throw new Error(r.error ?? "could not turn the artwork")
      const after = listVectorGroups(pdfium, page, doc.scratch)
      const newIndex = after.findIndex((g) => g.handles[0] === target.handles[0])
      return {
        ok: true,
        newIndex: newIndex >= 0 ? newIndex : vectorIndex,
        changedRect: padRect(unionRect(beforeRect, after[newIndex]?.bbox)),
      }
    })
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
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
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
      const objs = listTextObjects(pdfium, src, doc.scratch).filter(isEditableText)
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
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const beforeRect = textLineRect(pdfium, page, doc.scratch, lineIndex)
      const r = applyTextStyle(pdfium, page, line.objects, style, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not style the text")
      const newIndex = textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, textLineRect(pdfium, page, doc.scratch, newIndex))),
      }
    })
  },

  scaleTextLine: ({ docId, pageIndex, lineIndex, factor }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const beforeRect = textLineRect(pdfium, page, doc.scratch, lineIndex)
      const r = scaleTextSize(pdfium, page, line.objects, line.anchor, factor, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not resize the text")
      const newIndex = textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, textLineRect(pdfium, page, doc.scratch, newIndex))),
      }
    })
  },

  alignTextLine: ({ docId, pageIndex, lineIndex, alignment }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const beforeRect = textLineRect(pdfium, page, doc.scratch, lineIndex)
      // The same margin new content is inset by, so an aligned line lines up
      // with anything else placed on the page.
      const r = alignTextGroup(pdfium, page, line.objects, alignment, 24, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not align the text")
      const newIndex = textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, textLineRect(pdfium, page, doc.scratch, newIndex))),
      }
    })
  },

  transformImage: ({ docId, pageIndex, imageIndex, op }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const target = listImageObjects(pdfium, page, doc.scratch)[imageIndex]
      if (!target) throw new Error(`No image at index ${imageIndex} on page ${pageIndex}`)
      const beforeRect = target.bounds ?? undefined
      const r = transformImageObject(pdfium, page, target.handle, target.bounds, op)
      if (!r.ok) throw new Error(r.error ?? "could not transform the image")
      const newIndex = imageIndexOfHandle(pdfium, page, doc.scratch, target.handle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, imageRect(pdfium, page, doc.scratch, newIndex))),
      }
    })
  },

  moveTextLine: ({ docId, pageIndex, lineIndex, dx, dy }, { pdfium }) => {
    const doc = requireDoc(docId)
    return withPage(pdfium, doc.handle, pageIndex, (page) => {
      const objs = listTextObjects(pdfium, page, doc.scratch).filter(isEditableText)
      const line = groupIntoLines(objs)[lineIndex]
      if (!line) throw new Error(`No text line at index ${lineIndex} on page ${pageIndex}`)
      const anchorHandle = line.anchor.handle
      const beforeRect = textLineRect(pdfium, page, doc.scratch, lineIndex)
      const r = translateTextGroup(pdfium, page, line.objects, dx, dy, doc.scratch)
      if (!r.ok) throw new Error(r.error ?? "could not move the text")
      const newIndex = textLineIndexOfHandle(pdfium, page, doc.scratch, anchorHandle)
      return {
        ok: true, newIndex,
        changedRect: padRect(unionRect(beforeRect, textLineRect(pdfium, page, doc.scratch, newIndex))),
      }
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

  savePage: ({ docId, pageIndex }, { pdfium, transfer }) => {
    const doc = requireDoc(docId)
    // The SAME machinery the page organizer uses, with a plan of one page.
    // Importing rather than deleting the others leaves the open document
    // completely untouched — saving a page as a template must not disturb
    // the catalogue the user is still working on.
    const built = buildDocumentFromPlan(
      pdfium, doc.handle, [{ sourceIndex: pageIndex }], doc.scratch)
    if (!built.ok || !built.document) {
      throw new Error(built.error ?? `could not extract page ${pageIndex}`)
    }
    try {
      const saved = saveDocument(pdfium, built.document, doc.scratch)
      const out = new Uint8Array(saved.length)
      out.set(saved)
      transfer.push(out.buffer)
      return { bytes: out.buffer }
    } finally {
      // Closed whatever happened: this document exists only to be written
      // out, and leaking it would pin a page's worth of WASM memory for the
      // life of the session.
      pdfium.FPDF_CloseDocument(built.document)
    }
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

    // Recorded here, at the ONE door every operation comes through, rather
    // than inside each handler. Two things follow from that: a new mutating
    // handler is undoable the moment its name is on the list, and the
    // snapshot is taken strictly BEFORE the change with no handler able to
    // half-apply something first.
    //
    // If the handler then throws, the snapshot is dropped again — an undo
    // step that restores the state you are already in is not an undo, it is a
    // key press that appears to do nothing.
    const docId = (params as { docId?: string } | undefined)?.docId
    const target = MUTATING_METHODS.has(method as EngineMethodName) && docId
      ? docs.get(docId)
      : undefined
    let snapshot: Uint8Array | null = null
    if (target) {
      const saved = saveDocument(pdfium, target.handle, target.scratch)
      snapshot = new Uint8Array(saved.length)
      snapshot.set(saved)
    }

    let result: unknown
    try {
      result = await handler(params, { pdfium, transfer })
    } catch (err) {
      snapshot = null
      throw err
    }
    // Pushed only once the change has actually happened. The document the
    // handler acted on is looked up again because stepHistory replaces the
    // OpenDoc wholesale, and a stale reference would push onto a history the
    // document no longer owns.
    if (snapshot && docId) docs.get(docId)?.history.push(snapshot)
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
