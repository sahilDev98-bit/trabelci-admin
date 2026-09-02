// Do product slot marks stay on the right boxes?
//
// A mark says "this box holds the SKU". Getting that wrong is not a visual
// glitch — it is the SKU being written into the price box when a product is
// poured into the page, and the page looking plausible while being wrong.
//
// Three things are checked, each with a control that must fail:
//
//   1. A mark identifies ONE box, and does not follow the index when
//      neighbouring boxes come and go.
//   2. A mark moves WITH its box when the box moves. This is what separates a
//      slot from a lock — a locked box cannot move, a slot box moves all the
//      time — and getting it wrong silently unmarks a box the moment you
//      nudge it.
//   3. A field lives in one place only.
import type { PdfRect } from "@/lib/pdf-engine"
import {
  PRODUCT_PHOTO_FIELD, fieldsForKind, markFor, marksOnPage, pruneSlotMarks,
  reanchorSlotMark, setSlotMark, slotKeyFor, type ProductSlotMap,
} from "./productSlots"

export interface ProductSlotsTestResult {
  errors: string[]
  markedField: string | null
  /** After boxes around it are renumbered, the mark must still name the same
   * box — the control is that an index-keyed mark would not. */
  survivesRenumbering: boolean
  /** After the box itself moves, the mark must travel with it. */
  survivesMove: boolean
  /** And be gone from where the box used to be. */
  clearedFromOldPlace: boolean
  fieldsOnPage: string[]
  /** Marking a second box as the SKU must clear the first. */
  skuIsUniqueOnPage: boolean
  textFieldCount: number
  imageFieldIds: string[]
  prunedAfterPageDelete: number
}

const box = (left: number, bottom: number, right: number, top: number): PdfRect =>
  ({ left, bottom, right, top })

