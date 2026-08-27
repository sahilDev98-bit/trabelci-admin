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
import type { CatalogProduct } from "@/features/catalogProducts/types"

import type { PdfContentMode, PdfOrganizerMode } from "../pdfEditorTypes"
import { PdfPageOrganizer, type OrganizerPage } from "../PdfPageOrganizer"
import { usePdfEngineDocument } from "./usePdfEngineDocument"
import { useCrossPageDrag, type CrossPageDrop } from "./useCrossPageDrag"
import { dropToPagePoints, textMoveDelta, textPlacementOnPage, imagePlacement } from "./dropGeometry"
import { CrossPageDragGhost } from "./CrossPageDragGhost"
import { findFreeSpot, newImageSize, type Box } from "./placement"
import { readImageSize } from "./imageFile"
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
  const { t } = useTranslation()
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
  const [productPanelOpen, setProductPanelOpen] = useState(false)
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

  /** Removes whatever is selected. Shared by the Delete key and the
   * toolbar's delete button, so the two can never diverge. */
  const deleteSelected = useCallback(() => {
    if (!selection) return
    const target = selection
    setSelection(null)
    const run = target.kind === "image"
      ? doc.removeImage(target.pageIndex, target.index)
      : target.kind === "vector"
        ? doc.removeVector(target.pageIndex, target.index)
        : doc.removeText(target.pageIndex, target.index)
    void run.catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
  }, [selection, doc])

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

  const commitEdit = async () => {
    if (!selected) return
    const { pageIndex, line } = selected
    const newText = draft
    setSelected(null)
    if (newText === line.text) return
    try {
      await doc.editText(pageIndex, line.lineIndex, newText)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

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

  const { drag, start: startDrag } = useCrossPageDrag((drop) => void handleDrop(drop))

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

  // ── Overlays ──────────────────────────────────────────────────────────────

  /** Overlays land on the first page currently in view, so "Add text" adds
   * it where the user is looking rather than always on page 1. */
  const visiblePageIndex = () => {
    const els = document.querySelectorAll<HTMLElement>("[data-engine-page-index]")
    for (const el of els) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > 120) return Number(el.dataset.enginePageIndex ?? 0)
    }
    return 0
  }

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
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
    onSelect: setSelection,
    drag,
    onMoveStart: startDrag,
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
        column={pageColumnProps}
        toolbar={{
          contentMode,
          onToggleContentMode: () => setContentMode((m) => (m === "text" ? "images" : "text")),
          onAddText: () => setNewTextDraft({ pageIndex: visiblePageIndex(), text: "" }),
          onAddImage: () => openFilePicker({ kind: "overlay", pageIndex: visiblePageIndex() }),
          productPanelOpen,
          onToggleProductPanel: () => setProductPanelOpen((open) => !open),
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
          onScaleText: (factor) =>
            runOnSelection("text", (p, i) => doc.scaleText(p, i, factor)),
          onAlignText: (alignment) =>
            runOnSelection("text", (p, i) => doc.alignText(p, i, alignment)),
          onTransformImage: (op) =>
            runOnSelection("image", (p, i) => doc.transformImage(p, i, op)),
          onTransformVector: (op) =>
            runOnSelection("vector", (p, i) => doc.transformVector(p, i, op)),
          onDownload: () => void handleDownload(),
          downloading,
          busy: doc.busy,
          selection,
        }}
        panel={productPanelOpen ? (
          <PdfProductPanel
            product={product}
            onPickProduct={setProduct}
            mode={productFieldMode}
            onApply={applyProductField}
            onClose={() => setProductPanelOpen(false)}
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
