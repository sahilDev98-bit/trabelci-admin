// Does dragging a product onto a page actually produce a usable block?
//
// Three separate things have to be true, and they fail in different ways, so
// each is checked on its own:
//
//   1. The drag CONTRACT — what travels on the DataTransfer, and whether the
//      page can tell during hover that a product is coming. Getting this wrong
//      makes the page refuse to light up, which reads as "drag doesn't work".
//   2. The block's CONTENTS — the right details, none of them blank.
//   3. The block's GEOMETRY — where every piece lands. This is the one worth
//      the most attention: placing a block is several engine writes, PDF
//      coordinates run upward while a drop point runs downward, and text
//      objects sharing a baseline FUSE in PDFium into one uneditable line.
//
// Geometry is checked arithmetically rather than by placing a real block,
// because that is what makes it possible to test the cases nobody can easily
// stage by hand — a drop in the very corner, a product with no photo, a page
// too short for the block.
import type { CatalogProduct } from "@/features/catalogProducts/types"
import {
  PRODUCT_BLOCK_FIELD_IDS, planProductBlock, productBlockLines,
} from "./productBlock"
import {
  PRODUCT_DRAG_MIME, dragCarriesProduct, productFromDrag, setProductDragData,
} from "./productDrag"

export interface ProductDropTestResult {
  errors: string[]
  /** What the page sees during hover, before it may read the payload. */
  detectedDuringHover: boolean
  detectedForPlainText: boolean
  roundTrippedSku: string | null
  rejectedGarbage: boolean
  blockLines: string[]
  blockLinesSparse: string[]
  imageRect: string | null
  baselines: number[]
  minBaselineGap: number
  fontSize: number
  cornerDrop: { left: number; topFromTop: number } | null
  noPhotoHasLines: boolean
}

const PRODUCT: CatalogProduct = {
  id: "42",
  sku: "911120",
  name: "Carnaby White",
  size: "60x120",
  unitPrice: 129.5,
  dealerPrice: null,
  inventoryPrice: null,
  stockQuantity: null,
  onHand: null,
  onOrder: null,
  availableStock: null,
  countryOfOrigin: "Italy",
  supplierName: "Varmora",
  coverUrl: "https://example.invalid/cover.jpg",
  skuMeta: null,
}

/** A product missing most of what a block wants. Blank lines and the word
 * "null" must never reach a customer's catalogue. */
const SPARSE: CatalogProduct = {
  ...PRODUCT, id: "43", sku: "0001", name: "", size: null, unitPrice: null, coverUrl: null,
}

const PAGE = { widthPts: 595, heightPts: 842 }
const OPTIONS = {
  page: PAGE,
  dropXPts: 100,
  dropYFromTopPts: 200,
  imagePx: { width: 1000, height: 500 },
  imageWidthPts: 180,
  fontSizePts: 18,
  lineStepPts: 32.4,
  marginPts: 24,
}

/** A DataTransfer good enough to carry a drag, since jsdom-free browsers still
 * will not let a test construct a real drag event with data on it. */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (type: string, value: string) => { store.set(type, value) },
    getData: (type: string) => store.get(type) ?? "",
    get types() { return Array.from(store.keys()) },
    effectAllowed: "none",
  } as unknown as DataTransfer
}

