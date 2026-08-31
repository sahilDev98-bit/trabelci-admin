// Vector artwork: the logos, icons and rules a designer drew as PATHS
// rather than placed as images.
//
// These are why a logo can look like a picture and still not be editable.
// The REFIN mark in the catalogue is not one object — it is seventeen: a
// diamond, one path per letter of "REFIN", and one per letter of the small
// "CERAMICHE" beneath it. Listing them individually would offer seventeen
// meaningless slots; listing none, which is what the editor did before,
// leaves the most obviously brandable thing on the page untouchable.
//
// So paths are grouped by proximity into the things a person would call one
// item, and offered as a single slot that can be removed or replaced by an
// image.
import type { WrappedPdfiumModule } from "@embedpdf/pdfium"
import { PAGEOBJ_TYPE, Scratch } from "./core"

export interface VectorGroupInfo {
  index: number
  handles: number[]
  bbox: { left: number; bottom: number; right: number; top: number }
  pathCount: number
}

/**
 * How close two pieces of artwork must be to count as one item, in PDF
 * points.
 *
 * Taken from the real documents, not guessed. In the REFIN mark the gap
 * between the diamond and the "R" is 5pt, and between the wordmark and the
 * "CERAMICHE" line beneath it 7pt, while the nearest unrelated object — a
 * horizontal rule — is 109pt away. 8pt sits comfortably inside that gap.
 */
const GROUP_GAP_PTS = 8

/** Artwork smaller than this in EITHER direction is a hairline rule or a
 * speck. A catalogue page can carry dozens of them (one Carnaby page has
 * twelve 452x1pt rules); slots for those would be noise, not capability. */
const MIN_ARTWORK_PTS = 10

/** Artwork covering more of the page than this is a background or a frame.
 * Offering it as a slot would lay an invisible sheet over the whole page and
 * swallow clicks meant for the photos and text on top of it. */
const MAX_PAGE_COVERAGE = 0.8

function boundsOf(
  pdfium: WrappedPdfiumModule, obj: number, scratch: Scratch,
): VectorGroupInfo["bbox"] | null {
  const l = scratch.malloc(4), b = scratch.malloc(4), r = scratch.malloc(4), t = scratch.malloc(4)
  if (!pdfium.FPDFPageObj_GetBounds(obj, l, b, r, t)) return null
  return {
    left: scratch.readFloat(l), bottom: scratch.readFloat(b),
    right: scratch.readFloat(r), top: scratch.readFloat(t),
  }
}

/**
 * Every piece of vector artwork on the page worth offering as a slot.
 *
 * Grouping is a union-find over "are these two boxes within GROUP_GAP_PTS of
 * each other", which is what makes a logo drawn as many paths come back as
 * one item.
 */
export function listVectorGroups(
  pdfium: WrappedPdfiumModule, page: number, scratch: Scratch,
): VectorGroupInfo[] {
  const count = pdfium.FPDFPage_CountObjects(page)
  const handles: number[] = []
  const boxes: VectorGroupInfo["bbox"][] = []

  for (let i = 0; i < count; i++) {
    const obj = pdfium.FPDFPage_GetObject(page, i)
    if (pdfium.FPDFPageObj_GetType(obj) !== PAGEOBJ_TYPE.PATH) continue
    const bbox = boundsOf(pdfium, obj, scratch)
    if (!bbox) continue
    handles.push(obj)
    boxes.push(bbox)
  }
  if (boxes.length === 0) return []

  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const near = (a: VectorGroupInfo["bbox"], b: VectorGroupInfo["bbox"]) =>
    a.left - GROUP_GAP_PTS <= b.right && b.left - GROUP_GAP_PTS <= a.right
    && a.bottom - GROUP_GAP_PTS <= b.top && b.bottom - GROUP_GAP_PTS <= a.top

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i], boxes[j])) parent[find(i)] = find(j)
    }
  }

  const clusters = new Map<number, number[]>()
  for (let i = 0; i < boxes.length; i++) {
    const root = find(i)
    clusters.set(root, [...(clusters.get(root) ?? []), i])
  }

  const pageWidth = pdfium.FPDF_GetPageWidthF(page)
  const pageHeight = pdfium.FPDF_GetPageHeightF(page)
  const out: VectorGroupInfo[] = []

  for (const members of clusters.values()) {
    const bbox = {
      left: Math.min(...members.map((i) => boxes[i].left)),
      bottom: Math.min(...members.map((i) => boxes[i].bottom)),
      right: Math.max(...members.map((i) => boxes[i].right)),
      top: Math.max(...members.map((i) => boxes[i].top)),
    }
    const width = bbox.right - bbox.left
    const height = bbox.top - bbox.bottom
    if (width < MIN_ARTWORK_PTS || height < MIN_ARTWORK_PTS) continue
    if (pageWidth > 0 && pageHeight > 0
      && (width * height) / (pageWidth * pageHeight) > MAX_PAGE_COVERAGE) continue

    out.push({
      index: out.length,
      handles: members.map((i) => handles[i]),
      bbox,
      pathCount: members.length,
    })
  }

  // Ordered leading-edge first so the index a caller gets back is stable
  // between calls rather than following hash order.
  out.sort((a, b) => (b.bbox.top - a.bbox.top) || (a.bbox.left - b.bbox.left))
  return out.map((g, index) => ({ ...g, index }))
}

