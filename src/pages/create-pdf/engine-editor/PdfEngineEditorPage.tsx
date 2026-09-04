import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { usePdfTemplateQuery } from "@/features/pdfTemplates/api"
import { ROUTES } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { EngineTextLine, PagePlanRequest } from "@/lib/pdf-engine"
import type { CatalogCollection, CatalogProduct } from "@/features/catalogProducts/types"
import {
  fetchCollectionSkus, fetchProductCoverFile, lookupProductsBySkus,
  useCatalogCollectionsQuery,
} from "@/features/catalogProducts/api"
import { productDisplayName, toProductFieldLanguage } from "./productFields"
import { PRODUCT_BLOCK_FIELD_IDS, planProductBlock, productBlockLines } from "./productBlock"
import { PRODUCT_FIELDS } from "./productFields"
import {
  PRODUCT_PHOTO_FIELD, fieldsForKind, markFor, marksForProduct, marksOnPage,
  productCountOnPage, pruneSlotMarks,
  reanchorMarksOnPage, setSlotMark, slotKeyFor,
  type LiveBox, type ProductSlotMap, type ProductSlotMark,
} from "./productSlots"
import { fetchPdfAssetFile } from "@/features/pdfAssets/api"
import {
  fetchPageTemplateFile, usePdfPageTemplatesQuery, useSavePageTemplateMutation,
} from "@/features/pdfPageTemplates/api"
import { PdfSaveTemplateDialog } from "./PdfSaveTemplateDialog"
import { PdfTemplatePanel } from "./PdfTemplatePanel"
import { PdfGenerateDialog } from "./PdfGenerateDialog"
import { PdfRefreshDialog } from "./PdfRefreshDialog"
import { chunkForPages } from "./skuList"
import {
  bindingKey, pruneBindings, setBinding, shiftBindingsForInsert, verdictFor,
  emptyRefreshPlan,
  type ProductBinding, type ProductBindingMap, type RefreshPlan,
} from "./productBindings"
import type { PdfPageTemplate } from "@/features/pdfPageTemplates/types"
import type { PdfAsset } from "@/features/pdfAssets/types"

import type { PdfContentMode, PdfOrganizerMode } from "../pdfEditorTypes"
import { PdfPageOrganizer, type OrganizerPage } from "../PdfPageOrganizer"
import { usePdfEngineDocument, type SlotRef } from "./usePdfEngineDocument"
import { useCrossPageDrag, type CrossPageDrop } from "./useCrossPageDrag"
import { dropToPagePoints, textMoveDelta, textPlacementOnPage, imagePlacement } from "./dropGeometry"
import { CrossPageDragGhost } from "./CrossPageDragGhost"
import { findFreeSpot, newImageSize, type Box } from "./placement"
import { readImageSize } from "./imageFile"
import { PdfAssetPanel } from "./PdfAssetPanel"
import { PdfLayersPanel } from "./PdfLayersPanel"
import { PdfAddPageDialog } from "./PdfAddPageDialog"
import { isLocked, lockKeyFor, toggleLock } from "./locks"
import { buildSnapTargets, MOVE_EDGES, paintGuides, snapRect, type SnapTarget } from "./snapping"
import { applySelection, selectedSlots } from "./selectionOps"
import { PdfEngineWorkspace } from "./PdfEngineWorkspace"
import { PdfProductPanel } from "./PdfProductPanel"
import { PdfEditorLoadingScreen } from "../PdfEditorLoadingScreen"

/**
 * PDF Master editor, rebuilt on the PDFium engine.
 *
 * This is THE editor for uploaded PDFs — PdfCustomizerPage dispatches
 * pdf_master templates here, and it fills the whole page.
 *
 * It did not start that way. For a while it was a windowed view with a
 * floating tool rail and an "Expand" button that opened a full-screen shell
 * on top; the expanded one was the demonstration, it was the one that got
 * approved, and it is now simply the editor. The windowed view, its rail and
 * the Expand button are gone rather than kept as a second way of doing the
 * same thing — two layouts over one document is two sets of interaction bugs.
 *
 * The PDF is fetched from the API, edited in the browser, and saved by the
 * same engine that rendered it, so what is on screen and what is written to
 * the file are one engine's output by construction.
 *
 * This component owns the DOCUMENT and every dialog; PdfEngineWorkspace owns
 * the layout. Nothing is written anywhere until Download, which is why
 * leaving is guarded — see useUnsavedGuard.
 */

/**
 * Pages are drawn as wide as the space actually allows, measured at runtime
 * rather than fixed. A constant width left a wide window with large empty
 * margins on both sides of the paper — the document is the whole point of
 * this screen, so it gets the room.
 *
 * This is the width used only until the first measurement lands, and as the
 * floor if the panel is ever reported as absurdly narrow.
 */
const FALLBACK_PAGE_DISPLAY_WIDTH = 820

/**
 * How far a box must actually travel before a drag counts as a move, in CSS
 * pixels.
 *
 * Every click on an already-selected box is a drag of zero distance, and a
 * press with a hand on a mouse is rarely EXACTLY zero. Without a threshold,
 * clicking a selected caption to look at it would nudge the document by a
 * pixel and rewrite the PDF.
 */
const DRAG_COMMIT_THRESHOLD_PX = 3

/** Where a newly added overlay lands, in PDF points from the page's
 * top-left. Offset rather than centred so it never appears underneath the
 * tool rail the user just clicked. */
const NEW_OVERLAY_INSET_PTS = 48
const NEW_TEXT_WIDTH_PTS = 220
const NEW_TEXT_SIZE_PTS = 18

/**
 * Vertical gap between details added one after another from the product
 * panel, in PDF points.
 *
 * Comfortably more than a line: PDFium groups text objects that share a
 * baseline into one line, so two details placed too close would fuse into a
 * single object that cannot be moved or edited apart. Measured on a real
 * catalogue page, where a smaller step did exactly that.
 */
const PRODUCT_STACK_STEP_PTS = NEW_TEXT_SIZE_PTS * 1.8
const NEW_IMAGE_WIDTH_PTS = 180

/** Floor for the tool rail, so it can never slide above the app bar. */

interface SelectedLine {
  pageIndex: number
  line: EngineTextLine
}