export function runProductDropSelfTest(): ProductDropTestResult {
  const out: ProductDropTestResult = {
    errors: [], detectedDuringHover: false, detectedForPlainText: false,
    roundTrippedSku: null, rejectedGarbage: false, blockLines: [],
    blockLinesSparse: [], imageRect: null, baselines: [], minBaselineGap: 0,
    fontSize: 0, cornerDrop: null, noPhotoHasLines: false,
  }

  // ── 1. The drag contract ─────────────────────────────────────────────
  const dt = fakeDataTransfer()
  setProductDragData(dt, PRODUCT)
  out.detectedDuringHover = dragCarriesProduct(dt)
  if (!out.detectedDuringHover) {
    out.errors.push(
      "a product drag is not recognisable from its type list — the page cannot"
      + " light up as a drop target while the pointer is still moving")
  }
  out.roundTrippedSku = productFromDrag(dt)?.sku ?? null
  if (out.roundTrippedSku !== PRODUCT.sku) {
    out.errors.push(`the dropped product came back as ${out.roundTrippedSku}, expected ${PRODUCT.sku}`)
  }
  // The plain-text copy must be legible, not JSON, for drags into other apps.
  if (dt.getData("text/plain").includes("{")) {
    out.errors.push("the plain-text copy of the drag is raw JSON")
  }

  // Control: an ordinary text drag — a word out of a spreadsheet — must NOT
  // be taken for a product. Without a custom MIME type it would be.
  const plain = fakeDataTransfer()
  plain.setData("text/plain", "911120")
  out.detectedForPlainText = dragCarriesProduct(plain)
  if (out.detectedForPlainText) {
    out.errors.push("a plain text drag was mistaken for a product")
  }

  // Anything can write to a DataTransfer, so a payload that is not a product
  // must be refused rather than thrown on.
  const garbage = fakeDataTransfer()
  garbage.setData(PRODUCT_DRAG_MIME, "{not json")
  const half = fakeDataTransfer()
  half.setData(PRODUCT_DRAG_MIME, JSON.stringify({ name: "no id or sku" }))
  out.rejectedGarbage = productFromDrag(garbage) === null && productFromDrag(half) === null
  if (!out.rejectedGarbage) {
    out.errors.push("a malformed drag payload was accepted as a product")
  }

  // ── 2. The block's contents ──────────────────────────────────────────
  const lines = productBlockLines(PRODUCT, "en")
  out.blockLines = lines.map((l) => `${l.fieldId}=${l.text}`)
  if (lines.length !== PRODUCT_BLOCK_FIELD_IDS.length) {
    out.errors.push(
      `a complete product produced ${lines.length} lines, expected ${PRODUCT_BLOCK_FIELD_IDS.length}`)
  }
  if (lines.some((l) => !l.text.trim())) {
    out.errors.push("a block line is blank")
  }
  // Order is not incidental: the name reads first on a catalogue tile.
  if (lines[0]?.fieldId !== "name") {
    out.errors.push(`the block starts with ${lines[0]?.fieldId}, expected the product name`)
  }

  // The control for the above: a product with almost nothing must produce
  // FEWER lines, not four lines containing empty strings.
  const sparse = productBlockLines(SPARSE, "en")
  out.blockLinesSparse = sparse.map((l) => `${l.fieldId}=${l.text}`)
  if (sparse.length >= lines.length) {
    out.errors.push(
      `a product with no name, size or price still produced ${sparse.length} lines`)
  }
  if (sparse.some((l) => !l.text.trim() || l.text === "null")) {
    out.errors.push("a missing value reached the page as a blank or the word null")
  }

  // ── 3. The geometry ──────────────────────────────────────────────────
  const plan = planProductBlock(lines, OPTIONS)
  if (!plan.image) {
    out.errors.push("a product with a photo produced a block with no image")
  } else {
    out.imageRect = `${Math.round(plan.image.x)},${Math.round(plan.image.y)}`
      + ` ${Math.round(plan.image.width)}x${Math.round(plan.image.height)}`
    // The photo keeps its shape: 1000x500 is 2:1, so 180 wide must be 90 tall.
    const ratio = plan.image.width / plan.image.height
    if (Math.abs(ratio - 2) > 0.01) {
      out.errors.push(`the photo came out ${ratio.toFixed(2)}:1, expected 2:1 — it is being squashed`)
    }
    // The drop point is the block's TOP-left, and PDF y runs upward, so the
    // image's y is the page height less the drop less its own height.
    const expectedY = PAGE.heightPts - OPTIONS.dropYFromTopPts - plan.image.height
    if (Math.abs(plan.image.y - expectedY) > 0.5) {
      out.errors.push(
        `the photo landed at y=${plan.image.y.toFixed(1)}, expected ${expectedY.toFixed(1)}`
        + " — the page's coordinates run upward and the drop point downward")
    }
  }

  out.baselines = plan.lines.map((l) => Math.round(l.baselineY))
  out.fontSize = plan.lines[0]?.fontSize ?? 0

  // Every line below the photo, and each below the one before it.
  const imageBottom = plan.image ? plan.image.y : PAGE.heightPts
  if (plan.lines.some((l) => l.baselineY > imageBottom)) {
    out.errors.push("a detail line is above the photo instead of under it")
  }
  let minGap = Number.POSITIVE_INFINITY
  for (let i = 1; i < plan.lines.length; i++) {
    minGap = Math.min(minGap, plan.lines[i - 1].baselineY - plan.lines[i].baselineY)
  }
  out.minBaselineGap = Number.isFinite(minGap) ? Math.round(minGap) : 0
  if (plan.lines.length > 1) {
    if (minGap <= 0) {
      out.errors.push("the detail lines are not stacked downward")
    }
    // THE one that matters. PDFium groups text objects sharing a baseline into
    // a single line, so two details placed too close fuse into one object that
    // cannot be moved or edited apart — measured on a real catalogue page.
    if (minGap <= out.fontSize) {
      out.errors.push(
        `only ${minGap.toFixed(1)}pt between baselines at ${out.fontSize}pt text —`
        + " lines this close fuse into one uneditable object")
    }
  }

  // A drop in the very corner must slide the whole block onto the paper
  // rather than let its price line fall off the bottom.
  const corner = planProductBlock(lines, { ...OPTIONS, dropXPts: 590, dropYFromTopPts: 838 })
  const lowest = Math.min(...corner.lines.map((l) => l.baselineY))
  const rightmost = Math.max(...corner.lines.map((l) => l.x + l.width))
  out.cornerDrop = {
    left: Math.round(corner.lines[0]?.x ?? 0),
    topFromTop: Math.round(PAGE.heightPts - (corner.image?.y ?? 0) - (corner.image?.height ?? 0)),
  }
  if (lowest < 0 || rightmost > PAGE.widthPts) {
    out.errors.push(
      `dropped in the corner, the block runs off the page (lowest baseline ${lowest.toFixed(1)},`
      + ` right edge ${rightmost.toFixed(1)} of ${PAGE.widthPts})`)
  }

  // A product with no photo still places its details — the drop must never do
  // nothing at all.
  const noPhoto = planProductBlock(lines, { ...OPTIONS, imagePx: null })
  out.noPhotoHasLines = noPhoto.image === null && noPhoto.lines.length === lines.length
  if (!out.noPhotoHasLines) {
    out.errors.push("a product with no photo did not produce a text-only block")
  }

  return out
}

