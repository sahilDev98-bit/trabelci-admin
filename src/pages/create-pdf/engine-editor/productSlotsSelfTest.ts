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
  reanchorMarksOnPage, reanchorSlotMark, setSlotMark, slotKeyFor,
  marksForProduct, productCountOnPage, productSlotBadge,
  type ProductSlotMap,
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
    fieldId: "sku", productIndex: 0, pageIndex: 0, kind: "text", bbox: skuBox,
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
    fieldId: "name", productIndex: 0, pageIndex: 0, kind: "text", bbox: nameBox,
  })
  const photoBox = box(50, 300, 300, 560)
  marks = setSlotMark(marks, slotKeyFor(0, "image", photoBox)!, {
    fieldId: PRODUCT_PHOTO_FIELD, productIndex: 0, pageIndex: 0, kind: "image", bbox: photoBox,
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
    fieldId: "sku", productIndex: 0, pageIndex: 0, kind: "text", bbox: secondSkuBox,
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
    fieldId: null, productIndex: 0, pageIndex: 0, kind: "text", bbox: nameBox,
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
    fieldId: "sku", productIndex: 0, pageIndex: 1, kind: "text", bbox: skuBox,
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

/**
 * The two faults reported from a screen recording, each reproduced.
 *
 * 1. SELECTING a different box moved the mark onto it. Marking a picture as
 *    the product photo and then clicking a caption transferred the photo mark
 *    to the caption. Nothing had been edited — the old rule watched the
 *    selection and could not tell "the marked box moved" from "you clicked
 *    something else".
 *
 * 2. FILLING the slots lost their badges. Writing a product's name into a
 *    text box changes that box's width, so its mark no longer matched where
 *    it sat, and the slot vanished from view — while still filling correctly,
 *    which made it look like the marks had been silently forgotten.
 *
 * Both are the same underlying question — how a mark follows its box — so
 * both are checked here, together with the controls that keep the fix from
 * over-reaching.
 */
export interface SlotReanchorTestResult {
  errors: string[]
  /** Selecting elsewhere must not move anything. */
  markStaysOnItsBoxWhenAnotherIsSelected: boolean
  /** A refilled text box keeps its slot. */
  markFollowsRefilledText: boolean
  fieldAfterRefill: string | null
  /** A box dragged far away drops its mark rather than grabbing a stranger. */
  farMoveDropsMark: boolean
  /** Two marks can never land on one box. */
  noTwoMarksShareABox: boolean
  /** An untouched page is returned unchanged, so the effect writes nothing. */
  unchangedPageReturnsSameMap: boolean
  /** A list that has not loaded yet must not be read as "everything of that
   * kind is gone". */
  unloadedKindLeavesMarksAlone: boolean
}

export function runSlotReanchorSelfTest(): SlotReanchorTestResult {
  const out: SlotReanchorTestResult = {
    errors: [],
    markStaysOnItsBoxWhenAnotherIsSelected: false,
    markFollowsRefilledText: false, fieldAfterRefill: null,
    farMoveDropsMark: false, noTwoMarksShareABox: false,
    unchangedPageReturnsSameMap: false, unloadedKindLeavesMarksAlone: false,
  }

  const photoBox = box(50, 400, 300, 700)
  const skuBox = box(50, 300, 200, 320)
  const nameBox = box(50, 250, 260, 275)

  let marks: ProductSlotMap = setSlotMark(new Map(), slotKeyFor(0, "image", photoBox)!, {
    fieldId: PRODUCT_PHOTO_FIELD, productIndex: 0, pageIndex: 0, kind: "image", bbox: photoBox,
  })
  marks = setSlotMark(marks, slotKeyFor(0, "text", skuBox)!, {
    fieldId: "sku", productIndex: 0, pageIndex: 0, kind: "text", bbox: skuBox,
  })
  marks = setSlotMark(marks, slotKeyFor(0, "text", nameBox)!, {
    fieldId: "name", productIndex: 0, pageIndex: 0, kind: "text", bbox: nameBox,
  })

  const live = (boxes: { kind: "text" | "image" | "vector"; bbox: PdfRect }[]) => boxes
  /** Every list read, which is the normal state once a page is on screen. */
  const ALL_KINDS = new Set(["text", "image", "vector"] as const)

  // ── Fault 1: nothing was edited, so nothing may move ─────────────────
  // The page is exactly as it was. Whatever is selected is irrelevant — this
  // rule never sees the selection at all, which is the point.
  const untouched = reanchorMarksOnPage(marks, 0, live([
    { kind: "image", bbox: photoBox },
    { kind: "text", bbox: skuBox },
    { kind: "text", bbox: nameBox },
  ]), ALL_KINDS)
  out.unchangedPageReturnsSameMap = untouched === marks
  if (!out.unchangedPageReturnsSameMap) {
    out.errors.push("an unchanged page produced a new map, so the editor would write state on every edit")
  }
  out.markStaysOnItsBoxWhenAnotherIsSelected =
    markFor(untouched, slotKeyFor(0, "image", photoBox))?.fieldId === PRODUCT_PHOTO_FIELD
    && markFor(untouched, slotKeyFor(0, "text", skuBox))?.fieldId === "sku"
  if (!out.markStaysOnItsBoxWhenAnotherIsSelected) {
    out.errors.push(
      "a mark moved although nothing was edited — this is the reported fault"
      + " where clicking another box stole the product photo slot")
  }

  // ── Fault 2: a refilled text box keeps its slot ──────────────────────
  // Writing a longer product name widens the box. It has not moved, so the
  // mark must follow it — the badge disappearing was what made the slots look
  // forgotten even though they still filled.
  const widerSku = box(50, 300, 340, 320)
  const refilled = reanchorMarksOnPage(marks, 0, live([
    { kind: "image", bbox: photoBox },
    { kind: "text", bbox: widerSku },
    { kind: "text", bbox: nameBox },
  ]), ALL_KINDS)
  out.fieldAfterRefill = markFor(refilled, slotKeyFor(0, "text", widerSku))?.fieldId ?? null
  out.markFollowsRefilledText = out.fieldAfterRefill === "sku"
  if (!out.markFollowsRefilledText) {
    out.errors.push(
      `after a refill widened the box its slot reads ${JSON.stringify(out.fieldAfterRefill)},`
      + " expected sku — the badge would have vanished")
  }
  // And it must not have taken the neighbouring name slot with it.
  if (markFor(refilled, slotKeyFor(0, "text", nameBox))?.fieldId !== "name") {
    out.errors.push("re-anchoring the SKU slot disturbed the name slot beside it")
  }

  // ── The control: a box moved far away drops its mark ─────────────────
  // Overlap is what makes this safe. A box dragged to the other side of the
  // page shares nothing with where it was, so the mark is dropped rather than
  // attached to whatever happens to be nearby now.
  const movedFar = box(400, 100, 550, 120)
  const afterFarMove = reanchorMarksOnPage(marks, 0, live([
    { kind: "image", bbox: photoBox },
    { kind: "text", bbox: movedFar },
    { kind: "text", bbox: nameBox },
  ]), ALL_KINDS)
  out.farMoveDropsMark = markFor(afterFarMove, slotKeyFor(0, "text", movedFar)) === null
  if (!out.farMoveDropsMark) {
    out.errors.push(
      "a box moved right across the page inherited a mark it never had —"
      + " overlap is not being required")
  }

  // ── No two marks on one box ──────────────────────────────────────────
  // Both text boxes vanish and ONE new box appears overlapping both. Only one
  // mark may claim it; the other is dropped rather than doubling up.
  const merged = box(50, 250, 340, 320)
  const afterMerge = reanchorMarksOnPage(marks, 0, live([
    { kind: "image", bbox: photoBox },
    { kind: "text", bbox: merged },
  ]), ALL_KINDS)
  const onMerged = [...afterMerge.values()].filter(
    (m) => slotKeyFor(0, m.kind, m.bbox) === slotKeyFor(0, "text", merged))
  out.noTwoMarksShareABox = onMerged.length <= 1
  if (!out.noTwoMarksShareABox) {
    out.errors.push(`${onMerged.length} marks ended up on the same box`)
  }
  // The picture is untouched throughout — a text edit must never disturb it.
  if (markFor(afterMerge, slotKeyFor(0, "image", photoBox))?.fieldId !== PRODUCT_PHOTO_FIELD) {
    out.errors.push("editing text disturbed the product photo slot")
  }

  // ── An unread list is not an empty one ───────────────────────────────
  // The editor loads text, pictures and artwork separately. Mid-edit the text
  // can be read back before the pictures are, and a page reporting no
  // pictures would otherwise look as though every photo slot had been
  // deleted — dropping the mark for a box that is still sitting there.
  const textOnly = reanchorMarksOnPage(
    marks, 0,
    live([{ kind: "text", bbox: skuBox }, { kind: "text", bbox: nameBox }]),
    new Set(["text"] as const),
  )
  out.unloadedKindLeavesMarksAlone =
    markFor(textOnly, slotKeyFor(0, "image", photoBox))?.fieldId === PRODUCT_PHOTO_FIELD
  if (!out.unloadedKindLeavesMarksAlone) {
    out.errors.push(
      "the product photo slot was dropped because the picture list had not"
      + " loaded yet — an unread list was taken for an empty page")
  }

  return out
}

/**
 * Can a page hold EIGHT products?
 *
 * This is what the bulk generator rests on. The client's example is an
 * eight-product page fed forty SKUs to make five pages — impossible until a
 * slot can say WHICH product it belongs to, because "the SKU" names eight
 * different boxes on such a page.
 *
 * The rules that matter are all about not confusing one position with
 * another, so each is checked at eight, not at two.
 */
export interface MultiProductSlotsResult {
  errors: string[]
  productsOnPage: number
  slotsPerProduct: number[]
  /** Each product's SKU slot is its own box. */
  eightDistinctSkuSlots: boolean
  /** Re-marking product 3's SKU must not disturb product 4's. */
  remarkingOneLeavesOthers: boolean
  /** Filling reads only the position asked for. */
  filledOnlyProductThree: string[]
  /** A gap in the numbering still counts as the higher page size. */
  countWithGap: number
  badgeOnManyProducts: string
  badgeOnOneProduct: string
}

export function runMultiProductSlotsSelfTest(): MultiProductSlotsResult {
  const out: MultiProductSlotsResult = {
    errors: [], productsOnPage: 0, slotsPerProduct: [],
    eightDistinctSkuSlots: false, remarkingOneLeavesOthers: false,
    filledOnlyProductThree: [], countWithGap: 0,
    badgeOnManyProducts: "", badgeOnOneProduct: "",
  }

  // Eight products, each with a photo and an SKU, laid out in a 2x4 grid.
  let marks: ProductSlotMap = new Map()
  for (let i = 0; i < 8; i++) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const left = 40 + col * 280
    const bottom = 700 - row * 170
    const photo = box(left, bottom, left + 250, bottom + 120)
    const sku = box(left, bottom - 20, left + 250, bottom - 2)
    marks = setSlotMark(marks, slotKeyFor(0, "image", photo)!, {
      fieldId: PRODUCT_PHOTO_FIELD, productIndex: i, pageIndex: 0, kind: "image", bbox: photo,
    })
    marks = setSlotMark(marks, slotKeyFor(0, "text", sku)!, {
      fieldId: "sku", productIndex: i, pageIndex: 0, kind: "text", bbox: sku,
    })
  }

  out.productsOnPage = productCountOnPage(marks, 0)
  if (out.productsOnPage !== 8) {
    out.errors.push(`the page reports ${out.productsOnPage} products, expected 8`)
  }

  out.slotsPerProduct = Array.from({ length: 8 }, (_, i) => marksForProduct(marks, 0, i).length)
  if (out.slotsPerProduct.some((n) => n !== 2)) {
    out.errors.push(`slots per product came out ${JSON.stringify(out.slotsPerProduct)}, expected two each`)
  }

  // Eight SKU slots, all present at once. Under the old one-field-per-page
  // rule the eighth would have wiped out the other seven.
  const skuSlots = marksOnPage(marks, 0).filter((m) => m.fieldId === "sku")
  out.eightDistinctSkuSlots = skuSlots.length === 8
    && new Set(skuSlots.map((m) => m.productIndex)).size === 8
  if (!out.eightDistinctSkuSlots) {
    out.errors.push(
      `the page has ${skuSlots.length} SKU slots across`
      + ` ${new Set(skuSlots.map((m) => m.productIndex)).size} products, expected 8 across 8`)
  }

  // ── Re-marking one position leaves the others alone ──────────────────
  // The uniqueness rule is per PRODUCT now. Moving product 3's SKU to a new
  // box must clear only product 3's old one.
  const newSkuForThree = box(40, 100, 290, 118)
  const after = setSlotMark(marks, slotKeyFor(0, "text", newSkuForThree)!, {
    fieldId: "sku", productIndex: 2, pageIndex: 0, kind: "text", bbox: newSkuForThree,
  })
  const skusAfter = marksOnPage(after, 0).filter((m) => m.fieldId === "sku")
  out.remarkingOneLeavesOthers = skusAfter.length === 8
    && marksForProduct(after, 0, 2).some((m) => slotKeyFor(0, "text", m.bbox) === slotKeyFor(0, "text", newSkuForThree))
  if (!out.remarkingOneLeavesOthers) {
    out.errors.push(
      `re-marking one product's SKU left ${skusAfter.length} SKU slots on the page,`
      + " expected 8 — the other positions were disturbed")
  }

  // ── Filling reads only the position asked for ────────────────────────
  // This is what stops one product being poured into all eight tiles.
  out.filledOnlyProductThree = marksForProduct(marks, 0, 2)
    .map((m) => `${m.fieldId}#${m.productIndex}`).sort()
  if (out.filledOnlyProductThree.join(",") !== "photo#2,sku#2") {
    out.errors.push(
      `asking for product 3's slots returned ${JSON.stringify(out.filledOnlyProductThree)}`)
  }

  // ── A gap in the numbering ───────────────────────────────────────────
  // Slots for products 1 and 4 but nothing between: the page still holds
  // four positions, and the generator must not quietly skip the empty ones.
  let gappy: ProductSlotMap = new Map()
  const a = box(10, 10, 100, 30)
  const b = box(200, 10, 290, 30)
  gappy = setSlotMark(gappy, slotKeyFor(0, "text", a)!, {
    fieldId: "sku", productIndex: 0, pageIndex: 0, kind: "text", bbox: a,
  })
  gappy = setSlotMark(gappy, slotKeyFor(0, "text", b)!, {
    fieldId: "sku", productIndex: 3, pageIndex: 0, kind: "text", bbox: b,
  })
  out.countWithGap = productCountOnPage(gappy, 0)
  if (out.countWithGap !== 4) {
    out.errors.push(
      `slots for products 1 and 4 report ${out.countWithGap} products, expected 4 —`
      + " counting distinct numbers instead of the highest would lose the gap")
  }

  // ── The badge says which product, but only when it needs to ──────────
  const t = (_k: string, fallback: string) => fallback
  const mark = marksForProduct(marks, 0, 2)[0]
  out.badgeOnManyProducts = productSlotBadge(t, mark, 8)
  out.badgeOnOneProduct = productSlotBadge(t, { ...mark, productIndex: 0 }, 1)
  if (!out.badgeOnManyProducts.startsWith("3 ")) {
    out.errors.push(`the badge reads "${out.badgeOnManyProducts}" and does not say which product`)
  }
  // The control: on a ONE-product page a number in front of every badge is
  // noise that says nothing — there is only one product to belong to.
  if (/^\d/.test(out.badgeOnOneProduct)) {
    out.errors.push(`a single-product page's badge reads "${out.badgeOnOneProduct}"`)
  }

  return out
}