/** Delete a whole piece of artwork — every path that makes it up. */
/**
 * Move and/or resize a piece of vector artwork.
 *
 * Artwork made of paths — a logo, a QR code, a drawn mark — used to be the
 * one thing on a page that could only be REPLACED, never nudged or scaled.
 * That is not a limitation of the format: paths transform exactly like
 * anything else, and a group is simply several of them that belong together.
 * It only looked different because the editor treated it differently.
 *
 * Every path in the group gets the SAME transform, worked out once from the
 * group's overall box, so the pieces keep their spacing and proportions
 * relative to each other — transforming each to fit the target box on its
 * own would pull a logo apart into overlapping fragments.
 *
 * The clip path travels too. Artwork is often drawn inside a clip, and
 * moving the strokes out from under one that stays put is what turns a mark
 * into a sliver of itself.
 */
export function setVectorGroupRect(
  pdfium: WrappedPdfiumModule,
  page: number,
  handles: number[],
  bbox: { left: number; bottom: number; right: number; top: number },
  rect: { x: number; y: number; width: number; height: number },
): { ok: boolean; error?: string } {
  if (handles.length === 0) return { ok: false, error: "the artwork has no paths to move" }
  const oldWidth = bbox.right - bbox.left
  const oldHeight = bbox.top - bbox.bottom
  // Guarded: a zero-sized box would scale by Infinity and lose the artwork.
  const sx = Math.abs(oldWidth) > 1e-6 ? rect.width / oldWidth : 1
  const sy = Math.abs(oldHeight) > 1e-6 ? rect.height / oldHeight : 1
  const tx = rect.x - sx * bbox.left
  const ty = rect.y - sy * bbox.bottom
  for (const handle of handles) {
    pdfium.FPDFPageObj_TransformClipPath(handle, sx, 0, 0, sy, tx, ty)
    pdfium.FPDFPageObj_Transform(handle, sx, 0, 0, sy, tx, ty)
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}

/**
 * Turn or mirror a piece of artwork about its own centre.
 *
 * The same four operations an image offers, and the same arithmetic: the
 * matrix is built about the origin and then shifted so the centre of the
 * GROUP stays where it is. Every path gets that one matrix, so the pieces of
 * a logo turn together instead of each spinning about its own middle.
 */
export function removeVectorGroup(
  pdfium: WrappedPdfiumModule, page: number, handles: number[],
): { ok: boolean; error?: string } {
  for (const handle of handles) {
    if (!pdfium.FPDFPage_RemoveObject(page, handle)) {
      return { ok: false, error: "FPDFPage_RemoveObject failed for a path in the artwork" }
    }
    pdfium.FPDFPageObj_Destroy(handle)
  }
  return { ok: pdfium.FPDFPage_GenerateContent(page) }
}
