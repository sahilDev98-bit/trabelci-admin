import type { PdfRect } from "@/lib/pdf-engine"
import { PRODUCT_FIELDS } from "./productFields"

/**
 * Which boxes on the page hold a PRODUCT'S details rather than fixed text.
 *
 * This is the foundation of templates (Point 5 of the brief) and of swapping
 * one product for another (Point 6). A box marked "this is the SKU" stops
 * being a line of text that happens to read 100201305 and becomes a place
 * where any product's SKU can go.
 *
 * ── How a mark knows what it is attached to ──
 *
 * By WHERE THE BOX IS, the same way locks.ts does it, and for the same
 * reason: every slot in this editor is numbered by position, and those
 * numbers change whenever anything is added, removed or reordered. A mark
 * keyed by index would silently transfer itself to whatever inherited the
 * number — so the SKU slot would quietly become the price slot.
 *
 * But there is a real difference from a lock, and it is the whole difficulty
 * here. A LOCKED object cannot move, so its rectangle is stable by
 * definition. A marked object very much can move — positioning it is the
 * normal thing to do while designing a page. So the editor re-anchors a mark
 * when the box it is on moves; see useProductSlotAnchor in the editor.
 *
 * ── What a mark is not ──
 *
 * It is not stored in the PDF; the format has nowhere to put it. Marks last
 * for the editing session, and are made permanent only by saving the page as
 * a template — which is the next step, and the reason this one exists.
 */

export type SlotKind = "text" | "image" | "vector"

/** The photo is its own field id: it is not in PRODUCT_FIELDS, because that
 * list is text a box can be filled with and this one is a picture. */
export const PRODUCT_PHOTO_FIELD = "photo"

export interface ProductSlotMark {
  /** A PRODUCT_FIELDS id, or PRODUCT_PHOTO_FIELD. */
  fieldId: string
  pageIndex: number
  kind: SlotKind
  bbox: PdfRect
}

/** Marks for a whole document, keyed by slotKeyFor(). */
export type ProductSlotMap = ReadonlyMap<string, ProductSlotMark>

/**
 * The identity of one markable box.
 *
 * Rounded to whole points because a rectangle read back from PDFium can
 * differ in the last decimal between calls, and a key that changed when
 * nothing changed would drop the mark at random.
 */
export function slotKeyFor(pageIndex: number, kind: SlotKind, bbox: PdfRect | null): string | null {
  if (!bbox) return null
  const r = (n: number) => Math.round(n)
  return `${pageIndex}:${kind}:${r(bbox.left)},${r(bbox.bottom)},${r(bbox.right)},${r(bbox.top)}`
}

/**
 * What a box of this kind can be marked as.
 *
 * A picture can only hold the photo; a line of text can hold any of the
 * written details but never the photo. Offering the wrong ones would let
 * someone mark a caption as the product image and then wonder why nothing
 * happens.
 */
export function fieldsForKind(kind: SlotKind): { id: string; labelKey: string; labelFallback: string }[] {
  if (kind === "image" || kind === "vector") {
    return [{
      id: PRODUCT_PHOTO_FIELD,
      labelKey: "pdfTemplates.productFieldPhoto",
      labelFallback: "Product photo",
    }]
  }
  return PRODUCT_FIELDS.map((f) => ({
    id: f.id, labelKey: f.labelKey, labelFallback: f.labelFallback,
  }))
}

export function markFor(marks: ProductSlotMap, key: string | null): ProductSlotMark | null {
  return key === null ? null : marks.get(key) ?? null
}

/**
 * Mark a box, or clear it when fieldId is null.
 *
 * Returns a NEW map — this is held in React state, where mutating the
 * existing one would not re-render.
 *
 * A field can only be in ONE place on a page. Marking a second box as the SKU
 * clears the first, because a page showing the same product's SKU twice from
 * two slots is not something anyone means to build, and when a product is
 * later poured into the page both would have to receive it anyway.
 */