/**
 * The other half: does a real drop on a real page actually REACH the handler?
 *
 * The arithmetic above can be perfect while the wiring is wrong, and that is
 * not hypothetical — an earlier feature in this editor had correct maths
 * hooked to the wrong drag system, passed its own test, and did nothing
 * whatsoever in the product. So this mounts the actual PdfEnginePage and fires
 * actual DragEvents at it.
 *
 * A 1:1 page — 600pt shown at 600px — so a coordinate mistake shows up
 * directly instead of being hidden by a scale factor.
 */
export interface ProductDropWiringResult {
  errors: string[]
  pageLitUpDuringHover: boolean
  droppedOnPage: { pageIndex: number; sku: string; x: number; y: number } | null
  droppedOnImage: { pageIndex: number; imageIndex: number; sku: string } | null
  /** Kept separately because the control below deliberately clears
   * droppedOnImage, which would otherwise make a PASS look like a miss in the
   * reported result. */
  imageDropCaptured: string | null
  /** The control: a drop carrying nothing must reach neither handler. */
  emptyDragIgnored: boolean
}

export async function runProductDropWiringTest(): Promise<ProductDropWiringResult> {
  const [{ createElement }, { createRoot }, { PdfEnginePage }] = await Promise.all([
    import("react"), import("react-dom/client"), import("./PdfEnginePage"),
  ])

  const out: ProductDropWiringResult = {
    errors: [], pageLitUpDuringHover: false, droppedOnPage: null,
    droppedOnImage: null, imageDropCaptured: null, emptyDragIgnored: false,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  const productDrag = (type: string, x: number, y: number, withProduct = true): DragEvent => {
    const dataTransfer = new DataTransfer()
    if (withProduct) setProductDragData(dataTransfer, PRODUCT)
    return new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y,
    })
  }

  try {
    const page = { index: 0, widthPts: 600, heightPts: 800, rotation: 0 }
    root.render(createElement(PdfEnginePage, {
      page,
      pageIndex: 0,
      displayWidth: 600,
      text: { loaded: true, lines: [] },
      images: {
        loaded: true,
        images: [{
          imageIndex: 0,
          bbox: { left: 100, bottom: 500, right: 300, top: 700 },
          pixelWidth: 500, pixelHeight: 500, hasClipPath: false, filters: ["DCTDecode"],
        }],
      },
      vectors: { loaded: true, groups: [] },
      contentMode: "images",
      revision: 0,
      renderPage: async () => null,
      renderPageRegion: async () => null,
      lastChange: null,
      loadPageText: async () => {},
      loadPageImages: async () => {},
      loadPageVectors: async () => {},
      onSelectLine: () => {},
      onReplaceImage: () => {},
      onReplaceVector: () => {},
      onDropOnImage: () => {},
      onDropOnPage: () => {},
      onDropAssetOnPage: () => {},
      onDropProductOnPage: (pageIndex, product, x, y) => {
        out.droppedOnPage = { pageIndex, sku: product.sku, x: Math.round(x), y: Math.round(y) }
      },
      onDropProductOnImage: (pageIndex, imageIndex, product) => {
        out.droppedOnImage = { pageIndex, imageIndex, sku: product.sku }
      },
      locks: new Set<string>(),
      alsoSelected: [],
      cropping: null,
      onCropCancel: () => {},
      onCropCommit: () => {},
      onTransformImage: () => {},
      onTransformVector: () => {},
      onResizeText: () => {},
      selection: null,
      onSelect: () => {},
      onMoveStart: () => {},
      draggingSlot: null,
      dropTargetPage: false,
      originPatchUrl: null,
      imagePreviewUrl: null,
    }))
    await new Promise((r) => setTimeout(r, 60))

    const surface = host.querySelector<HTMLElement>("[data-engine-page-index]")
    if (!surface) throw new Error("the page surface never rendered")
    const rect = surface.getBoundingClientRect()

    // ── Hover over bare paper ────────────────────────────────────────
    // preventDefault being called is what marks this a valid drop target;
    // without it the browser refuses the drop entirely. That is the property
    // "the page lights up" actually depends on.
    const hover = productDrag("dragover", rect.left + 400, rect.top + 100)
    surface.dispatchEvent(hover)
    out.pageLitUpDuringHover = hover.defaultPrevented
    if (!out.pageLitUpDuringHover) {
      out.errors.push(
        "the page did not accept a product drag during hover — the browser will"
        + " refuse the drop, which reads as dragging not working at all")
    }

    // ── Drop on bare paper ───────────────────────────────────────────
    // Deliberately away from the picture at (100,500)-(300,700)pt, which in
    // screen terms is 100..300 across and 100..300 down.
    surface.dispatchEvent(productDrag("drop", rect.left + 400, rect.top + 120))
    await new Promise((r) => setTimeout(r, 30))
    if (!out.droppedOnPage) {
      out.errors.push("a product dropped on bare paper never reached the editor")
    } else if (out.droppedOnPage.x !== 400 || out.droppedOnPage.y !== 120) {
      out.errors.push(
        `the drop landed at ${out.droppedOnPage.x},${out.droppedOnPage.y} points,`
        + " expected 400,120 — the block will not appear where it was released")
    }

    // ── Drop on the picture ──────────────────────────────────────────
    // The same gesture must mean something DIFFERENT here: replace this
    // photo, not add a block on top of it.
    const slot = host.querySelector<HTMLElement>("[data-pdf-image-slot]")
    if (!slot) {
      out.errors.push("the image slot never rendered, so replacing a photo could not be tested")
    } else {
      const slotRect = slot.getBoundingClientRect()
      const cx = slotRect.left + slotRect.width / 2
      const cy = slotRect.top + slotRect.height / 2
      const beforeCount = out.droppedOnPage
      slot.dispatchEvent(productDrag("drop", cx, cy))
      await new Promise((r) => setTimeout(r, 30))
      if (!out.droppedOnImage) {
        out.errors.push("a product dropped on a picture did not replace it")
      } else {
        out.imageDropCaptured =
          `page ${out.droppedOnImage.pageIndex} image ${out.droppedOnImage.imageIndex}`
          + ` <- ${out.droppedOnImage.sku}`
      }
      // And it must not ALSO have been handled as a page drop, which would
      // add a floating block on top of the replaced picture.
      if (out.droppedOnPage !== beforeCount) {
        out.errors.push("a drop on a picture also fired the page handler — it would do both")
      }
    }

    // ── The control ──────────────────────────────────────────────────
    // A drag carrying nothing must reach neither handler. Without this, a
    // handler that fired on every drop would pass everything above.
    out.droppedOnImage = null
    const seenPage = out.droppedOnPage
    surface.dispatchEvent(productDrag("drop", rect.left + 450, rect.top + 150, false))
    await new Promise((r) => setTimeout(r, 30))
    out.emptyDragIgnored = out.droppedOnImage === null && out.droppedOnPage === seenPage
    if (!out.emptyDragIgnored) {
      out.errors.push("CONTROL FAILED: a drop carrying no product still reached a handler")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    root.unmount()
    host.remove()
  }

  return out
}

