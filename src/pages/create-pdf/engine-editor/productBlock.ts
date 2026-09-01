import type { CatalogProduct } from "@/features/catalogProducts/types"
import { PRODUCT_FIELDS, type ProductFieldLanguage } from "./productFields"

/**
 * What a product BECOMES when it is dragged onto a page.
 *
 * This is the decision the client's document forces and does not answer. A
 * product is not one object — it is a photo plus about twenty details — so
 * "drag the product in" has to resolve to something specific. Three answers
 * were possible:
 *
 *   - the photo alone, which makes the gesture an image drag and leaves the
 *     document's "not simply an image" requirement unmet;
 *   - all twenty details, which puts a wall of text on the page;
 *   - a BLOCK: the photo with a few key details under it, as one unit.
 *
 * The block is what a catalogue tile actually is, and it is what the client's
 * own example describes. So that is what lands.
 *
 * The geometry is computed here, with no React and no engine, for one reason:
 * placing a block is several engine calls that cannot be undone individually,
 * and every one of them has to be right before the first is made. Working out
 * the positions separately means they can be checked against a page without
 * writing to a document.
 */

/** Which details go under the photo, in order.
 *
 * Deliberately short. These four are what identifies a product on a catalogue
 * page — what it is called, its code, how big it is, what it costs — and the
 * rest are available one click at a time from the panel for anyone who wants
 * them. A block that tried to be complete would be a block nobody could use
 * without deleting half of it.
 */
export const PRODUCT_BLOCK_FIELD_IDS: readonly string[] = ["name", "sku", "size", "unitPrice"]

export interface ProductBlockLine {
  fieldId: string
  text: string
  /** Baseline in PDF points, measured from the page's BOTTOM, as the engine
   * wants it. */
  baselineY: number
  x: number
  width: number
  fontSize: number
}

export interface ProductBlockPlan {
  /** Absent when the product has no photo — the block is then text only,
   * rather than the drop doing nothing. */
  image: { x: number; y: number; width: number; height: number } | null
  lines: ProductBlockLine[]
}

export interface ProductBlockOptions {
  page: { widthPts: number; heightPts: number }
  /** Where the pointer let go, in points from the page's TOP-left. */
  dropXPts: number
  dropYFromTopPts: number
  /** Natural pixel size of the photo, for keeping its shape. Null when the
   * product has none. */
  imagePx: { width: number; height: number } | null
  imageWidthPts: number
  fontSizePts: number
  /** Gap between one line's baseline and the next. Must stay comfortably more
   * than the font size: PDFium groups text sharing a baseline into a single
   * object, so lines placed too close fuse into one that cannot be edited
   * apart. */
  lineStepPts: number
  /** Keeps the block off the very edge of the paper. */
  marginPts: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * The details this product can actually supply, in block order.
 *
 * Read through the same PRODUCT_FIELDS the panel uses, so a block can never
 * contain a value the panel would have formatted differently. Anything the
 * product has no value for is simply absent — a block must never contain a
 * blank line or the word "null".
 */
export function productBlockLines(
  product: CatalogProduct, language: ProductFieldLanguage,
): { fieldId: string; text: string }[] {
  const out: { fieldId: string; text: string }[] = []
  for (const id of PRODUCT_BLOCK_FIELD_IDS) {
    const field = PRODUCT_FIELDS.find((f) => f.id === id)
    if (!field) continue
    const value = field.read(product, language)
    if (value) out.push({ fieldId: id, text: value })
  }
  return out
}

/**
 * Where every piece of the block goes.
 *
 * The drop point is the block's TOP-LEFT rather than its centre. A block is
 * read downward from its picture, so anchoring it at the top is what makes the
 * result land where the cursor was pointing; centring a tall block would put
 * half of it above the pointer.
 *
 * The whole block is then clamped onto the page as a unit, so a drop near the
 * bottom edge slides the block up rather than letting its price line fall off
 * the paper.
 */
export function planProductBlock(
  lines: readonly { fieldId: string; text: string }[],
  options: ProductBlockOptions,
): ProductBlockPlan {
  const {
    page, dropXPts, dropYFromTopPts, imagePx, imageWidthPts,
    fontSizePts, lineStepPts, marginPts,
  } = options

  const imageWidth = imagePx ? Math.min(imageWidthPts, page.widthPts - marginPts * 2) : 0
  const imageHeight = imagePx && imagePx.width > 0
    ? imageWidth * (imagePx.height / imagePx.width)
    : 0

  // The text column is as wide as the photo, so the block reads as one object
  // rather than a picture with unrelated text beside it. With no photo it
  // falls back to the photo's nominal width, which keeps a text-only block
  // the same size as every other block on the page.
  const columnWidth = imagePx ? imageWidth : Math.min(imageWidthPts, page.widthPts - marginPts * 2)

  // Gap between the photo and the first line. A full step would read as a
  // detached caption; the photo and its details are one thing.
  const captionGap = imagePx ? fontSizePts * 1.2 : 0
  const textHeight = lines.length === 0
    ? 0
    : captionGap + fontSizePts + lineStepPts * (lines.length - 1)
  const blockHeight = imageHeight + textHeight

  const left = clamp(dropXPts, marginPts, page.widthPts - columnWidth - marginPts)
  const topFromTop = clamp(dropYFromTopPts, marginPts, page.heightPts - blockHeight - marginPts)

  const plan: ProductBlockPlan = { image: null, lines: [] }

  if (imagePx) {
    plan.image = {
      x: left,
      // PDF y grows UPWARD, so an overlay's y is its bottom edge measured from
      // the bottom of the page — not its top edge from the top.
      y: page.heightPts - topFromTop - imageHeight,
      width: imageWidth,
      height: imageHeight,
    }
  }

  let baselineFromTop = topFromTop + imageHeight + captionGap + fontSizePts
  for (const line of lines) {
    plan.lines.push({
      fieldId: line.fieldId,
      text: line.text,
      x: left,
      baselineY: page.heightPts - baselineFromTop,
      width: columnWidth,
      fontSize: fontSizePts,
    })
    baselineFromTop += lineStepPts
  }

  return plan
}