export function setSlotMark(
  marks: ProductSlotMap,
  key: string,
  mark: Omit<ProductSlotMark, "fieldId"> & { fieldId: string | null },
): Map<string, ProductSlotMark> {
  const next = new Map(marks)
  if (mark.fieldId === null) {
    next.delete(key)
    return next
  }
  for (const [existingKey, existing] of next) {
    if (existing.pageIndex === mark.pageIndex && existing.fieldId === mark.fieldId) {
      next.delete(existingKey)
    }
  }
  next.set(key, {
    fieldId: mark.fieldId, pageIndex: mark.pageIndex, kind: mark.kind, bbox: mark.bbox,
  })
  return next
}

/** Move a mark from one box to another, keeping its field. Used when the
 * marked box is moved or resized — without it, positioning a slot after
 * marking it would silently unmark it. */
export function reanchorSlotMark(
  marks: ProductSlotMap, fromKey: string, toKey: string, bbox: PdfRect,
): Map<string, ProductSlotMark> {
  const existing = marks.get(fromKey)
  if (!existing || fromKey === toKey) return new Map(marks)
  const next = new Map(marks)
  next.delete(fromKey)
  next.set(toKey, { ...existing, bbox })
  return next
}

/** Every mark on one page, for filling it or saving it as a template. */
export function marksOnPage(marks: ProductSlotMap, pageIndex: number): ProductSlotMark[] {
  return [...marks.values()].filter((m) => m.pageIndex === pageIndex)
}

/** Drops marks belonging to pages that no longer exist, so deleting a page
 * cannot leave marks that a later page inherits by number. */
export function pruneSlotMarks(marks: ProductSlotMap, pageCount: number): Map<string, ProductSlotMark> {
  const next = new Map<string, ProductSlotMark>()
  for (const [key, mark] of marks) {
    if (mark.pageIndex < pageCount) next.set(key, mark)
  }
  return next
}

/**
 * A short human label for a field id, for the badge drawn on the box.
 *
 * Kept here rather than in the components so text, image and artwork slots
 * cannot end up naming the same field differently.
 */
export function productFieldLabel(
  t: (key: string, fallback: string) => string, fieldId: string,
): string {
  if (fieldId === PRODUCT_PHOTO_FIELD) {
    return t("pdfTemplates.productFieldPhoto", "Product photo")
  }
  const field = PRODUCT_FIELDS.find((f) => f.id === fieldId)
  return field ? t(field.labelKey, field.labelFallback) : fieldId
}

/**
 * Re-attach marks to the boxes they belong to, after the page has changed.
 *
 * ── Why this exists, and what it replaces ──
 *
 * A mark is keyed by WHERE a box is, and a box moves. The first attempt at
 * following it watched the SELECTED slot and moved the mark whenever the
 * selected box's key changed. That was wrong in a way that corrupted the
 * user's page: selecting a DIFFERENT box produces exactly the same signal as
 * the marked box moving, so marking a picture as the product photo and then
 * clicking a caption moved the photo mark onto the caption.
 *
 * Two things had to change. This runs off the document REVISION, so merely
 * selecting something never triggers it — nothing was edited. And it matches
 * by OVERLAP with where the box used to be, rather than assuming whatever is
 * selected now is the same object.
 *
 * ── Why overlap ──
 *
 * It answers the cases that actually happen. Filling a slot rewrites its text,
 * which changes the box's width but leaves it sitting where it was — so it
 * still overlaps heavily. Nudging or resizing a box likewise. A box dragged
 * clear across the page does NOT overlap, and its mark is dropped rather than
 * guessed at: a badge that quietly disappears is a great deal better than one
 * that silently attaches itself to the wrong box.
 *
 * Every candidate must be UNCLAIMED, so two marks can never end up on one box,
 * and the best overlap wins so a near-miss cannot steal a box from an exact
 * match.
 */
export interface LiveBox {
  kind: SlotKind
  bbox: PdfRect
}