/**
 * Puts the product panel on screen with a product already chosen, for looking
 * at.
 *
 * Seeded rather than searched: the panel's own search goes to the deployed
 * API and needs a signed-in session, which a visual check should not depend
 * on. What is being looked at here is the card and the placement button, not
 * the search.
 */
export async function showProductPanelWithProduct(language: "en" | "he"): Promise<void> {
  const [{ createElement }, { createRoot }, i18n, { PdfProductPanel },
    { QueryClient, QueryClientProvider }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("@/i18n"),
    import("./PdfProductPanel"),
    import("@tanstack/react-query"),
  ])
  await i18n.default.changeLanguage(language)

  document.getElementById("product-panel-inspect")?.remove()
  const host = document.createElement("div")
  host.id = "product-panel-inspect"
  host.style.cssText =
    "position:fixed;inset:0;display:flex;justify-content:flex-end;background:#f4f4f5"
  document.body.appendChild(host)

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  createRoot(host).render(createElement(
    QueryClientProvider, { client },
    createElement(PdfProductPanel, {
      product: PRODUCT,
      onPickProduct: () => {},
      mode: "add" as const,
      onApply: () => {},
      onPlaceProduct: () => {},
      onClose: () => {},
    }),
  ))
  await new Promise((r) => setTimeout(r, 400))
}