export function runProductSlotsSelfTest(): ProductSlotsTestResult {
  const out: ProductSlotsTestResult = {
    errors: [], markedField: null, survivesRenumbering: false,
    survivesMove: false, clearedFromOldPlace: false, fieldsOnPage: [],
    skuIsUniqueOnPage: false, textFieldCount: 0, imageFieldIds: [],
    prunedAfterPageDelete: 0,
  }

  // ── 1. A mark names a box, not a number ──────────────────────────────
  const skuBox = box(50, 700, 200, 720)
  const skuKey = slotKeyFor(0, "text", skuBox)!
  let marks: ProductSlotMap = setSlotMark(new Map(), skuKey, {
    fieldId: "sku", pageIndex: 0, kind: "text", bbox: skuBox,
  })

  out.markedField = markFor(marks, skuKey)?.fieldId ?? null
  if (out.markedField !== "sku") {
    out.errors.push(`the box was marked as sku but reads back as ${out.markedField}`)
  }

  // The box is still at the same place, so the mark still finds it — even
  // though in the document it may now be line 5 rather than line 2. This is
  // the property an index-keyed mark would not have.
  out.survivesRenumbering = markFor(marks, slotKeyFor(0, "text", skuBox))?.fieldId === "sku"
  if (!out.survivesRenumbering) {
    out.errors.push("the mark could not be found again from the same box")
  }

  // The control: a DIFFERENT box must not inherit the mark. Without this,
  // "the mark was found" would also pass for a lookup that matched anything.
  if (markFor(marks, slotKeyFor(0, "text", box(50, 660, 200, 680))) !== null) {
    out.errors.push("a different box on the same page inherited the mark")
  }
  // Nor the same rectangle on another page, or of another kind.
  if (markFor(marks, slotKeyFor(1, "text", skuBox)) !== null) {
    out.errors.push("the same rectangle on another page inherited the mark")
  }
  if (markFor(marks, slotKeyFor(0, "image", skuBox)) !== null) {
    out.errors.push("a picture inherited a text box's mark")
  }

  // ── 2. The mark travels when the box moves ───────────────────────────
  // THE difference from a lock. A locked box cannot move, so keying it by
  // position is safe forever; a slot box is positioned while designing, and
  // without re-anchoring, nudging it silently unmarks it.
  const movedBox = box(80, 640, 230, 660)
  const movedKey = slotKeyFor(0, "text", movedBox)!
  marks = reanchorSlotMark(marks, skuKey, movedKey, movedBox)

  out.survivesMove = markFor(marks, movedKey)?.fieldId === "sku"
  if (!out.survivesMove) {
    out.errors.push("the mark did not travel with its box — moving a slot unmarks it")
  }
  out.clearedFromOldPlace = markFor(marks, skuKey) === null
  if (!out.clearedFromOldPlace) {
    out.errors.push(
      "the mark is still on the box's OLD place — whatever moves there next"
      + " would inherit it")
  }

  // ── 3. One field, one place ──────────────────────────────────────────
  const nameBox = box(50, 600, 300, 630)
  marks = setSlotMark(marks, slotKeyFor(0, "text", nameBox)!, {
    fieldId: "name", pageIndex: 0, kind: "text", bbox: nameBox,
  })
  const photoBox = box(50, 300, 300, 560)
  marks = setSlotMark(marks, slotKeyFor(0, "image", photoBox)!, {
    fieldId: PRODUCT_PHOTO_FIELD, pageIndex: 0, kind: "image", bbox: photoBox,
  })
  out.fieldsOnPage = marksOnPage(marks, 0).map((m) => m.fieldId).sort()
  if (out.fieldsOnPage.length !== 3) {
    out.errors.push(`the page has ${out.fieldsOnPage.length} slots, expected 3`)
  }

  // Marking a SECOND box as the SKU must move the field, not duplicate it: a
  // page cannot meaningfully have two SKU slots, and pouring a product in
  // would have to fill both.
  const secondSkuBox = box(400, 700, 500, 720)
  marks = setSlotMark(marks, slotKeyFor(0, "text", secondSkuBox)!, {
    fieldId: "sku", pageIndex: 0, kind: "text", bbox: secondSkuBox,
  })
  const skus = marksOnPage(marks, 0).filter((m) => m.fieldId === "sku")
  out.skuIsUniqueOnPage = skus.length === 1
  if (!out.skuIsUniqueOnPage) {
    out.errors.push(`marking a second box as the SKU left ${skus.length} SKU slots on the page`)
  }
  // And it is the NEW box that holds it.
  if (markFor(marks, slotKeyFor(0, "text", secondSkuBox))?.fieldId !== "sku") {
    out.errors.push("the SKU did not move to the newly marked box")
  }

  // Clearing a mark removes it entirely.
  const cleared = setSlotMark(marks, slotKeyFor(0, "text", nameBox)!, {
    fieldId: null, pageIndex: 0, kind: "text", bbox: nameBox,
  })
  if (markFor(cleared, slotKeyFor(0, "text", nameBox)) !== null) {
    out.errors.push("clearing a mark left it in place")
  }

  // ── What each kind may hold ──────────────────────────────────────────
  const textFields = fieldsForKind("text")
  const imageFields = fieldsForKind("image")
  out.textFieldCount = textFields.length
  out.imageFieldIds = imageFields.map((f) => f.id)
  if (textFields.some((f) => f.id === PRODUCT_PHOTO_FIELD)) {
    out.errors.push("a line of text is offered the product PHOTO, which it cannot hold")
  }
  if (out.imageFieldIds.join(",") !== PRODUCT_PHOTO_FIELD) {
    out.errors.push(`a picture is offered ${JSON.stringify(out.imageFieldIds)}, expected only the photo`)
  }
  if (textFields.length < 5) {
    out.errors.push(`only ${textFields.length} details offered for a text box`)
  }

  // ── Deleting a page ──────────────────────────────────────────────────
  // A key starts with the page index, so marks from a removed page would be
  // inherited by whatever page takes that number.
  let twoPages: ProductSlotMap = setSlotMark(marks, slotKeyFor(1, "text", skuBox)!, {
    fieldId: "sku", pageIndex: 1, kind: "text", bbox: skuBox,
  })
  twoPages = pruneSlotMarks(twoPages, 1)
  out.prunedAfterPageDelete = marksOnPage(twoPages, 1).length
  if (out.prunedAfterPageDelete !== 0) {
    out.errors.push("marks from a deleted page survived, and the next page would inherit them")
  }
  if (marksOnPage(twoPages, 0).length === 0) {
    out.errors.push("pruning removed marks from a page that still exists")
  }

  return out
}