const areaOf = (b: PdfRect) => Math.max(0, b.right - b.left) * Math.max(0, b.top - b.bottom)

const overlapArea = (a: PdfRect, b: PdfRect) => {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom)
  return width > 0 && height > 0 ? width * height : 0
}

/** How much of the smaller box must be shared before two rectangles are taken
 * for the same object. Low enough that a rewritten line of text still matches
 * after its width changes; high enough that neighbours brushing edges do
 * not. */
const MIN_OVERLAP_FRACTION = 0.25

export function reanchorMarksOnPage(
  marks: ProductSlotMap,
  pageIndex: number,
  liveBoxes: readonly LiveBox[],
  /**
   * Which kinds of box the caller has actually READ for this page.
   *
   * Not a nicety. The editor loads text, pictures and artwork separately, and
   * an unread list looks exactly like an empty one — so re-anchoring a page
   * whose pictures had not loaded yet would find no picture anywhere, decide
   * every photo slot was stranded, and drop it. Marks of a kind that has not
   * been read are left completely alone.
   */
  loadedKinds: ReadonlySet<SlotKind>,
): ProductSlotMap {
  const onThisPage = [...marks.entries()]
    .filter(([, m]) => m.pageIndex === pageIndex && loadedKinds.has(m.kind))
  if (onThisPage.length === 0) return marks

  const liveKeys = new Set(
    liveBoxes.map((b) => slotKeyFor(pageIndex, b.kind, b.bbox)).filter((k): k is string => !!k))

  // Anything still sitting exactly where its mark says needs nothing doing,
  // and claims its box so no other mark can be re-anchored onto it.
  const claimed = new Set<string>()
  const stranded: [string, ProductSlotMark][] = []
  for (const entry of onThisPage) {
    if (liveKeys.has(entry[0])) claimed.add(entry[0])
    else stranded.push(entry)
  }
  if (stranded.length === 0) return marks

  const next = new Map(marks)
  let changed = false

  // Sorted, so the outcome does not depend on Map insertion order — the same
  // page in the same state must always re-anchor the same way.
  stranded.sort((a, b) => a[1].fieldId.localeCompare(b[1].fieldId))

  for (const [oldKey, mark] of stranded) {
    let best: { key: string; bbox: PdfRect; score: number } | null = null
    for (const box of liveBoxes) {
      if (box.kind !== mark.kind) continue
      const key = slotKeyFor(pageIndex, box.kind, box.bbox)
      if (!key || claimed.has(key)) continue
      const shared = overlapArea(mark.bbox, box.bbox)
      if (shared === 0) continue
      const smaller = Math.min(areaOf(mark.bbox), areaOf(box.bbox))
      if (smaller <= 0 || shared / smaller < MIN_OVERLAP_FRACTION) continue
      if (!best || shared > best.score) best = { key, bbox: box.bbox, score: shared }
    }

    next.delete(oldKey)
    changed = true
    if (best) {
      claimed.add(best.key)
      next.set(best.key, { ...mark, bbox: best.bbox })
    }
    // No candidate: the mark is dropped. The badge disappears, which is
    // visible and re-doable; leaving a stale key behind would let whatever
    // lands on that spot next inherit somebody else's slot.
  }

  return changed ? next : marks
}

/**
 * What a box is called when it is NOT a product slot.
 *
 * Per kind, because "Fixed text" in front of a photograph is simply untrue —
 * it reads as though the editor thinks the picture is writing. The word has
 * to name the thing being looked at, or the control describes something the
 * user cannot see.
 */
export function fixedLabelForKind(kind: SlotKind): { key: string; fallback: string } {
  if (kind === "image") return { key: "pdfTemplates.productSlotFixedImage", fallback: "Fixed image" }
  if (kind === "vector") return { key: "pdfTemplates.productSlotFixedVector", fallback: "Fixed artwork" }
  return { key: "pdfTemplates.productSlotNone", fallback: "Fixed text" }
}