export function PdfEngineEditorPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { templateId } = useParams({ strict: false }) as { templateId?: string }
  const templateQuery = usePdfTemplateQuery(templateId ?? "")
  const template = templateQuery.data

  // Loaded through the API by id, not from template.source_pdf_url — see
  // usePdfEngineDocument for why a direct R2 fetch cannot work.
  const doc = usePdfEngineDocument(template?.template_type === "pdf_master" ? templateId : null)

  const [contentMode, setContentMode] = useState<PdfContentMode>("text")
  const [selected, setSelected] = useState<SelectedLine | null>(null)
  const [draft, setDraft] = useState("")
  const [downloading, setDownloading] = useState(false)
  /** The width the workspace is drawing pages at, reported by it. Kept so
   * work prepared for a drag — the patch that erases the slot's old place —
   * is rendered at the size the pages are actually on screen. */
  const [pageDisplayWidth, setPageDisplayWidth] = useState(FALLBACK_PAGE_DISPLAY_WIDTH)
  /**
   * A picture of the SELECTED slot's area with the slot left out, ready in
   * advance so the moment a drag starts the place it came from can look
   * empty with no pause.
   *
   * Prepared on SELECTION rather than on drag start because a drag always
   * follows a separate click here — the first press selects, the second
   * begins the move — so the work lands in the gap between the two instead
   * of stalling the gesture.
   */
  const [originPatch, setOriginPatch] = useState<
    { pageIndex: number; kind: "text" | "image"; index: number; url: string } | null
  >(null)
  /**
   * The selected IMAGE rendered on its own, for the thing that travels with
   * the cursor. Not a crop of the page: a crop shows everything painted in
   * that area, so dragging a photo with a caption over it previewed the
   * caption moving too, when only the photo actually would.
   */
  const [imagePreview, setImagePreview] = useState<
    { pageIndex: number; index: number; url: string } | null
  >(null)

  const [organizerMode, setOrganizerMode] = useState<PdfOrganizerMode | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  /**
   * The product whose details are being poured into the page, and whether its
   * panel is showing.
   *
   * Both live HERE rather than inside the panel so that closing the panel does
   * not forget which product you were working on — a catalogue page is about
   * one product, and having to search for it again after glancing at the full
   * width of the page would make the panel not worth opening.
   */
  /** The START-side panel: the asset shelf, the template library, or
   * neither. A union rather than two booleans, so the two cannot both be
   * open and fight over the same edge — exactly how the right side works. */
  const [leftPanel, setLeftPanel] = useState<"assets" | "templates" | null>(null)
  const assetPanelOpen = leftPanel === "assets"
  /**
   * Which panel the RIGHT side is showing, if any.
   *
   * One at a time rather than a third column: the page is what this screen is
   * for, and every panel open at once leaves it a strip in the middle. The
   * asset library keeps the left side because the brief puts it there, and
   * because you reach for artwork and product data at different moments.
   */
  const [rightPanel, setRightPanel] = useState<"product" | "layers" | null>(null)
  /**
   * Slots locked against being moved.
   *
   * Held here and nowhere else, and deliberately NOT sent to the engine: a
   * PDF has nowhere to store a lock, so this lasts for the editing session
   * and no longer. Keyed by position rather than by index — see locks.ts for
   * why an index would silently transfer the lock to another object after
   * almost any edit.
   */
  const [locks, setLocks] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * Which boxes hold a PRODUCT'S details rather than fixed text.
   *
   * Keyed by where the box is, like locks, and for the same reason — see
   * productSlots.ts. This is what a template will be built from: a page plus
   * the knowledge of which box is the SKU and which is the photo.
   */
  const [productSlots, setProductSlots] = useState<ProductSlotMap>(() => new Map())
  /**
   * Which product each position on each page is showing, and what was written
   * into its boxes — Point 7's "linked to database" versus "manually
   * overridden". See productBindings.ts.
   */
  const [productBindings, setProductBindings] = useState<ProductBindingMap>(() => new Map())
  /**
   * The OTHER things being moved along with the selected one.
   *
   * A temporary group, held only here and never written to the file — a PDF
   * has no way to record that two objects belong together, and a group that
   * silently vanished on reopening would be worse than none.
   *
   * Only slots on the SAME page as the primary selection are kept: a group
   * spanning pages could not be moved by one delta, since the pages have
   * their own coordinate spaces.
   */
  /** The picture being trimmed, if any. */
  const [cropping, setCropping] = useState<{ pageIndex: number; imageIndex: number } | null>(null)
  /** Which page a new blank one would follow, while the size is being chosen. */
  const [addingPageAfter, setAddingPageAfter] = useState<number | null>(null)
  const [alsoSelected, setAlsoSelected] = useState<
    { pageIndex: number; kind: "text" | "image" | "vector"; index: number }[]
  >([])
  const productPanelOpen = rightPanel === "product"
  /** The strip of page thumbnails down the start edge. Open by default —
   * it is how you navigate a fourteen-page catalogue — but it costs real
   * width, so it can be put away. */
  const [thumbnailRailOpen, setThumbnailRailOpen] = useState(true)
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  /**
   * Where the last detail added from the panel went, so the next one can go
   * directly beneath it instead of being placed on its own.
   *
   * A ref, not state: nothing on screen is derived from it, and re-rendering
   * the page column after every add — 144ms on a real catalogue — to store a
   * number nobody looks at would be a waste.
   */
  const productRunAnchor = useRef<{ pageIndex: number; x: number; baselineY: number } | null>(null)
  /**
   * What is currently being carried, so alignment can leave it out of its own
   * targets.
   *
   * A ref rather than the drag state, because the snap callback has to be
   * built BEFORE useCrossPageDrag — it is an argument to it — and reading the
   * state it returns from inside it would be circular. Set as the gesture
   * begins and cleared when it ends.
   */
  const draggedItem = useRef<{ pageIndex: number; kind: string; index: number } | null>(null)

  const [newTextDraft, setNewTextDraft] = useState<{ pageIndex: number; text: string } | null>(null)
  /** The one selected slot across the whole document. Held here rather
   * than per page so selecting on one page clears every other, and so a
   * keyboard delete knows exactly what it is acting on. */
  const [selection, setSelection] = useState<
    { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null
  >(null)

  /**
   * A run of added details ends the moment the user does anything else —
   * clicks a box, picks a different product — so the next detail is placed
   * fresh rather than continuing a column they have stopped building.
   *
   * Without this, selecting a caption to read it and then deselecting would
   * still drop the next detail under a stack from ten minutes ago, possibly
   * off the bottom of whatever they are now looking at.
   */
  useEffect(() => { productRunAnchor.current = null }, [selection, product])

  /** Overlays land on the first page currently in view, so "Add text" adds
   * it where the user is looking rather than always on page 1. */
  const visiblePageIndex = useCallback(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-engine-page-index]")
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > 120) return Number(el.dataset.enginePageIndex ?? 0)
    }
    return 0
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Which slot a pending file-picker result belongs to. A ref, not state:
   * the picker resolves outside React's flow and re-rendering in between
   * would be pointless. */
  const pendingImageTarget = useRef<
    | { kind: "replace"; pageIndex: number; imageIndex: number }
    | { kind: "replaceVector"; pageIndex: number; vectorIndex: number }
    | { kind: "overlay"; pageIndex: number }
    | null
  >(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // A stale patch is never CLEARED here, only replaced. Clearing would be
    // a synchronous setState in an effect, and it buys nothing: the patch
    // is only ever used when it matches the slot actually being dragged
    // (see where it is passed down), so one left over from a previous
    // selection cannot be shown against the wrong object.
    if (!selection || selection.kind === "vector" || doc.phase !== "ready") return
    const page = doc.pages[selection.pageIndex]
    if (!page) return
    let cancelled = false
    const { pageIndex, kind, index } = selection
    // Rendered at the same scale the page is drawn at, so the patch drops
    // into the hole at exactly the right resolution.
    // At the size the pages are actually drawn — windowed or expanded — so
    // the patch that fills the hole is not a low-resolution one stretched to
    // fit once the page is zoomed in.
    const scale = (pageDisplayWidth / page.widthPts) * Math.min(window.devicePixelRatio || 1, 2)
    void doc.renderCleanPatch(pageIndex, kind, index, scale)
      .then((url) => {
        if (cancelled || !url) return
        setOriginPatch({ pageIndex, kind, index, url })
      })
      .catch(() => { /* the drag still works, it just shows no patch */ })

    if (kind === "image") {
      void doc.renderImagePreview(pageIndex, index)
        .then((url) => {
          if (cancelled || !url) return
          setImagePreview({ pageIndex, index, url })
        })
        .catch(() => { /* falls back to the plain outline */ })
    }
    return () => { cancelled = true }
  }, [selection, doc, pageDisplayWidth])

  /**
   * Back to the template list.
   *
   * No confirmation, deliberately. An earlier version asked "leave without
   * downloading?" whenever there were changes; it was removed because a
   * dialog in front of a button someone pressed on purpose is friction
   * every time, to guard against a mistake made rarely. The cost is real
   * and worth stating plainly: nothing is written anywhere until Download,
   * so leaving discards the edits with no way back.
   */
  const leaveEditor = useCallback(() => {
    void navigate({ to: ROUTES.CREATE_PDF })
  }, [navigate])

  /** The selected line, when the selection is text. */
  const selectedLine = selection?.kind === "text"
    ? doc.pageText[selection.pageIndex]?.lines[selection.index]
    : undefined

  /**
   * Styling runs through one place, because bold, italic and colour are one
   * operation on the engine side — applying them separately would mean
   * re-reading and re-writing the other two every time, and a stale read
   * would silently un-bold a line the moment its colour changed.
   */
  const restyle = useCallback((
    patch: Partial<{ bold: boolean; italic: boolean; color: { r: number; g: number; b: number } }>,
  ) => {
    if (selection?.kind !== "text") return
    const line = doc.pageText[selection.pageIndex]?.lines[selection.index]
    if (!line) return
    const next = {
      bold: patch.bold ?? line.bold,
      italic: patch.italic ?? line.italic,
      color: patch.color ?? { r: line.color.r, g: line.color.g, b: line.color.b },
    }
    const { pageIndex, index } = selection
    void doc.styleText(pageIndex, index, next)
      .then((newIndex) => {
        if (newIndex >= 0) setSelection({ pageIndex, kind: "text", index: newIndex })
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [selection, doc])

  /** Anything that keeps the selection on the same item after the engine
   * renumbers it. */
  const runOnSelection = useCallback((
    kind: "text" | "image" | "vector",
    run: (pageIndex: number, index: number) => Promise<number>,
  ) => {
    if (!selection || selection.kind !== kind) return
    const { pageIndex, index } = selection
    void run(pageIndex, index)
      .then((newIndex) => {
        if (newIndex >= 0) setSelection({ pageIndex, kind, index: newIndex })
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [selection])

  /** Everything already on a page, so a new item can be put somewhere free
   * rather than on top of the logo. */
  const occupiedBoxes = useCallback((pageIndex: number): Box[] => {
    const boxes: Box[] = []
    for (const line of doc.pageText[pageIndex]?.lines ?? []) boxes.push(line.bbox)
    for (const image of doc.pageImages[pageIndex]?.images ?? []) {
      if (image.bbox) boxes.push(image.bbox)
    }
    for (const group of doc.pageVectors[pageIndex]?.groups ?? []) boxes.push(group.bbox)
    return boxes
  }, [doc.pageText, doc.pageImages, doc.pageVectors])

  /**
   * Removes whatever is selected — one item, or a whole group.
   *
   * A group goes in ONE engine call, never a loop of single deletes, and the
   * reason is the rule that governs everything about groups here: a slot's
   * index is its POSITION. Removing one object renumbers the others, so
   * deleting three by the numbers read beforehand would remove the first and
   * then whatever inherited the second's number — destroying things the user
   * never selected, silently, on their document.
   *
   * Shared by the Delete key and the toolbar, so the two cannot diverge.
   */
  const deleteSelected = useCallback(() => {
    if (!selection) return
    const group = selectedSlots({ primary: selection, also: alsoSelected })
    const { pageIndex } = selection
    setSelection(null)
    setAlsoSelected([])

    if (group.length > 1) {
      void doc.removeSlots(pageIndex, group.map(({ kind, index }) => ({ kind, index })))
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
      return
    }

    const target = selection
    const run = target.kind === "image"
      ? doc.removeImage(target.pageIndex, target.index)
      : target.kind === "vector"
        ? doc.removeVector(target.pageIndex, target.index)
        : doc.removeText(target.pageIndex, target.index)
    void run.catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [selection, alsoSelected, doc])

  /** Delete/Backspace removes the selected slot, matching how every other
   * canvas editor behaves. Ignored while a dialog or input has focus, so
   * backspacing inside the text field never deletes the box behind it. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      if (!selection) return
      const el = document.activeElement
      const typing = el instanceof HTMLElement
        && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      if (typing) return
      e.preventDefault()
      deleteSelected()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selection, deleteSelected])

  /** Opens the editor for one line. The draft is seeded HERE rather than in
   * an effect keyed on `selected`: deriving it in an effect means an extra
   * render where the textarea still holds the previous line's text, and it
   * trips the project's set-state-in-effect rule for exactly that reason. */
  const openLine = (pageIndex: number, line: EngineTextLine) => {
    setSelected({ pageIndex, line })
    setDraft(line.text)
  }

  useEffect(() => {
    if (!selected) return
    // Selected on the next frame: the dialog is still animating in on this
    // one, and focusing a not-yet-visible element is ignored.
    const id = requestAnimationFrame(() => textareaRef.current?.select())
    return () => cancelAnimationFrame(id)
  }, [selected])

  /**
   * Says what happened to the TYPEFACE, when it is not what you would expect.
   *
   * Silence is right when the page's own font was kept, which is the normal
   * case. It is wrong in the other two: a heading that quietly changes face,
   * or a character that quietly does not appear, are both things you would
   * otherwise discover in print.
   */
  const reportFontOutcome = useCallback((r: {
    usedDocumentFont: boolean; fellBackBecause: string | null; unsupportedCharacters: string | null
  }) => {
    if (r.unsupportedCharacters) {
      toast.error(t(
        "pdfTemplates.engineFontMissingChars",
        "These characters cannot be drawn by any available font and will not appear: {{chars}}",
        { chars: r.unsupportedCharacters },
      ))
      return
    }
    if (!r.usedDocumentFont && r.fellBackBecause) {
      toast.warning(t(
        "pdfTemplates.engineFontFellBack",
        "This text was redrawn in a standard font — {{reason}}.",
        { reason: r.fellBackBecause },
      ))
    }
  }, [t])

  const commitEdit = async () => {
    if (!selected) return
    const { pageIndex, line } = selected
    const newText = draft
    setSelected(null)
    if (newText === line.text) return
    try {
      reportFontOutcome(await doc.editText(pageIndex, line.lineIndex, newText))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Cropping ──────────────────────────────────────────────────────────────

  /**
   * Commit a trim.
   *
   * The picture's pixels are genuinely cut, not masked — this build of PDFium
   * offers no way to set a clip path — so the result is one more generation
   * of encoding for a photograph. Worth knowing, and the reason the crop is
   * confirmed with a Done button rather than applied live as you drag.
   */
  const commitCrop = useCallback((
    pageIndex: number, imageIndex: number,
    region: { left: number; bottom: number; right: number; top: number },
  ) => {
    setCropping(null)
    void doc.cropImage(pageIndex, imageIndex, region)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [doc])

  // ── Selecting several things ──────────────────────────────────────────────

  /**
   * Clicking a slot, with or without Shift.
   *
   * The rule itself is a pure function in selectionOps — deliberately, and
   * not for tidiness. It used to live inside a `setSelection` updater and
   * call `setAlsoSelected` from within it. React runs updaters twice in
   * StrictMode to catch exactly that, so every Shift-click added the slot and
   * then immediately removed it again: shift-clicking did nothing at all, and
   * the group feature looked unimplemented.
   *
   * Both pieces of state are now written independently, from one answer
   * computed before either is touched.
   */
  const handleSelect = useCallback((
    next: { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null,
    additive: boolean,
  ) => {
    const result = applySelection({ primary: selection, also: alsoSelected }, next, additive)
    setSelection(result.primary)
    setAlsoSelected(result.also)
  }, [selection, alsoSelected])

  /** Everything currently being moved, primary first.
   *
   * Memoised because moveGroupBy depends on it: a fresh array every render
   * would give that callback a new identity every render, and it is handed to
   * gesture handlers that should not be rebuilt mid-drag. */
  const selectedGroup = useMemo(
    () => selectedSlots({ primary: selection, also: alsoSelected }),
    [selection, alsoSelected],
  )

  /** One picture's box on a page, for asking whether it is a product slot. */
  const boxOfImage = useCallback(
    (pageIndex: number, imageIndex: number) =>
      doc.pageImages[pageIndex]?.images[imageIndex]?.bbox ?? null,
    [doc.pageImages],
  )

  /** The key for one slot's current box, or null if it cannot be resolved. */
  const slotKeyOf = useCallback((slot: {
    pageIndex: number; kind: "text" | "image" | "vector"; index: number
  } | null) => {
    if (!slot) return null
    const { pageIndex, kind, index } = slot
    const bbox = kind === "text"
      ? doc.pageText[pageIndex]?.lines[index]?.bbox
      : kind === "image"
        ? doc.pageImages[pageIndex]?.images[index]?.bbox
        : doc.pageVectors[pageIndex]?.groups[index]?.bbox
    return { key: slotKeyFor(pageIndex, kind, bbox ?? null), bbox: bbox ?? null }
  }, [doc.pageText, doc.pageImages, doc.pageVectors])

  /**
   * The marks as they apply to the page RIGHT NOW.
   *
   * Derived rather than stored, and that is the second attempt at this. The
   * first watched the selected slot in an effect and moved its mark whenever
   * the selected box's key changed — which corrupted the page, because
   * selecting a DIFFERENT box is indistinguishable from the marked box
   * moving. Marking a picture as the product photo and then clicking a
   * caption moved the photo mark onto the caption, with nothing edited at all.
   *
   * Deriving removes the whole class of problem: there is no moment at which
   * a mark is "moved", so there is no signal to misread. What is stored is
   * where the user put each mark; what is used is that resolved against the
   * boxes actually on the page, by overlap. See reanchorMarksOnPage.
   *
   * Every consumer reads THIS — the badges, the toolbar, filling, saving a
   * template — so none of them can disagree about which box holds what.
   */
  const liveProductSlots = useMemo(() => {
    const boxesFor = (pageIndex: number): LiveBox[] => [
      ...(doc.pageText[pageIndex]?.lines ?? []).map((l) => ({ kind: "text" as const, bbox: l.bbox })),
      ...(doc.pageImages[pageIndex]?.images ?? [])
        .filter((i) => i.bbox !== null)
        .map((i) => ({ kind: "image" as const, bbox: i.bbox! })),
      ...(doc.pageVectors[pageIndex]?.groups ?? []).map((g) => ({ kind: "vector" as const, bbox: g.bbox })),
    ]
    /** Which lists have actually been READ for a page. An unread list is
     * indistinguishable from an empty one, so marks of that kind are left
     * alone rather than taken for stranded and dropped. */
    const loadedKindsFor = (pageIndex: number): Set<LiveBox["kind"]> => {
      const kinds = new Set<LiveBox["kind"]>()
      if (doc.pageText[pageIndex]?.loaded) kinds.add("text")
      if (doc.pageImages[pageIndex]?.loaded) kinds.add("image")
      if (doc.pageVectors[pageIndex]?.loaded) kinds.add("vector")
      return kinds
    }

    const pages = new Set([...productSlots.values()].map((m) => m.pageIndex))
    let next: ProductSlotMap = productSlots
    for (const pageIndex of pages) {
      next = reanchorMarksOnPage(
        next, pageIndex, boxesFor(pageIndex), loadedKindsFor(pageIndex))
    }
    return next
  }, [productSlots, doc.pageText, doc.pageImages, doc.pageVectors])

  /**
   * Put the selection back on the same objects after an operation moved them.
   *
   * Group operations RENUMBER things — a slot index is a position, and
   * turning or moving an object changes where it sits. The editor used to
   * clear the selection for that reason, which was safe and horrible to use:
   * every rotate had to be followed by selecting everything again before it
   * could be rotated once more.
   *
   * The engine now reports where each object ended up, so the selection can
   * follow them. It is only cleared when the engine could not find them,
   * which is better than leaving it pointing somewhere wrong.
   */
  const reselect = useCallback((pageIndex: number, slots: SlotRef[]) => {
    if (slots.length === 0) {
      setSelection(null)
      setAlsoSelected([])
      return
    }
    const [first, ...rest] = slots
    setSelection({ pageIndex, kind: first.kind, index: first.index })
    setAlsoSelected(rest.map((s) => ({ pageIndex, kind: s.kind, index: s.index })))
  }, [])

  /**
   * Moves a whole group by the delta the dragged slot travelled.
   *
   * Sent as ONE engine call. A slot's index is its position, so moving the
   * first of a group renumbers the rest — a second call using the numbers
   * read before the first would move the wrong things.
   */
  const moveGroupBy = useCallback((pageIndex: number, dxPts: number, dyPts: number) => {
    if (selectedGroup.length < 2) return false
    void doc.translateSlots(pageIndex, selectedGroup.map(({ kind, index }) => ({ kind, index })), dxPts, dyPts)
      // The move renumbers everything, so the selection follows the objects
      // to wherever the engine says they ended up — rather than being
      // cleared, which used to mean a group came apart the moment you
      // nudged it and had to be rebuilt to move it again.
      .then((moved) => reselect(pageIndex, moved))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
    return true
  }, [selectedGroup, doc, reselect])

  /**
   * Turn or mirror a whole group, as ONE shape.
   *
   * Sent as a single engine call for the index reason above, and the group is
   * turned about its SHARED centre rather than each item about its own. That
   * is the difference between rotating a laid-out block — which keeps its
   * arrangement, as every design tool does it — and every item spinning on
   * the spot, which scatters it.
   */
  const transformGroup = useCallback((
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => {
    if (!selection || selectedGroup.length < 2) return false
    const { pageIndex } = selection
    void doc.transformSlots(pageIndex, selectedGroup.map(({ kind, index }) => ({ kind, index })), op)
      .then((moved) => reselect(pageIndex, moved))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
    return true
  }, [selection, selectedGroup, doc, reselect])

  /**
   * Copy a whole group.
   *
   * The one group operation that is a LOOP rather than a single call, and it
   * is safe only because of the order. Text lines are numbered top-down by
   * position, and a copy lands below its original — so copying the LOWEST
   * first means each insertion only renumbers lines beneath it, which have
   * already been dealt with. Copying top-down instead would shift the very
   * indices still waiting to be used.
   *
   * Images are numbered in the order they were added, so a copy appends and
   * shifts nothing; descending order is harmless there and keeps one rule
   * for both.
   */
  const duplicateGroup = useCallback(async () => {
    if (!selection || selectedGroup.length < 2) return false
    const { pageIndex } = selection
    try {
      // One engine call, which does the copying in the safe order and reports
      // where the ORIGINALS ended up. Doing this from here instead would mean
      // reading the page back through React state, which is not guaranteed to
      // have caught up by the time the copy resolves — the selection would
      // sometimes land on the right objects and sometimes not.
      const originals = await doc.duplicateSlots(
        pageIndex, selectedGroup.map(({ kind, index }) => ({ kind, index })))
      reselect(pageIndex, originals)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setSelection(null)
      setAlsoSelected([])
    }
    return true
  }, [selection, selectedGroup, doc, reselect])

  /**
   * A move gesture has ended somewhere in the document.
   *
   * Landing back on the starting page is a plain translation; landing on
   * any other page hands the object over to that page, which PDFium does
   * by detaching and re-inserting it — so the text keeps its original
   * embedded font and a photo keeps its original bytes, rather than being
   * rebuilt from a substitute.
   */
  const handleDrop = async (drop: CrossPageDrop) => {
    draggedItem.current = null
    const { item, targetPageIndex } = drop
    const sourcePage = doc.pages[item.pageIndex]
    const targetPage = doc.pages[targetPageIndex]
    if (!sourcePage || !targetPage) return

    // Taken from the page as it is ACTUALLY drawn, reported by the drop
    // itself. This used to read the windowed measurement, which the expanded
    // view does not use — so once the pages were zoomed, every drop landed
    // about 1.8x too far from the corner, and further the more you zoomed.
    // There is now one number instead of two that could disagree.
    const scale = drop.targetPageWidthPx > 0
      ? drop.targetPageWidthPx / targetPage.widthPts
      : pageDisplayWidth / targetPage.widthPts
    const { xPts, yFromTopPts, widthPts, heightPts } = dropToPagePoints(drop, scale)
    const samePage = targetPageIndex === item.pageIndex

    // A press that never really travelled is a CLICK, not a move. Bailing
    // out here — before touching the document and before touching the
    // selection — is what lets a selected box stay selected when you click
    // it again, instead of committing a zero-distance move and clearing
    // itself on the way out.
    if (samePage && drop.travelledPx < DRAG_COMMIT_THRESHOLD_PX) return

    /** Follow the object to wherever it landed. Indices are not identities:
     * text lines are numbered by position, so a move renumbers them, and a
     * cross-page move renumbers on the page it arrives at. */
    const reselect = (pageIndex: number, index: number) => {
      if (index < 0) { setSelection(null); return }
      setSelection({ pageIndex, kind: item.kind, index })
    }

    try {
      if (item.kind === "text") {
        const line = doc.pageText[item.pageIndex]?.lines[item.index]
        if (!line) return
        if (samePage) {
          const { dx, dy } = textMoveDelta(line, sourcePage, xPts, yFromTopPts)
          // A group travels together, by the same delta, in one call.
          if (moveGroupBy(item.pageIndex, dx, dy)) return
          const newIndex = await doc.moveText(item.pageIndex, item.index, dx, dy)
          reselect(item.pageIndex, newIndex)
          return
        }
        const { x, yBaseline } = textPlacementOnPage(line, targetPage, xPts, yFromTopPts)
        const newIndex = await doc.moveTextToPage(item.pageIndex, item.index, targetPageIndex, x, yBaseline)
        reselect(targetPageIndex, newIndex)
        return
      }

      const rect = imagePlacement(targetPage, xPts, yFromTopPts, widthPts, heightPts)
      if (samePage) {
        // A group travels together. This was only wired into the RESIZE
        // commit, and a picture is moved through this path instead — so
        // Shift-selecting several and dragging moved only the one under the
        // pointer.
        const before = item.kind === "image"
          ? doc.pageImages[item.pageIndex]?.images[item.index]?.bbox
          : doc.pageVectors[item.pageIndex]?.groups[item.index]?.bbox
        if (before && moveGroupBy(item.pageIndex, rect.x - before.left, rect.y - before.bottom)) return
        const newIndex = await doc.setImageRect(item.pageIndex, item.index, rect)
        reselect(item.pageIndex, newIndex)
        return
      }
      const newIndex = await doc.moveImageToPage(item.pageIndex, item.index, targetPageIndex, rect)
      reselect(targetPageIndex, newIndex)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Alignment while something is being DRAGGED across the document.
   *
   * Snapping was first wired into useBoxTransform, which turned out to
   * handle only resizing — a move goes through useCrossPageDrag instead. So
   * nothing snapped while dragging, which is the case anyone would notice
   * first. This is the missing half.
   *
   * Works in the target page's own CSS pixels: the ghost is positioned in
   * viewport coordinates, so it is converted in and back out here, which is
   * also the only place that knows which page is underneath.
   */
  const snapGhost = useCallback((
    ghost: { left: number; top: number; width: number; height: number },
    targetPageIndex: number,
    altKey: boolean,
  ) => {
    const surface = document.querySelector<HTMLElement>(
      `[data-engine-page-index="${targetPageIndex}"]`)
    const layer = surface?.querySelector<HTMLElement>("[data-pdf-guide-layer]") ?? null
    // A negative page index is the gesture ending: clear and stop.
    if (altKey || targetPageIndex < 0 || !surface) { paintGuides(layer, []); return null }

    const page = doc.pages[targetPageIndex]
    if (!page || page.widthPts <= 0) return null
    const box = surface.getBoundingClientRect()
    const scale = box.width / page.widthPts

    // Everything on that page except whatever is being carried.
    const moving = draggedItem.current
    const others: SnapTarget[] = []
    const add = (bbox: { left: number; bottom: number; right: number; top: number } | null) => {
      if (!bbox) return
      others.push({
        left: bbox.left * scale,
        right: bbox.right * scale,
        top: (page.heightPts - bbox.top) * scale,
        bottom: (page.heightPts - bbox.bottom) * scale,
      })
    }
    const skip = (kind: string, index: number) =>
      moving !== null && moving.pageIndex === targetPageIndex
      && moving.kind === kind && moving.index === index
    doc.pageText[targetPageIndex]?.lines.forEach((l, i) => { if (!skip("text", i)) add(l.bbox) })
    doc.pageImages[targetPageIndex]?.images.forEach((im, i) => { if (!skip("image", i)) add(im.bbox) })
    doc.pageVectors[targetPageIndex]?.groups.forEach((g, i) => { if (!skip("vector", i)) add(g.bbox) })

    const local = {
      left: ghost.left - box.left, top: ghost.top - box.top,
      width: ghost.width, height: ghost.height,
    }
    const result = snapRect(local, buildSnapTargets(box.width, box.height, others), MOVE_EDGES)
    paintGuides(layer, result.guides)
    return { left: result.rect.left + box.left, top: result.rect.top + box.top }
  }, [doc])

  const { drag, start: startDrag } = useCrossPageDrag(
    (drop) => void handleDrop(drop), snapGhost)

  /**
   * Escape means "cancel what I am doing", one layer at a time.
   *
   * It deliberately stops there. While the editor was a shell over a
   * windowed view, Escape's last step was to close that shell — harmless,
   * because the document was still open underneath. Now that this IS the
   * page, the same step would leave the editor entirely and take every
   * unsaved edit with it. A key pressed to dismiss a selection must not be
   * able to throw away an afternoon's work, so leaving is only ever
   * deliberate: the Templates button, which asks first.
   *
   * The drag half is handled by useCrossPageDrag; this only acts when
   * nothing is being dragged.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || drag) return
      if (selection) setSelection(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [drag, selection])

  /** Resizing text re-draws the same words at a new size and wrap width —
   * there is no box to stretch, so the line is rebuilt rather than scaled. */
  const handleResizeText = async (pageIndex: number, lineIndex: number, fontSize: number, maxWidth: number) => {
    const line = doc.pageText[pageIndex]?.lines[lineIndex]
    if (!line) return
    try {
      await doc.editText(pageIndex, lineIndex, line.text, { fontSize, maxWidth })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Images ────────────────────────────────────────────────────────────────

  const openFilePicker = (target: NonNullable<typeof pendingImageTarget.current>) => {
    pendingImageTarget.current = target
    fileInputRef.current?.click()
  }

  const handleFileChosen = async (file: File | undefined) => {
    const target = pendingImageTarget.current
    pendingImageTarget.current = null
    // Reset so picking the SAME file twice in a row still fires a change.
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (!file || !target) return

    try {
      if (target.kind === "replace") {
        await doc.replaceImage(target.pageIndex, target.imageIndex, file)
      } else if (target.kind === "replaceVector") {
        // Lands in the box the artwork occupied, so a swapped logo sits
        // where the old one was.
        await doc.replaceVector(target.pageIndex, target.vectorIndex, file)
      } else {
        const page = doc.pages[target.pageIndex]
        if (!page) return
        // Sized to the image's own aspect ratio so it isn't stretched into
        // whatever box we happened to guess. Read through readImageSize
        // rather than createImageBitmap directly, which cannot decode SVG.
        const { width: pxWidth, height: pxHeight } = await readImageSize(file)
        const size = newImageSize(page, pxWidth, pxHeight, NEW_IMAGE_WIDTH_PTS)
        // Put somewhere with ROOM, rather than always the same corner.
        // A fixed top-left inset is where a designed page keeps its logo, so
        // the new image landed underneath it — and since logos and text draw
        // above images, its top corners (the resize handles) were buried and
        // could not be grabbed. It looked like adding an image was broken.
        const spot = findFreeSpot(page, occupiedBoxes(target.pageIndex), size)
        const newIndex = await doc.addImageOverlay(
          target.pageIndex,
          { x: spot.x, y: spot.y, width: size.width, height: size.height },
          file,
        )
        // Selected immediately, so its handles are showing and it is obvious
        // both that something was added and where it went.
        if (newIndex >= 0) {
          setSelection({ pageIndex: target.pageIndex, kind: "image", index: newIndex })
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /** Committed once a move/resize gesture finishes. Clipped photos are
   * refused by the engine, so the error is surfaced rather than silently
   * leaving the box somewhere the document does not agree with. */
  const handleTransformImage = async (
    pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    // Dragging one member of a group moves the whole group by the same
    // amount, in one operation — see moveGroupBy for why it cannot be
    // several. A RESIZE is left alone: stretching a group is a different
    // feature with its own questions, and the brief does not ask for it.
    const before = doc.pageImages[pageIndex]?.images[imageIndex]?.bbox
    if (before) {
      const sameSize = Math.abs((before.right - before.left) - rect.width) < 0.5
        && Math.abs((before.top - before.bottom) - rect.height) < 0.5
      if (sameSize && moveGroupBy(pageIndex, rect.x - before.left, rect.y - before.bottom)) return
    }
    try {
      await doc.setImageRect(pageIndex, imageIndex, rect)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /** Artwork moves and resizes exactly as an image does — the engine
   * transforms every path in the group by one transform, so a logo keeps its
   * proportions and its pieces stay together. */
  const handleTransformVector = async (
    pageIndex: number, vectorIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const before = doc.pageVectors[pageIndex]?.groups[vectorIndex]?.bbox
    if (before) {
      const sameSize = Math.abs((before.right - before.left) - rect.width) < 0.5
        && Math.abs((before.top - before.bottom) - rect.height) < 0.5
      if (sameSize && moveGroupBy(pageIndex, rect.x - before.left, rect.y - before.bottom)) return
    }
    try {
      const next = await doc.setVectorRect(pageIndex, vectorIndex, rect)
      if (next >= 0) setSelection({ pageIndex, kind: "vector", index: next })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /** Dropped straight onto an existing photo — same as picking a file for
   * it, so it keeps that slot's position, size and shape. */
  const handleDropOnImage = async (pageIndex: number, imageIndex: number, file: File) => {
    try {
      await doc.replaceImage(pageIndex, imageIndex, file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /** Dropped on bare page — added as a new image centred on the drop point,
   * which is the whole advantage of dragging over clicking: the position is
   * chosen by the gesture instead of defaulting to a corner. */
  const handleDropOnPage = async (pageIndex: number, file: File, xPts: number, yFromTopPts: number) => {
    const page = doc.pages[pageIndex]
    if (!page) return
    try {
      const { width: pxWidth, height: pxHeight } = await readImageSize(file)
      const { width, height } = newImageSize(page, pxWidth, pxHeight, NEW_IMAGE_WIDTH_PTS)
      // Centred on the cursor — the whole point of dropping rather than
      // clicking is that YOU chose the spot — then clamped so an image
      // dropped near an edge still lands wholly on the page.
      const left = Math.min(Math.max(0, xPts - width / 2), Math.max(0, page.widthPts - width))
      const topFromTop = Math.min(Math.max(0, yFromTopPts - height / 2), Math.max(0, page.heightPts - height))
      const newIndex = await doc.addImageOverlay(
        pageIndex,
        // PDF y grows upward, so the bottom edge is measured from the far side.
        { x: left, y: page.heightPts - topFromTop - height, width, height },
        file,
      )
      if (newIndex >= 0) setSelection({ pageIndex, kind: "image", index: newIndex })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Products dropped onto a page ──────────────────────────────────────────

  /**
   * A product dropped onto bare paper becomes a BLOCK: its photo, with its key
   * details beneath it, as one unit.
   *
   * Why a block rather than just the photo — the client's document is explicit
   * that a dropped product must be understood as a product and not "simply an
   * image", and a catalogue tile is a picture with its name, code, size and
   * price under it. Dropping the photo alone would leave every one of those to
   * be added by hand, six clicks at a time.
   *
   * The geometry is worked out in full BEFORE anything is written (see
   * planProductBlock), because placing a block is several engine calls and a
   * half-placed block cannot be undone as one thing.
   */
  const handleDropProductOnPage = async (
    pageIndex: number, product: CatalogProduct, xPts: number, yFromTopPts: number,
  ) => {
    const page = doc.pages[pageIndex]
    if (!page) return

    /**
     * ── Point 6: swapping the product on a page ──
     *
     * If this page already HOLDS a product — that is, it has product slots —
     * then dropping another one onto it means "show this product instead",
     * not "add a second product on top of the first". The layout does not
     * move; only the data in the slots changes. That is the brief's own
     * wording, and it is the commonest act in building a catalogue: one
     * design, forty products.
     *
     * A page with no slots is a blank page as far as products are concerned,
     * so a drop there still places a block. The two behaviours never overlap,
     * because a page either has slots or it does not.
     */
    const productsHere = productCountOnPage(liveProductSlots, pageIndex)
    if (productsHere === 1) {
      const filled = await fillPageFromProduct(product, pageIndex, 0)
      if (filled) {
        toast.success(t(
          "pdfTemplates.productSwapped",
          "Now showing {{name}} — {{count}} slots updated",
          { name: productDisplayName(product), count: filled },
        ))
      }
      return
    }
    if (productsHere > 1) {
      // Which of the eight was meant? Bare paper cannot say, and guessing
      // would overwrite a position the user did not point at. Dropping onto a
      // product's own photo IS the answer, so that is what it asks for.
      toast.info(t(
        "pdfTemplates.productSwapAmbiguous",
        "This page holds {{count}} products. Drop onto the photo of the one you want to replace.",
        { count: productsHere },
      ))
      return
    }

    const language = toProductFieldLanguage(i18n.language)
    const lines = productBlockLines(product, language)

    // The photo is fetched first, and a failure here must not stop the block:
    // a product with no picture — or one whose picture cannot be read — still
    // has details worth placing. Its absence is reported once, quietly.
    let file: File | null = null
    let imagePx: { width: number; height: number } | null = null
    if (product.coverUrl) {
      try {
        file = await fetchProductCoverFile(product)
        imagePx = await readImageSize(file)
      } catch (err) {
        file = null
        imagePx = null
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }

    if (!file && lines.length === 0) {
      toast.error(t("pdfTemplates.productBlockEmpty", "This product has no photo and no details to place."))
      return
    }

    const plan = planProductBlock(lines, {
      page,
      dropXPts: xPts,
      dropYFromTopPts: yFromTopPts,
      imagePx,
      imageWidthPts: NEW_IMAGE_WIDTH_PTS,
      fontSizePts: NEW_TEXT_SIZE_PTS,
      lineStepPts: PRODUCT_STACK_STEP_PTS,
      marginPts: NEW_OVERLAY_INSET_PTS / 2,
    })

    try {
      if (plan.image && file) {
        await doc.addImageOverlay(pageIndex, plan.image, file)
      }
      for (const line of plan.lines) {
        await doc.addTextOverlay(pageIndex, {
          text: line.text,
          x: line.x,
          y: line.baselineY,
          width: line.width,
          fontSize: line.fontSize,
          color: { r: 17, g: 17, b: 17 },
        })
      }
      // A run of details added from the panel stacks under the last one
      // placed. A dropped block ends that run — the next detail clicked should
      // not land under a block that was positioned by hand somewhere else.
      productRunAnchor.current = null
      // Text is only shown in text mode, so a block dropped while looking at
      // the images layer would otherwise appear to have lost its details.
      if (plan.lines.length > 0) setContentMode("text")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Clicked rather than dragged.
   *
   * Kept alongside dragging for the same reason the asset library keeps both:
   * dragging chooses the exact spot, but clicking is faster when the block
   * will be nudged into place anyway, and it is the only route available from
   * a keyboard.
   *
   * Placed in a clear space rather than at a fixed corner, so placing three
   * products one after another does not stack them on top of each other.
   */
  const placeProductOnVisiblePage = () => {
    if (!product) return
    const pageIndex = visiblePageIndex()
    const page = doc.pages[pageIndex]
    if (!page) return
    // Roughly what a block occupies, which is all findFreeSpot needs to keep
    // it clear of what is already on the page.
    const size = {
      width: NEW_IMAGE_WIDTH_PTS,
      height: NEW_IMAGE_WIDTH_PTS + PRODUCT_STACK_STEP_PTS * PRODUCT_BLOCK_FIELD_IDS.length,
    }
    const spot = findFreeSpot(page, occupiedBoxes(pageIndex), size)
    // findFreeSpot reports a box in PDF coordinates, whose y is its BOTTOM
    // edge from the bottom of the page; the drop handler wants the block's TOP
    // edge measured from the top.
    void handleDropProductOnPage(
      pageIndex, product, spot.x, page.heightPts - spot.y - size.height)
  }

  /**
   * Pour a product into every marked box on the page in view.
   *
   * This is what product slots are FOR, and the whole point of marking them:
   * a page laid out once can be filled with any product, and filled again
   * with the next one. It is also the mechanism templates will use — a
   * template is this page plus these marks, saved.
   *
   * Slots are resolved to indices ONCE, up front, and then written to. Marks
   * are keyed by box, and filling a text box changes its box, so re-reading
   * the page between writes would lose the slots not yet filled.
   */
  const fillPageFromProduct = useCallback(async (
    chosen: CatalogProduct, targetPageIndex?: number, productIndex = 0,
  ) => {
    // A named page, because this is reached two ways: the panel's button means
    // "the page I am looking at", and a product DROPPED on a page means that
    // page, which may not be the one in view.
    //
    // And a named POSITION, because a page can hold eight products. Filling
    // every slot on such a page with one product would put the same tile in
    // all eight places, which is never what anyone means.
    const pageIndex = targetPageIndex ?? visiblePageIndex()
    const marks = marksForProduct(liveProductSlots, pageIndex, productIndex)
    if (marks.length === 0) {
      toast.error(t(
        "pdfTemplates.productSlotsNone",
        "No product slots on this page yet. Select a box and choose what it holds.",
      ))
      return 0
    }

    const language = toProductFieldLanguage(i18n.language)

    // Resolved before anything is written, for the reason above.
    const targets: { mark: typeof marks[number]; index: number }[] = []
    for (const mark of marks) {
      const list = mark.kind === "text"
        ? doc.pageText[pageIndex]?.lines
        : mark.kind === "image"
          ? doc.pageImages[pageIndex]?.images
          : doc.pageVectors[pageIndex]?.groups
      const index = (list ?? []).findIndex((entry) => {
        const bbox = "bbox" in entry ? entry.bbox : null
        return bbox !== null && slotKeyFor(pageIndex, mark.kind, bbox) === slotKeyFor(pageIndex, mark.kind, mark.bbox)
      })
      if (index >= 0) targets.push({ mark, index })
    }

    let filled = 0
    const skipped: string[] = []
    /** Exactly what goes into each box, so a refresh can tell later whether
     * anybody has changed it. */
    const written: Record<string, string> = {}

    for (const { mark, index } of targets) {
      try {
        if (mark.fieldId === PRODUCT_PHOTO_FIELD) {
          if (!chosen.coverUrl) { skipped.push("photo"); continue }
          const file = await fetchProductCoverFile(chosen)
          await doc.replaceImage(pageIndex, index, file)
          // The URL, not the bytes: it is the only thing about a picture that
          // can be compared cheaply, and it answers the question that matters
          // — has this product's photo changed since.
          written[mark.fieldId] = chosen.coverUrl
          filled++
          continue
        }
        const field = PRODUCT_FIELDS.find((f) => f.id === mark.fieldId)
        const value = field?.read(chosen, language) ?? null
        // A slot with nothing to put in it is LEFT ALONE rather than emptied.
        // Blanking it would destroy the page's own text for a product that
        // simply has no series recorded.
        if (!value) { skipped.push(mark.fieldId); continue }
        await doc.editText(pageIndex, index, value).then(reportFontOutcome)
        written[mark.fieldId] = value
        filled++
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }

    // Remembered so a later "refresh from database" knows whose price to
    // fetch, and can tell its own writing apart from somebody's editing.
    if (filled > 0) {
      setProductBindings((current) => setBinding(current, {
        pageIndex, productIndex, sku: chosen.sku, written,
      }))
      toast.success(t("pdfTemplates.productSlotsFilled", "Filled {{count}} slots", { count: filled }))
    }
    if (skipped.length > 0) {
      toast.warning(t(
        "pdfTemplates.productSlotsSkipped",
        "{{count}} slots left as they were — this product has no value for them",
        { count: skipped.length },
      ))
    }
    return filled
  }, [liveProductSlots, doc, i18n.language, t, visiblePageIndex, reportFontOutcome])

  /**
   * A product dropped onto an existing picture.
   *
   * Two meanings, decided by whether the page holds a product:
   *
   *   - On a page WITH slots, this is the brief's "drag product B over
   *     product A": the whole page swaps to the new product — photo, name,
   *     SKU, size, price — and the layout does not move. Dropping onto the
   *     photo is the natural way to express it, and swapping only the picture
   *     while the name underneath still said the old product would be worse
   *     than doing nothing: the page would be quietly, plausibly wrong.
   *
   *   - On a page with no slots, there is no product to swap, so it does what
   *     it always did: that picture becomes this product's photo, keeping its
   *     position, size and shape.
   */
  const handleDropProductOnImage = async (
    pageIndex: number, imageIndex: number, product: CatalogProduct,
  ) => {
    // Dropped onto a box that IS a product slot: that box says which product
    // position is meant, which is the only unambiguous answer on a page
    // holding several.
    const droppedOn = markFor(
      liveProductSlots, slotKeyFor(pageIndex, "image", boxOfImage(pageIndex, imageIndex)))
    if (droppedOn) {
      const filled = await fillPageFromProduct(product, pageIndex, droppedOn.productIndex)
      if (filled) {
        toast.success(t(
          "pdfTemplates.productSwapped",
          "Now showing {{name}} — {{count}} slots updated",
          { name: productDisplayName(product), count: filled },
        ))
      }
      return
    }
    if (!product.coverUrl) {
      toast.error(t("pdfTemplates.productNoPhoto", "This product has no photo."))
      return
    }
    try {
      const file = await fetchProductCoverFile(product)
      await doc.replaceImage(pageIndex, imageIndex, file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Duplicate, copy and paste ─────────────────────────────────────────────

  /**
   * What Ctrl+C put on the clipboard.
   *
   * A REFERENCE to a slot, not its contents. The engine copies straight from
   * the original object, which is the only way a copy can carry everything —
   * an embedded typeface, an image's exact pixels, a path's colours. Storing
   * a description here instead would mean rebuilding from that description,
   * and every property nobody thought to include would be quietly lost.
   *
   * The cost is that the copied slot has to still exist when you paste. That
   * is checked at paste time and reported, rather than pasting something
   * else that has since taken its index.
   */
  const clipboard = useRef<
    { pageIndex: number; kind: "text" | "image" | "vector"; index: number; label: string } | null
  >(null)

  const duplicateSelection = useCallback(async (toPageIndex?: number) => {
    if (!selection) return
    const { pageIndex, kind, index } = selection
    try {
      const target = toPageIndex ?? pageIndex
      const newIndex = await doc.duplicateSlot(pageIndex, kind, index, toPageIndex)
      if (newIndex >= 0) setSelection({ pageIndex: target, kind, index: newIndex })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [selection, doc])

  /**
   * Ctrl+C / Ctrl+V / Ctrl+D.
   *
   * Paste puts the copy on the page currently IN VIEW rather than the page it
   * was copied from — copying a caption on page 2 and pasting it on page 7 is
   * the reason paste exists at all, and pasting it back onto page 2 while you
   * are looking at page 7 would be useless.
   *
   * Ignored while typing, so these keys keep their ordinary meaning inside a
   * text field.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key !== "c" && key !== "v" && key !== "d") return
      const el = document.activeElement
      const typing = el instanceof HTMLElement
        && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      if (typing) return

      if (key === "c") {
        if (!selection) return
        e.preventDefault()
        const line = selection.kind === "text"
          ? doc.pageText[selection.pageIndex]?.lines[selection.index]
          : null
        clipboard.current = {
          ...selection,
          label: line?.text?.trim().slice(0, 30)
            || (selection.kind === "image" ? "picture" : "artwork"),
        }
        toast.success(t("pdfTemplates.engineCopied", "Copied"))
        return
      }

      if (key === "d") {
        if (!selection) return
        e.preventDefault()
        void duplicateSelection()
        return
      }

      const held = clipboard.current
      if (!held) return
      e.preventDefault()
      const onto = visiblePageIndex()
      void doc.duplicateSlot(held.pageIndex, held.kind, held.index, onto)
        .then((newIndex) => {
          if (newIndex >= 0) setSelection({ pageIndex: onto, kind: held.kind, index: newIndex })
        })
        .catch(() => {
          // The most likely reason is that the copied slot was edited or
          // deleted after it was copied, so its index now means something
          // else — said plainly rather than pasting whatever inherited it.
          toast.error(t(
            "pdfTemplates.enginePasteGone",
            "That copy is no longer available — the item it came from has changed.",
          ))
          clipboard.current = null
        })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selection, doc, duplicateSelection, t, visiblePageIndex])

  // ── Locking ───────────────────────────────────────────────────────────────

  /** The lock key for one slot, or null when it cannot be resolved. */
  const lockKeyForSlot = useCallback((slot: {
    pageIndex: number; kind: "text" | "image" | "vector"; index: number
  }) => {
    const { pageIndex, kind, index } = slot
    const bbox = kind === "text"
      ? doc.pageText[pageIndex]?.lines[index]?.bbox
      : kind === "image"
        ? doc.pageImages[pageIndex]?.images[index]?.bbox
        : doc.pageVectors[pageIndex]?.groups[index]?.bbox
    return lockKeyFor(pageIndex, kind, bbox ?? null)
  }, [doc.pageText, doc.pageImages, doc.pageVectors])

  /** The lock key for whatever is selected, or null when nothing is. */
  const selectionLockKey = selection ? lockKeyForSlot(selection) : null

  /**
   * Every lock key in the current selection.
   *
   * Locks are keyed by a slot's BOX rather than its index — precisely because
   * indices renumber — so a group lock needs no ordering care at all. Every
   * key is read from the page as it stands now, before anything changes.
   */
  const selectionLockKeys = useMemo(
    () => selectedGroup.map(lockKeyForSlot).filter((key): key is string => key !== null),
    [selectedGroup, lockKeyForSlot],
  )

  // ── Undo / redo ───────────────────────────────────────────────────────────

  /**
   * Step the document back or forward.
   *
   * The SELECTION is dropped first, always. Undo replaces the whole document:
   * the object that was selected may no longer exist, or may now be at a
   * different index — and a selection pointing at the wrong object is worse
   * than none, because the next thing the user does lands on it.
   */
  const runHistory = useCallback(async (direction: "undo" | "redo") => {
    setSelection(null)
    setSelected(null)
    setOriginPatch(null)
    setImagePreview(null)
    try {
      await (direction === "undo" ? doc.undo() : doc.redo())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [doc])

  /**
   * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, plus Ctrl+Y for the Windows habit.
   *
   * Ignored while a dialog or a field has focus, so undoing a typo inside the
   * Edit text box rewinds the TEXT rather than the document behind it — the
   * browser's own undo is the right one there.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (key !== "z" && key !== "y") return
      const el = document.activeElement
      const typing = el instanceof HTMLElement
        && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      if (typing) return
      e.preventDefault()
      const redo = key === "y" || e.shiftKey
      void runHistory(redo ? "redo" : "undo")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [runHistory])

  // ── Asset library ─────────────────────────────────────────────────────────

  /**
   * Artwork from the shared library, placed on a page.
   *
   * The bytes come through the API rather than straight from Cloudflare: R2
   * serves these objects without CORS headers, so the browser cannot fetch
   * them itself. Only PLACING needs this round trip — the panel's thumbnails
   * point an <img> at R2 directly and cost nothing.
   *
   * Once the file is in hand there is nothing asset-specific left, so all
   * three routes hand off to the same code that already handles an image
   * dragged in off the desktop. An asset behaves exactly like a picture
   * because by that point it IS one.
   */
  const withAssetFile = async (assetId: string, place: (file: File) => Promise<void>) => {
    try {
      const file = await fetchPdfAssetFile(assetId)
      await place(file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Dropped anywhere on a page — bare paper or over an existing picture.
   *
   * Always an ADDITION, never a replacement, and that is the one rule that
   * differs from a file dragged off the desktop. Artwork from the library is a
   * logo, a badge, a certification mark — things that belong on top of a
   * photo. Dropping one onto a photo used to destroy the photo, which is
   * never what dragging a logo over an image was meant to do.
   */
  const handleDropAssetOnPage = (
    pageIndex: number, assetId: string, xPts: number, yFromTopPts: number,
  ) => {
    void withAssetFile(assetId, (file) => handleDropOnPage(pageIndex, file, xPts, yFromTopPts))
  }

  /**
   * Clicked rather than dragged.
   *
   * Kept alongside dragging, not instead of it: dragging chooses the exact
   * spot, but clicking is faster when the position will be adjusted anyway,
   * and it is the only route available from a keyboard.
   */
  const placeAssetOnVisiblePage = (asset: PdfAsset) => {
    const pageIndex = visiblePageIndex()
    const page = doc.pages[pageIndex]
    if (!page) return
    void withAssetFile(asset.id, async (file) => {
      // The stored pixel size is used when we have it, so a wide logo stays
      // wide; falling back to reading the file only when the row predates
      // that column or the upload failed to report it.
      const source = asset.widthPx && asset.heightPx
        ? { width: asset.widthPx, height: asset.heightPx }
        : await readImageSize(file)
      const size = newImageSize(page, source.width, source.height, NEW_IMAGE_WIDTH_PTS)
      const spot = findFreeSpot(page, occupiedBoxes(pageIndex), size)
      const newIndex = await doc.addImageOverlay(
        pageIndex,
        { x: spot.x, y: spot.y, width: size.width, height: size.height },
        file,
      )
      // Selected on arrival so its handles are showing — unlike a product
      // detail, where selecting would flip that panel into replace mode,
      // there is no such trap here and seeing what you placed is worth more.
      if (newIndex >= 0) setSelection({ pageIndex, kind: "image", index: newIndex })
    })
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  const commitNewText = async () => {
    if (!newTextDraft) return
    const { pageIndex, text } = newTextDraft
    setNewTextDraft(null)
    const trimmed = text.trim()
    if (!trimmed) return
    const page = doc.pages[pageIndex]
    if (!page) return
    try {
      const newIndex = await doc.addTextOverlay(pageIndex, {
        text: trimmed,
        x: NEW_OVERLAY_INSET_PTS,
        y: page.heightPts - NEW_OVERLAY_INSET_PTS,
        width: Math.min(NEW_TEXT_WIDTH_PTS, page.widthPts - NEW_OVERLAY_INSET_PTS * 2),
        fontSize: NEW_TEXT_SIZE_PTS,
        color: { r: 17, g: 17, b: 17 },
      })
      setContentMode("text")
      // Selected on arrival, exactly as a new image is — so its handles are
      // showing and it is obvious both that something was added and where.
      if (newIndex >= 0) setSelection({ pageIndex, kind: "text", index: newIndex })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Product details ───────────────────────────────────────────────────────

  /**
   * The two things a product detail can do to a page, and which one happens.
   *
   * With a text box selected the detail REPLACES what is in it; with nothing
   * selected it arrives as a new text box. That is one gesture doing two jobs,
   * which is normally a smell — but it is the gesture the work actually has:
   * a catalogue page is part template (boxes already drawn, waiting for this
   * product's values) and part blank (a detail this layout never planned for).
   * Making the user pick a mode first would put a step in front of both.
   *
   * The panel is not left to infer this. It is told which of the two will
   * happen and says so above the list, so the mode is visible before the
   * click rather than discovered after it.
   */
  const productFieldMode: "replace" | "add" = selection?.kind === "text" ? "replace" : "add"

  /**
   * Replace the selected box's text with a product detail.
   *
   * The box's text is REPLACED, not appended to. In a designed catalogue the
   * label and the value are separate objects — "Size" is its own box and the
   * measurement is another — so the box being filled is the value.
   *
   * Routed through the same doc.editText the Edit text dialog uses, with no
   * options, so filling a box behaves exactly as typing the same words in.
   *
   * Worth knowing, because it surprises people: that call is not width-free.
   * With no maxWidth the engine wraps to the line's OWN current width (see
   * text.ts, `opts.maxWidth ?? right - left`). So a long product name dropped
   * into a short placeholder wraps into a narrow stack rather than running off
   * the page. Keeping the text inside the box is the right default for a
   * catalogue, and the box can be widened with the handles as usual — but it
   * is the engine's behaviour, not something chosen here, and overriding it
   * would make auto-fill differ from typing.
   */
  const replaceSelectedTextWith = (value: string) => {
    if (selection?.kind !== "text") return
    const { pageIndex, index } = selection
    const line = doc.pageText[pageIndex]?.lines[index]
    if (!line) return
    // The selection is left where it is, so the box stays ringed and you can
    // see what landed in it.
    if (line.text === value) return
    void doc.editText(pageIndex, index, value)
      .then(reportFontOutcome)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }

  /**
   * Put a product detail on the page as a NEW text box.
   *
   * Details are added in RUNS — SKU, then name, then series, then size — so
   * where the second one goes matters as much as the first. Two things were
   * measured on a real catalogue page and both drove this:
   *
   *   - Asking findFreeSpot each time does not work. On a designed page every
   *     candidate spot overlaps something, so it returns the least-bad one —
   *     and the least-bad one for the second detail sat on the SAME BASELINE
   *     as the first. PDFium groups text by baseline, so the two fused into
   *     one object reading "911120  Carnaby White", which cannot then be
   *     moved or edited apart.
   *
   *   - So only the FIRST detail of a run is placed by search. The rest stack
   *     beneath it, a clear line apart, which is both safe from grouping and
   *     what someone laying out a product block actually wants: a tidy column
   *     they can drag into position, not details scattered into whatever gaps
   *     the page happened to have.
   *
   * The run resets when the page changes or the stack reaches the bottom
   * margin, and any other edit ends it — see productRunAnchor.
   */
  const addTextFromProduct = async (value: string) => {
    const pageIndex = visiblePageIndex()
    const page = doc.pages[pageIndex]
    if (!page) return
    const width = Math.min(NEW_TEXT_WIDTH_PTS, page.widthPts - NEW_OVERLAY_INSET_PTS * 2)
    // Roughly what the finished box occupies, which is all findFreeSpot needs
    // to keep it clear of what is already there. A single line of text is
    // about its font size tall, with a little room for descenders.
    const height = NEW_TEXT_SIZE_PTS * 1.4

    const run = productRunAnchor.current
    const continuing = run !== null
      && run.pageIndex === pageIndex
      && run.baselineY - PRODUCT_STACK_STEP_PTS > NEW_OVERLAY_INSET_PTS
    const placement = continuing
      ? { x: run.x, baselineY: run.baselineY - PRODUCT_STACK_STEP_PTS }
      : (() => {
        const spot = findFreeSpot(page, occupiedBoxes(pageIndex), { width, height })
        // findFreeSpot describes a BOX and reports its bottom edge; the
        // overlay wants the first line's BASELINE, a font size up from there.
        return { x: spot.x, baselineY: spot.y + height - NEW_TEXT_SIZE_PTS }
      })()

    try {
      await doc.addTextOverlay(pageIndex, {
        text: value,
        x: placement.x,
        y: placement.baselineY,
        width,
        fontSize: NEW_TEXT_SIZE_PTS,
        color: { r: 17, g: 17, b: 17 },
      })
      productRunAnchor.current = { pageIndex, x: placement.x, baselineY: placement.baselineY }
      // Text boxes are only shown in text mode, so a detail added while
      // looking at the images layer would otherwise land invisibly.
      setContentMode("text")
      // Deliberately NOT selected, and this is the one place where selecting
      // what you just made is wrong. Selecting a text box switches the panel
      // to "replace", so auto-selecting here would mean the next detail
      // clicked overwrote the one just added instead of joining it. Adding a
      // run of details is the whole workflow; it must not break itself.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const applyProductField = (value: string) => {
    if (productFieldMode === "replace") replaceSelectedTextWith(value)
    else void addTextFromProduct(value)
  }

  // ── Page organizer ────────────────────────────────────────────────────────

  /** Small previews for the organizer dialog, rendered through the engine
   * so they show the document as it is NOW, including edits already made. */
  const openOrganizer = useCallback(async (mode: PdfOrganizerMode) => {
    setOrganizerMode(mode)
    const shots: Record<string, string> = {}
    for (let i = 0; i < doc.pages.length; i++) {
      const page = doc.pages[i]
      const scale = 160 / Math.max(1, page.widthPts)
      const rendered = await doc.renderPage(i, scale)
      if (!rendered) continue
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      if (!ctx) continue
      canvas.width = rendered.width
      canvas.height = rendered.height
      const imageData = ctx.createImageData(rendered.width, rendered.height)
      imageData.data.set(new Uint8ClampedArray(rendered.rgba))
      ctx.putImageData(imageData, 0, 0)
      shots[String(i)] = canvas.toDataURL("image/png")
    }
    setThumbnails(shots)
  }, [doc])

  /** The organizer works in its own draft world of OrganizerPage rows; this
   * maps the engine's current pages into that shape. clientId doubles as
   * the page's current index, which is what the plan needs back. */
  const organizerPages: OrganizerPage[] = useMemo(
    () => doc.pages.map((page, index) => ({
      key: `page-${index}`,
      clientId: String(index),
      sourceClientId: String(index),
      rotation: page.rotation,
    })),
    [doc.pages],
  )

  const applyOrganizer = async (result: OrganizerPage[]) => {
    setOrganizerMode(null)
    const plan: PagePlanRequest[] = result.map((row) => {
      const sourceIndex = Number(row.sourceClientId)
      const current = doc.pages[sourceIndex]?.rotation ?? 0
      // The organizer tracks ABSOLUTE rotation; the engine adds a delta to
      // whatever the source page already carried, so convert here.
      const delta = ((row.rotation - current) % 360 + 360) % 360
      return { sourceIndex, rotationDelta: delta || undefined }
    })
    try {
      await doc.applyPagePlan(plan)
      // Product marks are keyed by page NUMBER, and this is the one operation
      // that changes what those numbers mean. Done here, at the event, rather
      // than in an effect watching the page count — an effect would fire on
      // renders that changed nothing and write state synchronously while
      // doing it.
      //
      // Marks on pages that no longer exist are dropped, so a page taking a
      // freed number cannot inherit them. Marks are NOT carried through a
      // REORDER: they would have to be remapped through the plan, and a slot
      // silently landing on the wrong page is worse than one that has to be
      // set again. It is visible either way — the badge is on the box.
      setProductSlots((current) => pruneSlotMarks(current, plan.length))
      setProductBindings((current) => pruneBindings(current, plan.length))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Saving a page as a template ───────────────────────────────────────────

  /** Which page the save dialog is about, or null when it is closed. */
  const [savingTemplateFor, setSavingTemplateFor] = useState<number | null>(null)
  const saveTemplate = useSavePageTemplateMutation()

  /**
   * Store the page in view as a reusable template.
   *
   * Three things travel together and must agree with each other:
   *
   *   - the PAGE, extracted as its own single-page PDF. The open document is
   *     left completely alone — it is imported, not cut out — so saving a
   *     template never disturbs the catalogue being worked on.
   *   - its SLOTS, in that page's own PDF coordinates. Because the page is
   *     saved unchanged, the boxes recorded here are exactly the boxes in the
   *     saved file, at the same numbers.
   *   - a PREVIEW, rendered through the same engine, so the library shows
   *     what the page actually looks like rather than a guess.
   */
  // Not memoised: it is handed to a dialog's onSave and nothing depends on
  // its identity, so a useCallback here would buy nothing and only tie the
  // function to a dependency list that has to be kept correct.
  const savePageAsTemplate = async (details: {
    name: string; description: string; category: string; supplier: string
  }) => {
    const pageIndex = savingTemplateFor
    if (pageIndex === null) return
    const page = doc.pages[pageIndex]
    if (!page) return

    try {
      const pageBytes = await doc.savePage(pageIndex)

      // Rendered at the same width the organizer uses for its thumbnails —
      // enough to recognise a layout, small enough that a library of fifty
      // is not a download.
      let preview: Blob | null = null
      const rendered = await doc.renderPage(pageIndex, 200 / Math.max(1, page.widthPts))
      if (rendered) {
        const canvas = document.createElement("canvas")
        canvas.width = rendered.width
        canvas.height = rendered.height
        const ctx = canvas.getContext("2d")
        if (ctx) {
          const imageData = ctx.createImageData(rendered.width, rendered.height)
          imageData.data.set(new Uint8ClampedArray(rendered.rgba))
          ctx.putImageData(imageData, 0, 0)
          preview = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"))
        }
      }

      await saveTemplate.mutateAsync({
        ...details,
        pageBytes,
        preview,
        widthPts: page.widthPts,
        heightPts: page.heightPts,
        slots: marksOnPage(liveProductSlots, pageIndex).map((mark) => ({
          fieldId: mark.fieldId,
          kind: mark.kind,
          productIndex: mark.productIndex,
          bbox: mark.bbox,
        })),
      })

      setSavingTemplateFor(null)
      toast.success(t("pdfTemplates.saveTemplateDone", "Saved as a template"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Applying a template ───────────────────────────────────────────────────

  /** Which template is being applied, so its row can show it is working. */
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)

  /**
   * Insert a saved template after the page in view, slots and all.
   *
   * The slots are the point. A template's page arrives with its boxes in
   * exactly the coordinates they were saved in — the round trip through
   * PDFium is bit-for-bit on geometry, which is checked rather than assumed —
   * so the stored slots are registered against the new page directly, and the
   * page is ready to be filled from a product the moment it lands.
   *
   * Inserted as a NEW page rather than replacing the one in view. "Apply a
   * template to a page" could mean either, and replacing would silently
   * destroy whatever was there; anyone who does want that can delete the old
   * page, which is a deliberate act with its own undo.
   */
  const applyTemplate = async (template: PdfPageTemplate) => {
    const afterPageIndex = visiblePageIndex()
    setApplyingTemplateId(template.id)
    try {
      const bytes = await fetchPageTemplateFile(template.id)
      const newPageIndex = await doc.insertPageFrom(bytes, afterPageIndex)
      if (newPageIndex < 0) throw new Error("the template page could not be inserted")

      // The marks are keyed by page number, and inserting shifted every page
      // after this one — so existing marks are moved up before the new page's
      // are added, or a mark from page 3 would now describe page 4.
      setProductSlots((current) => {
        const next = new Map<string, ProductSlotMark>()
        for (const mark of current.values()) {
          const pageIndex = mark.pageIndex >= newPageIndex ? mark.pageIndex + 1 : mark.pageIndex
          const key = slotKeyFor(pageIndex, mark.kind, mark.bbox)
          if (key) next.set(key, { ...mark, pageIndex })
        }
        for (const slot of template.slots) {
          const key = slotKeyFor(newPageIndex, slot.kind, slot.bbox)
          if (key) {
            next.set(key, {
              fieldId: slot.fieldId,
              productIndex: slot.productIndex,
              pageIndex: newPageIndex,
              kind: slot.kind,
              bbox: slot.bbox,
            })
          }
        }
        return next
      })

      setProductBindings((current) => shiftBindingsForInsert(current, newPageIndex))
      setSelection(null)
      setAlsoSelected([])
      toast.success(template.slots.length > 0
        ? t("pdfTemplates.templateApplied", "Template added with {{count}} product slots", {
          count: template.slots.length,
        })
        : t("pdfTemplates.templateAppliedNoSlots", "Template added"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setApplyingTemplateId(null)
    }
  }

  // ── Bulk generation ───────────────────────────────────────────────────────

  const [generateOpen, setGenerateOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateProgress, setGenerateProgress] = useState<{ done: number; total: number } | null>(null)
  const templateLibrary = usePdfPageTemplatesQuery()

  /**
   * The document's pages, named for the "add them after" list.
   *
   * The first and last are called out because those are what a prepared cover
   * and final page actually are, and "after the last page" is a different
   * intention from "after page 7" even when they are the same number today.
   */
  const generateTargetPages = useMemo(
    () => doc.pages.map((_, index) => {
      const number = index + 1
      if (index === 0 && doc.pages.length > 1) {
        return { index, label: t("pdfTemplates.generateAfterFirst", "Page 1 (the first page)") }
      }
      if (index === doc.pages.length - 1) {
        return {
          index,
          label: t("pdfTemplates.generateAfterLast", "Page {{n}} (the end)", { n: number }),
        }
      }
      return { index, label: t("pdfTemplates.generateAfterN", "Page {{n}}", { n: number }) }
    }),
    [doc.pages, t],
  )

  /**
   * The collections available to build from.
   *
   * Fetched only while the generate dialog is open — this is a scan of the
   * whole SKU table, and there is no reason to pay for it when somebody is
   * dragging a text box around.
   */
  const catalogCollections = useCatalogCollectionsQuery(generateOpen)

  /**
   * One collection's SKUs, for the dialog to append to its list.
   *
   * Returns null rather than an empty array on failure, so the dialog can
   * tell "this collection is empty" apart from "the request did not arrive" —
   * one is worth a message about the data, the other about the network.
   */
  const loadCollectionSkus = async (collection: CatalogCollection) => {
    try {
      return await fetchCollectionSkus(collection)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  /** Resolve a pasted list against the catalogue, before anything is built. */
  const checkSkus = async (skus: string[]) => {
    try {
      const { results, missing } = await lookupProductsBySkus(skus)
      return { found: results.filter((r) => r.product !== null).length, missing }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return { found: 0, missing: [] }
    }
  }

  /**
   * Build catalogue pages from one template and a list of SKUs.
   *
   * The client's worked example: forty SKUs into an eight-product template
   * makes five pages. The loop is exactly that — take the next eight, insert
   * a copy of the template, pour each product into its own position, repeat.
   *
   * Three things this is careful about:
   *
   *   - ORDER. The list is used exactly as given, repeats included. That is
   *     the requirement, stated in those words.
   *   - The template page is fetched ONCE and reused for every page. Fetching
   *     it forty times would be forty downloads of the same file.
   *   - A missing SKU leaves its tile as the template drew it rather than
   *     stopping the run. Forty pages abandoned over one bad code would be a
   *     poor trade, and the gap is visible on the page and named afterwards.
   */
  const generateCatalogue = async (
    template: PdfPageTemplate, skus: string[], afterIndex: number,
  ) => {
    // Where the user SAID, not where they happened to be scrolled to. With a
    // cover and a final page prepared in advance, what the product pages sit
    // between is the whole question.
    const startAfter = afterIndex
    const perPage = Math.max(1, template.productCount)
    const groups = chunkForPages(skus, perPage)
    if (groups.length === 0) return

    setGenerating(true)
    setGenerateProgress({ done: 0, total: groups.length })
    const notPlaced: string[] = []
    /** Collected as the run goes and committed once at the end: forty pages
     * would otherwise be forty state writes, each re-rendering the column. */
    const bindingsMade: ProductBinding[] = []

    try {
      const { results } = await lookupProductsBySkus(skus)
      // Keyed by position in the list, NOT by SKU: the same SKU can appear
      // twice and each occurrence is its own tile.
      const bySlot = results.map((r) => r.product)

      // Fetched once. Every page is a copy of these same bytes.
      const templateBytes = await fetchPageTemplateFile(template.id)

      let insertAfter = startAfter
      for (let g = 0; g < groups.length; g++) {
        // insertPageFrom TRANSFERS the buffer to the worker, which detaches
        // it here — so each page gets its own copy, or the second page would
        // be built from an empty array.
        const pageIndex = await doc.insertPageFrom(templateBytes.slice(0), insertAfter)
        if (pageIndex < 0) throw new Error("a template page could not be inserted")

        // The slots come from the template, so they are registered against
        // the new page directly rather than being re-marked by hand.
        const slots = template.slots
        for (let i = 0; i < groups[g].length; i++) {
          const product = bySlot[g * perPage + i]
          if (!product) { notPlaced.push(groups[g][i]); continue }
          const written = await fillTemplateSlots(pageIndex, slots, product, i)
          bindingsMade.push({ pageIndex, productIndex: i, sku: product.sku, written })
        }

        insertAfter = pageIndex
        setGenerateProgress({ done: g + 1, total: groups.length })
      }

      setProductBindings((current) => {
        // Everything after the insertion point moved down by the pages just
        // added, so existing bindings shift before the new ones are added.
        let next: ProductBindingMap = current
        for (let i = 0; i < groups.length; i++) next = shiftBindingsForInsert(next, startAfter + 1)
        let built = next
        for (const binding of bindingsMade) built = setBinding(built, binding)
        return built
      })
      setSelection(null)
      setAlsoSelected([])
      setGenerateOpen(false)
      toast.success(t(
        "pdfTemplates.generateDone",
        "Built {{pages}} pages from {{count}} SKUs",
        { pages: groups.length, count: skus.length },
      ))
      if (notPlaced.length > 0) {
        toast.warning(t(
          "pdfTemplates.generateSomeNotPlaced",
          "{{count}} SKUs were not in the catalogue and their places were left as the template drew them: {{list}}",
          { count: notPlaced.length, list: notPlaced.slice(0, 6).join(", ") },
        ))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
      setGenerateProgress(null)
    }
  }

  /**
   * Pour one product into one product position on a freshly inserted page.
   *
   * Works from the TEMPLATE'S slot list rather than the editor's marks: the
   * page has just been created, so its boxes are exactly where the template
   * says they are, and going through React state would mean waiting for it
   * to catch up between every one of forty pages.
   */
  const fillTemplateSlots = async (
    pageIndex: number,
    slots: PdfPageTemplate["slots"],
    product: CatalogProduct,
    productIndex: number,
  ): Promise<Record<string, string>> => {
    /** What actually reached each box, so a later refresh can tell its own
     * writing apart from somebody's editing. */
    const written: Record<string, string> = {}
    const language = toProductFieldLanguage(i18n.language)
    // Resolved before any writing: filling a text box changes its width, so
    // reading the page between writes would lose the slots not yet filled.
    const lines = await doc.readPageText(pageIndex)
    const images = await doc.readPageImages(pageIndex)

    const targets = slots
      .filter((slot) => slot.productIndex === productIndex)
      .map((slot) => {
        const key = slotKeyFor(pageIndex, slot.kind, slot.bbox)
        const index = slot.kind === "text"
          ? lines.findIndex((l) => slotKeyFor(pageIndex, "text", l.bbox) === key)
          : images.findIndex((im) => im.bbox && slotKeyFor(pageIndex, "image", im.bbox) === key)
        return { slot, index }
      })
      .filter((entry) => entry.index >= 0)

    for (const { slot, index } of targets) {
      try {
        if (slot.fieldId === PRODUCT_PHOTO_FIELD) {
          if (!product.coverUrl) continue
          await doc.replaceImage(pageIndex, index, await fetchProductCoverFile(product))
          written[slot.fieldId] = product.coverUrl
          continue
        }
        const field = PRODUCT_FIELDS.find((f) => f.id === slot.fieldId)
        const value = field?.read(product, language) ?? null
        // A slot with nothing to put in it is LEFT as the template drew it.
        // Blanking it would strip the design's own placeholder text for a
        // product that simply has no series recorded.
        if (!value) continue
        await doc.editText(pageIndex, index, value)
        written[slot.fieldId] = value
      } catch {
        // One slot failing must not abandon the other thirty-nine pages.
        // The gap is visible on the page, which is the honest outcome.
      }
    }
    return written
  }

  // ── Refresh from database (Point 7) ───────────────────────────────────────

  const [refreshOpen, setRefreshOpen] = useState(false)
  const [refreshPlan, setRefreshPlan] = useState<RefreshPlan | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)

  /**
   * Work out what a refresh WOULD change, without changing anything.
   *
   * Planned before applied on purpose. "Refresh" on a finished catalogue is a
   * frightening button unless you can see what it is about to touch — and the
   * number that reassures is not how many fields will change but how many of
   * your own edits are being left alone.
   */
  const planRefresh = async (): Promise<RefreshPlan> => {
    const plan = emptyRefreshPlan()
    const bindings = [...productBindings.values()]
    if (bindings.length === 0) return plan
    plan.products = bindings.length

    const language = toProductFieldLanguage(i18n.language)
    const { results } = await lookupProductsBySkus(bindings.map((b) => b.sku))
    // Keyed lower-case: a SKU stored on the page can differ from the
    // catalogue only in case, and that is not a missing product.
    const fresh = new Map(
      results.filter((r) => r.product).map((r) => [r.sku.toLowerCase(), r.product!]))

    // Read once per page rather than once per product: an eight-product page
    // would otherwise re-read the same page eight times.
    const pageIndexes = [...new Set(bindings.map((b) => b.pageIndex))]
    const linesByPage = new Map<number, Awaited<ReturnType<typeof doc.readPageText>>>()
    const imagesByPage = new Map<number, Awaited<ReturnType<typeof doc.readPageImages>>>()
    for (const pageIndex of pageIndexes) {
      linesByPage.set(pageIndex, await doc.readPageText(pageIndex))
      imagesByPage.set(pageIndex, await doc.readPageImages(pageIndex))
    }

    for (const binding of bindings) {
      const product = fresh.get(binding.sku.toLowerCase())
      if (!product) { plan.missingSkus.push(binding.sku); continue }

      const lines = linesByPage.get(binding.pageIndex) ?? []
      const images = imagesByPage.get(binding.pageIndex) ?? []

      for (const mark of marksForProduct(liveProductSlots, binding.pageIndex, binding.productIndex)) {
        const key = slotKeyFor(binding.pageIndex, mark.kind, mark.bbox)
        const isPhoto = mark.fieldId === PRODUCT_PHOTO_FIELD

        const slotIndex = isPhoto
          ? images.findIndex((im) => im.bbox && slotKeyFor(binding.pageIndex, "image", im.bbox) === key)
          : lines.findIndex((l) => slotKeyFor(binding.pageIndex, "text", l.bbox) === key)
        if (slotIndex < 0) continue

        // A picture cannot be compared by its contents, so its URL stands in:
        // "current" is taken to be whatever we last wrote, which means a photo
        // somebody replaced by hand is NOT detected. Said plainly in the
        // dialog rather than hidden.
        const current = isPhoto
          ? (binding.written[mark.fieldId] ?? "")
          : (lines[slotIndex]?.text ?? "")
        const freshValue = isPhoto
          ? product.coverUrl
          : (PRODUCT_FIELDS.find((f) => f.id === mark.fieldId)?.read(product, language) ?? null)

        const verdict = verdictFor({
          current, written: binding.written[mark.fieldId], fresh: freshValue,
        })
        if (verdict === "update") {
          plan.changes.push({
            pageIndex: binding.pageIndex, productIndex: binding.productIndex,
            sku: binding.sku, fieldId: mark.fieldId, kind: mark.kind,
            slotIndex, from: current, to: freshValue!,
          })
        } else if (verdict === "overridden") plan.overridden++
        else if (verdict === "unchanged") plan.unchanged++
      }
    }

    plan.missingSkus = [...new Set(plan.missingSkus)]
    return plan
  }

  const openRefresh = async () => {
    setRefreshOpen(true)
    setRefreshPlan(null)
    setRefreshBusy(true)
    try {
      setRefreshPlan(await planRefresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setRefreshOpen(false)
    } finally {
      setRefreshBusy(false)
    }
  }

  /**
   * Apply the plan.
   *
   * Text first, pictures after, and both grouped by page: writing text
   * changes a box's width, which moves it — so every slot index is resolved
   * during PLANNING, and the changes are applied from the end of each page
   * backwards so an earlier write cannot renumber a later one.
   */
  const applyRefresh = async (plan: RefreshPlan) => {
    setRefreshBusy(true)
    let done = 0
    const rewritten = new Map<string, Record<string, string>>()
    try {
      const ordered = [...plan.changes].sort((a, b) =>
        b.pageIndex - a.pageIndex || b.slotIndex - a.slotIndex)

      for (const change of ordered) {
        try {
          if (change.fieldId === PRODUCT_PHOTO_FIELD) {
            const { results } = await lookupProductsBySkus([change.sku])
            const product = results[0]?.product
            if (!product?.coverUrl) continue
            await doc.replaceImage(change.pageIndex, change.slotIndex,
              await fetchProductCoverFile(product))
          } else {
            await doc.editText(change.pageIndex, change.slotIndex, change.to)
          }
          const key = bindingKey(change.pageIndex, change.productIndex)
          rewritten.set(key, { ...(rewritten.get(key) ?? {}), [change.fieldId]: change.to })
          done++
        } catch {
          // One field failing must not abandon the rest of the refresh.
        }
      }

      // What was just written becomes the new baseline, or the very next
      // refresh would read these as somebody's manual edits.
      setProductBindings((current) => {
        let next = current
        for (const [key, fields] of rewritten) {
          const binding = current.get(key)
          if (!binding) continue
          next = setBinding(next, { ...binding, written: { ...binding.written, ...fields } })
        }
        return next
      })

      setRefreshOpen(false)
      toast.success(t("pdfTemplates.refreshDone", "Updated {{count}} fields", { count: done }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshBusy(false)
    }
  }

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await doc.save()
      const safeName = (template?.name || "document").replace(/[^\w.\-֐-׿ ]+/g, "_").trim() || "document"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${safeName}.pdf`
      a.click()
      // Revoked later rather than immediately: revoking before the browser
      // has started reading the blob cancels the download.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  // Counts both layers: image slots are always clickable, and text slots
  // are too unless the text layer has been switched off.
  /**
   * Everything the page column needs, gathered once.
   *
   * Both views render the SAME column from this, so a slot behaves
   * identically whether you are windowed or in full screen — there is no
   * second copy of the wiring to fall out of step.
   */
  const pageColumnProps = {
    contentMode,
    selection,
    onSelect: handleSelect,
    alsoSelected,
    cropping,
    onCropCancel: () => setCropping(null),
    onCropCommit: commitCrop,
    drag,
    onMoveStart: ((e, item, rect) => {
      draggedItem.current = item
      // The rest of the group travels with it, so its boxes go along too —
      // measured from the DOM, which is the only place their on-screen
      // positions exist. Only members on the same page as the one grabbed:
      // a group cannot span pages, and a slot on another page has no
      // meaningful offset from this one.
      const companions = selectedGroup
        .filter((slot) => !(slot.kind === item.kind && slot.index === item.index)
          && slot.pageIndex === item.pageIndex)
        .map((slot) => {
          const surface = document.querySelector<HTMLElement>(
            `[data-engine-page-index="${slot.pageIndex}"]`)
          const el = surface?.querySelector<HTMLElement>(
            slot.kind === "text"
              ? `[data-pdf-text-slot="${slot.index}"]`
              : slot.kind === "image"
                ? `[data-pdf-image-slot="${slot.index}"]`
                : `[data-pdf-vector-slot="${slot.index}"]`)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { left: r.left, top: r.top, width: r.width, height: r.height }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      startDrag(e, item, rect, companions)
    }) as typeof startDrag,
    originPatch,
    imagePreview,
    onEditLine: openLine,
    onReplaceImage: (pageIndex: number, imageIndex: number) =>
      openFilePicker({ kind: "replace", pageIndex, imageIndex }),
    onReplaceVector: (pageIndex: number, vectorIndex: number) =>
      openFilePicker({ kind: "replaceVector", pageIndex, vectorIndex }),
    onDropOnImage: (pageIndex: number, imageIndex: number, file: File) =>
      void handleDropOnImage(pageIndex, imageIndex, file),
    onDropOnPage: (pageIndex: number, file: File, x: number, y: number) =>
      void handleDropOnPage(pageIndex, file, x, y),
    onDropAssetOnPage: handleDropAssetOnPage,
    productSlots: liveProductSlots,
    onDropProductOnPage: (pageIndex: number, dropped: CatalogProduct, x: number, y: number) =>
      void handleDropProductOnPage(pageIndex, dropped, x, y),
    onDropProductOnImage: (pageIndex: number, imageIndex: number, dropped: CatalogProduct) =>
      void handleDropProductOnImage(pageIndex, imageIndex, dropped),
    onTransformImage: (
      pageIndex: number, imageIndex: number,
      rect: { x: number; y: number; width: number; height: number },
    ) => void handleTransformImage(pageIndex, imageIndex, rect),
    onTransformVector: (
      pageIndex: number, vectorIndex: number,
      rect: { x: number; y: number; width: number; height: number },
    ) => void handleTransformVector(pageIndex, vectorIndex, rect),
    onResizeText: (pageIndex: number, lineIndex: number, fontSize: number, maxWidth: number) =>
      void handleResizeText(pageIndex, lineIndex, fontSize, maxWidth),
    locks,
  }

  // Reached only on a cold load — opening a template from the list hands the
  // record over before navigating, so this is already answered by then.
  if (templateQuery.isLoading) {
    return (
      <PdfEditorLoadingScreen
        documentName=""
        phase="downloading"
        downloadPercent={null}
        error={null}
        onBack={leaveEditor}
      />
    )
  }
  if (templateQuery.isError || !template) {
    return <CenteredMessage>{t("pdfTemplates.notFound", "Template not found")}</CenteredMessage>
  }
  if (template.template_type !== "pdf_master") {
    return <CenteredMessage>{t("pdfTemplates.engineEditorOnlyMaster", "This editor only supports uploaded PDF templates.")}</CenteredMessage>
  }

  // Nothing is on screen until the document is, so the state before that has
  // to be a whole page too — see PdfEditorLoadingScreen.
  if (doc.phase !== "ready") {
    return (
      <>
        <PdfEditorLoadingScreen
          documentName={template.name}
          phase={doc.phase === "error" ? "error" : doc.phase === "opening" ? "opening" : "downloading"}
          downloadPercent={doc.downloadPercent}
          error={doc.error}
          onBack={leaveEditor}
        />
      </>
    )
  }

  return (
    // data-pdf-editor names the implementation actually on screen. Kept from
    // the period when two editors could open the same template: the switchover
    // test still asks the DOM which one it got rather than trusting the route.
    <div data-pdf-editor="engine" className="contents">
      <PdfEngineWorkspace
        doc={doc}
        documentName={template.name}
        onExit={leaveEditor}
        onDisplayWidthChange={setPageDisplayWidth}
        selection={selection}
        thumbnailRailOpen={thumbnailRailOpen}
        column={pageColumnProps}
        toolbar={{
          contentMode,
          onToggleContentMode: () => setContentMode((m) => (m === "text" ? "images" : "text")),
          onAddText: () => setNewTextDraft({ pageIndex: visiblePageIndex(), text: "" }),
          onAddImage: () => openFilePicker({ kind: "overlay", pageIndex: visiblePageIndex() }),
          onDuplicate: () => {
            if (selectedGroup.length > 1) { void duplicateGroup(); return }
            void duplicateSelection()
          },
          /** How many things the toolbar is acting on, so it can offer the
           * group's tools instead of one item's. */
          selectionCount: selectedGroup.length,
          selectionSlotField: markFor(liveProductSlots, slotKeyOf(selection)?.key ?? null)?.fieldId ?? null,
          slotFieldOptions: selection ? fieldsForKind(selection.kind) : [],
          selectionSlotProduct:
            markFor(liveProductSlots, slotKeyOf(selection)?.key ?? null)?.productIndex ?? 0,
          /** One more than the page currently uses, so another product can
           * always be started — and no more, so the list cannot run away. */
          slotProductChoices: selection
            ? Math.min(productCountOnPage(liveProductSlots, selection.pageIndex) + 1, 12)
            : 1,
          onSetSlotField: (fieldId: string | null, productIndex: number) => {
            const resolved = slotKeyOf(selection)
            if (!selection || !resolved?.key || !resolved.bbox) return
            setProductSlots(setSlotMark(liveProductSlots, resolved.key, {
              fieldId,
              productIndex,
              pageIndex: selection.pageIndex,
              kind: selection.kind,
              bbox: resolved.bbox,
            }))
          },
          cropping: cropping !== null,
          onToggleCrop: () => {
            if (cropping) { setCropping(null); return }
            if (selection?.kind !== "image") return
            setCropping({ pageIndex: selection.pageIndex, imageIndex: selection.index })
          },
          // A group counts as locked only when EVERY member is. Otherwise
          // the button would read "locked" while half the selection was
          // free to move.
          selectionLocked: selectedGroup.length > 1
            ? selectionLockKeys.length === selectedGroup.length
              && selectionLockKeys.every((key) => isLocked(locks, key))
            : isLocked(locks, selectionLockKey),
          onToggleLock: () => {
            if (selectedGroup.length > 1) {
              // One decision for the whole group: if every member is locked,
              // this unlocks them all; otherwise it locks them all. Toggling
              // each independently would leave a half-locked group, where the
              // button's next press does something different again.
              const allLocked = selectionLockKeys.length === selectedGroup.length
                && selectionLockKeys.every((key) => isLocked(locks, key))
              setLocks((current) => {
                let next = current
                for (const key of selectionLockKeys) {
                  const locked = isLocked(next, key)
                  if (locked !== !allLocked) next = toggleLock(next, key)
                }
                return next
              })
              return
            }
            if (!selectionLockKey) return
            setLocks((current) => toggleLock(current, selectionLockKey))
          },
          onAddPage: () => setAddingPageAfter(selection?.pageIndex ?? visiblePageIndex()),
          onSaveTemplate: () => setSavingTemplateFor(visiblePageIndex()),
          onGenerate: () => setGenerateOpen(true),
          onRefreshFromDatabase: () => void openRefresh(),
          /** Hidden entirely when no product is linked to any page: a button
           * whose only possible answer is "nothing to do" is noise. */
          canRefresh: productBindings.size > 0,
          canUndo: doc.canUndo,
          canRedo: doc.canRedo,
          onUndo: () => void runHistory("undo"),
          onRedo: () => void runHistory("redo"),
          thumbnailRailOpen,
          onToggleThumbnailRail: () => setThumbnailRailOpen((open) => !open),
          assetPanelOpen,
          onToggleAssetPanel: () =>
            setLeftPanel((p) => (p === "assets" ? null : "assets")),
          templatePanelOpen: leftPanel === "templates",
          onToggleTemplatePanel: () =>
            setLeftPanel((p) => (p === "templates" ? null : "templates")),
          productPanelOpen,
          onToggleProductPanel: () =>
            setRightPanel((p) => (p === "product" ? null : "product")),
          layersPanelOpen: rightPanel === "layers",
          onToggleLayersPanel: () =>
            setRightPanel((p) => (p === "layers" ? null : "layers")),
          onOpenOrganizer: (mode) => void openOrganizer(mode),
          onEditSelectedText: () => {
            if (selection?.kind !== "text") return
            const line = doc.pageText[selection.pageIndex]?.lines[selection.index]
            if (line) openLine(selection.pageIndex, line)
          },
          onReplaceSelectedImage: () => {
            if (selection?.kind !== "image") return
            openFilePicker({ kind: "replace", pageIndex: selection.pageIndex, imageIndex: selection.index })
          },
          onReplaceSelectedVector: () => {
            if (selection?.kind !== "vector") return
            openFilePicker({ kind: "replaceVector", pageIndex: selection.pageIndex, vectorIndex: selection.index })
          },
          onDeleteSelected: deleteSelected,
          onDeselect: () => setSelection(null),
          textStyle: selectedLine
            ? {
              bold: selectedLine.bold,
              italic: selectedLine.italic,
              color: {
                r: selectedLine.color.r, g: selectedLine.color.g, b: selectedLine.color.b,
              },
            }
            : null,
          onToggleBold: () => restyle({ bold: !(selectedLine?.bold ?? false) }),
          onToggleItalic: () => restyle({ italic: !(selectedLine?.italic ?? false) }),
          onTextColor: (color) => restyle({ color }),
          onSetFont: (face) => {
            if (selection?.kind !== "text") return
            const { pageIndex, index } = selection
            const line = doc.pageText[pageIndex]?.lines[index]
            if (!line) return
            // Redrawn with the same words — the typeface is the only thing
            // changing, so the text is passed back through unaltered.
            void doc.editText(pageIndex, index, line.text,
              face === "document" ? {} : { font: face, useBundledFont: true })
              .then(reportFontOutcome)
              .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
          },
          onScaleText: (factor) =>
            runOnSelection("text", (p, i) => doc.scaleText(p, i, factor)),
          onAlignText: (alignment) =>
            runOnSelection("text", (p, i) => doc.alignText(p, i, alignment)),
          // Each falls through to the group path first: with several things
          // selected the answer is the same whichever kind the toolbar asked
          // about, because the whole selection turns together.
          onTransformText: (op) => {
            if (transformGroup(op)) return
            runOnSelection("text", (p, i) => doc.transformText(p, i, op))
          },
          onTransformImage: (op) => {
            if (transformGroup(op)) return
            runOnSelection("image", (p, i) => doc.transformImage(p, i, op))
          },
          onTransformVector: (op) => {
            if (transformGroup(op)) return
            runOnSelection("vector", (p, i) => doc.transformVector(p, i, op))
          },
          onTransformGroup: transformGroup,
          onDownload: () => void handleDownload(),
          downloading,
          busy: doc.busy,
          selection,
        }}
        leftPanel={leftPanel === "assets" ? (
          <PdfAssetPanel
            onPlaceAsset={placeAssetOnVisiblePage}
            onClose={() => setLeftPanel(null)}
          />
        ) : leftPanel === "templates" ? (
          <PdfTemplatePanel
            onApplyTemplate={(template) => void applyTemplate(template)}
            afterPageNumber={visiblePageIndex() + 1}
            applyingId={applyingTemplateId}
            onClose={() => setLeftPanel(null)}
          />
        ) : undefined}
        panel={rightPanel === "product" ? (
          <PdfProductPanel
            product={product}
            onPickProduct={setProduct}
            mode={productFieldMode}
            onApply={applyProductField}
            onPlaceProduct={placeProductOnVisiblePage}
            slotCountOnPage={marksForProduct(liveProductSlots, visiblePageIndex(), 0).length}
            productsOnPage={productCountOnPage(liveProductSlots, visiblePageIndex())}
            onFillSlots={() => { if (product) void fillPageFromProduct(product) }}
            onClose={() => setRightPanel(null)}
          />
        ) : rightPanel === "layers" ? (
          <PdfLayersPanel
            // The page in view, so the list is about what is on screen
            // rather than always page one.
            pageIndex={selection?.pageIndex ?? visiblePageIndex()}
            revision={doc.revision}
            loadLayers={doc.listLayers}
            onReorder={(kind, index, toPosition) => {
              const page = selection?.pageIndex ?? visiblePageIndex()
              void doc.reorderLayer(page, kind, index, toPosition)
                .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
              // The moved object is renumbered by the move, so holding the old
              // selection would point at whatever took its place.
              setSelection(null)
            }}
            selection={selection}
            onSelect={setSelection}
            onClose={() => setRightPanel(null)}
          />
        ) : undefined}
      />

      {/* Outside the workspace on purpose: it is fixed to the viewport, so
          it is never clipped by the shell it floats over. */}
      <CrossPageDragGhost drag={drag} />

      {/* One hidden picker serves both "replace this image" and "add an
          image"; pendingImageTarget records which one asked. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFileChosen(e.target.files?.[0])}
      />

      <PdfAddPageDialog
        open={addingPageAfter !== null}
        afterPage={addingPageAfter !== null ? doc.pages[addingPageAfter] ?? null : null}
        afterPageNumber={(addingPageAfter ?? 0) + 1}
        onCancel={() => setAddingPageAfter(null)}
        onAdd={(size) => {
          const after = addingPageAfter ?? 0
          setAddingPageAfter(null)
          void doc.addBlankPage(after, size)
            .then(() => {
              // Nothing on a blank page to keep selected, and the old
              // selection now points at a renumbered page.
              setSelection(null)
            })
            .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
        }}
      />

      <PdfRefreshDialog
        open={refreshOpen}
        plan={refreshPlan}
        busy={refreshBusy}
        onCancel={() => setRefreshOpen(false)}
        onApply={(plan) => void applyRefresh(plan)}
      />

      <PdfGenerateDialog
        open={generateOpen}
        templates={templateLibrary.data ?? []}
        templatesLoading={templateLibrary.isLoading}
        pages={generateTargetPages}
        defaultAfterIndex={visiblePageIndex()}
        onCheck={checkSkus}
        collections={catalogCollections.data ?? []}
        collectionsLoading={catalogCollections.isLoading}
        onLoadCollectionSkus={loadCollectionSkus}
        busy={generating}
        progress={generateProgress}
        onCancel={() => setGenerateOpen(false)}
        onGenerate={(template, skus, afterIndex) =>
          void generateCatalogue(template, skus, afterIndex)}
      />

      <PdfSaveTemplateDialog
        open={savingTemplateFor !== null}
        pageNumber={(savingTemplateFor ?? 0) + 1}
        pageSize={savingTemplateFor !== null ? doc.pages[savingTemplateFor] ?? null : null}
        slotFieldIds={
          savingTemplateFor === null
            ? []
            : marksOnPage(liveProductSlots, savingTemplateFor).map((m) => m.fieldId)
        }
        saving={saveTemplate.isPending}
        onCancel={() => setSavingTemplateFor(null)}
        onSave={(details) => void savePageAsTemplate(details)}
      />

      {organizerMode && (
        <PdfPageOrganizer
          mode={organizerMode}
          pages={organizerPages}
          thumbnails={thumbnails}
          onApply={(result) => void applyOrganizer(result)}
          onCancel={() => setOrganizerMode(null)}
        />
      )}

      {/* Edit existing text */}
      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              void commitEdit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pdfTemplates.masterEditTextTitle", "Edit text")}</DialogTitle>
          </DialogHeader>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            dir={selected?.line.direction === "rtl" ? "rtl" : "ltr"}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={() => void commitEdit()} disabled={doc.busy}>{t("common.save", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add new text */}
      <Dialog open={newTextDraft !== null} onOpenChange={(open) => { if (!open) setNewTextDraft(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pdfTemplates.engineAddTextTitle", "Add text")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="engine-new-text">{t("pdfTemplates.engineAddTextLabel", "Text")}</Label>
            <Input
              id="engine-new-text"
              value={newTextDraft?.text ?? ""}
              onChange={(e) => setNewTextDraft((prev) => (prev ? { ...prev, text: e.target.value } : prev))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commitNewText() } }}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("pdfTemplates.engineAddTextHint", "Added to the top-left of the page in view.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewTextDraft(null)}>{t("common.cancel", "Cancel")}</Button>
            <Button onClick={() => void commitNewText()} disabled={doc.busy}>{t("common.add", "Add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
