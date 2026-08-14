import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react"
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

import { PdfEditorRail, type PdfContentMode, type PdfOrganizerMode } from "../PdfEditorRail"
import { PdfPageOrganizer, type OrganizerPage } from "../PdfPageOrganizer"
import { usePdfEngineDocument } from "./usePdfEngineDocument"
import { PdfEnginePage } from "./PdfEnginePage"
import { useCrossPageDrag, type CrossPageDrop } from "./useCrossPageDrag"
import { dropToPagePoints, textMoveDelta, textPlacementOnPage, imagePlacement } from "./dropGeometry"
import { CrossPageDragGhost } from "./CrossPageDragGhost"

/**
 * PDF Master editor, rebuilt on the PDFium engine.
 *
 * Runs at its own route alongside the existing editor rather than
 * replacing it, so the current one keeps working untouched while this is
 * brought up to parity. Nothing here calls the Python edit service: the
 * PDF is fetched from the API, edited in the browser, and saved by the
 * same engine that rendered it.
 *
 * The tool rail and page-organizer dialog are the EXISTING components,
 * reused as-is. They are presentational and callback-driven, so the new
 * editor inherits the interaction design (and its undo/cancel behaviour)
 * rather than growing a second, subtly different version of it.
 */

/** Page width on screen. Wide enough to read catalogue body text without
 * making a 14-page document unmanageably tall. */
const PAGE_DISPLAY_WIDTH = 820

/** Where a newly added overlay lands, in PDF points from the page's
 * top-left. Offset rather than centred so it never appears underneath the
 * tool rail the user just clicked. */
const NEW_OVERLAY_INSET_PTS = 48
const NEW_TEXT_WIDTH_PTS = 220
const NEW_TEXT_SIZE_PTS = 18
const NEW_IMAGE_WIDTH_PTS = 180

/** Height of the app's own sticky top bar, below which this editor's
 * header sits. A constant because the bar is part of AdminLayout's chrome
 * and measuring it from here would couple the two. */
const APP_HEADER_HEIGHT_PX = 57
/** Floor for the tool rail, so it can never slide above the app bar. */
const MIN_RAIL_TOP_PX = APP_HEADER_HEIGHT_PX + 12

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
  const [railTop, setRailTop] = useState<number | null>(null)

  const [organizerMode, setOrganizerMode] = useState<PdfOrganizerMode | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  const [newTextDraft, setNewTextDraft] = useState<{ pageIndex: number; text: string } | null>(null)
  /** The one selected slot across the whole document. Held here rather
   * than per page so selecting on one page clears every other, and so a
   * keyboard delete knows exactly what it is acting on. */
  const [selection, setSelection] = useState<
    { pageIndex: number; kind: "text" | "image"; index: number } | null
  >(null)

  const headerRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Which slot a pending file-picker result belongs to. A ref, not state:
   * the picker resolves outside React's flow and re-rendering in between
   * would be pointless. */
  const pendingImageTarget = useRef<
    | { kind: "replace"; pageIndex: number; imageIndex: number }
    | { kind: "overlay"; pageIndex: number }
    | null
  >(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Keeps the floating tool rail pinned below this editor's own header.
   *
   * The app scrolls the WINDOW (its <main> sets no height, so the page
   * grows instead of scrolling internally). This editor's header is
   * therefore sticky, and the rail follows its resting position — before
   * that, both scrolled away and the page tools became unreachable
   * anywhere past the first page.
   */
  useEffect(() => {
    const measure = () => {
      const rect = headerRef.current?.getBoundingClientRect()
      if (!rect) return
      // Clamped: even mid-scroll, before the sticky offset settles, the
      // rail must never ride up under the app's own header bar.
      setRailTop(Math.max(rect.bottom + 12, MIN_RAIL_TOP_PX))
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [])

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
      const target = selection
      setSelection(null)
      const run = target.kind === "image"
        ? doc.removeImage(target.pageIndex, target.index)
        : doc.removeText(target.pageIndex, target.index)
      void run.catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selection, doc])

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

    // Every page is drawn at the same CSS width, so one scale serves both.
    const scale = PAGE_DISPLAY_WIDTH / targetPage.widthPts
    const { xPts, yFromTopPts, widthPts, heightPts } = dropToPagePoints(drop, scale)
    const samePage = targetPageIndex === item.pageIndex

    setSelection(null)
    try {
      if (item.kind === "text") {
        const line = doc.pageText[item.pageIndex]?.lines[item.index]
        if (!line) return
        if (samePage) {
          const { dx, dy } = textMoveDelta(line, sourcePage, xPts, yFromTopPts)
          if (dx === 0 && dy === 0) return
          await doc.moveText(item.pageIndex, item.index, dx, dy)
          return
        }
        const { x, yBaseline } = textPlacementOnPage(line, targetPage, xPts, yFromTopPts)
        await doc.moveTextToPage(item.pageIndex, item.index, targetPageIndex, x, yBaseline)
        return
      }

      const rect = imagePlacement(targetPage, xPts, yFromTopPts, widthPts, heightPts)
      if (samePage) {
        await doc.setImageRect(item.pageIndex, item.index, rect)
        return
      }
      await doc.moveImageToPage(item.pageIndex, item.index, targetPageIndex, rect)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const { drag, start: startDrag } = useCrossPageDrag((drop) => void handleDrop(drop))

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
      } else {
        const page = doc.pages[target.pageIndex]
        if (!page) return
        // Sized to the image's own aspect ratio so a logo isn't stretched
        // into whatever box we happened to guess.
        const bitmap = await createImageBitmap(file)
        const ratio = bitmap.height / bitmap.width
        bitmap.close()
        const width = Math.min(NEW_IMAGE_WIDTH_PTS, page.widthPts - NEW_OVERLAY_INSET_PTS * 2)
        const height = width * ratio
        await doc.addImageOverlay(
          target.pageIndex,
          {
            x: NEW_OVERLAY_INSET_PTS,
            // y is the BOTTOM edge in PDF space, so an item inset from the
            // top of the page sits at pageHeight - inset - its own height.
            y: page.heightPts - NEW_OVERLAY_INSET_PTS - height,
            width,
            height,
          },
          file,
        )
        // No mode change needed: image slots are always visible, so the
        // new one appears immediately wherever the text layer stands.
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
      const bitmap = await createImageBitmap(file)
      const ratio = bitmap.height / bitmap.width
      bitmap.close()
      const width = Math.min(NEW_IMAGE_WIDTH_PTS, page.widthPts * 0.8)
      const height = width * ratio
      // Centred on the cursor, then clamped so an image dropped near an
      // edge still lands wholly on the page rather than half off it.
      const left = Math.min(Math.max(0, xPts - width / 2), Math.max(0, page.widthPts - width))
      const topFromTop = Math.min(Math.max(0, yFromTopPts - height / 2), Math.max(0, page.heightPts - height))
      await doc.addImageOverlay(
        pageIndex,
        // PDF y grows upward, so the bottom edge is measured from the far side.
        { x: left, y: page.heightPts - topFromTop - height, width, height },
        file,
      )
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
      await doc.addTextOverlay(pageIndex, {
        text: trimmed,
        x: NEW_OVERLAY_INSET_PTS,
        y: page.heightPts - NEW_OVERLAY_INSET_PTS,
        width: Math.min(NEW_TEXT_WIDTH_PTS, page.widthPts - NEW_OVERLAY_INSET_PTS * 2),
        fontSize: NEW_TEXT_SIZE_PTS,
        color: { r: 17, g: 17, b: 17 },
      })
      setContentMode("text")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
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
  const editableCount = useMemo(() => {
    const images = Object.values(doc.pageImages).reduce((n, p) => n + (p?.images.length ?? 0), 0)
    const text = contentMode === "text"
      ? Object.values(doc.pageText).reduce((n, p) => n + (p?.lines.length ?? 0), 0)
      : 0
    return images + text
  }, [contentMode, doc.pageText, doc.pageImages])

  if (templateQuery.isLoading) {
    return <CenteredMessage><Loader2Icon className="size-5 animate-spin" /></CenteredMessage>
  }
  if (templateQuery.isError || !template) {
    return <CenteredMessage>{t("pdfTemplates.notFound", "Template not found")}</CenteredMessage>
  }
  if (template.template_type !== "pdf_master") {
    return <CenteredMessage>{t("pdfTemplates.engineEditorOnlyMaster", "This editor only supports uploaded PDF templates.")}</CenteredMessage>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky: the window is what scrolls in this app, so without this
          the toolbar (and the tool rail pinned under it) disappeared as
          soon as the user scrolled past the first page. */}
      <header
        ref={headerRef}
        className="sticky z-30 flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3"
        style={{ top: APP_HEADER_HEIGHT_PX }}
      >
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: ROUTES.CREATE_PDF })} className="gap-1.5">
          <ArrowLeftIcon className="size-4" />
          {t("common.back", "Back")}
        </Button>

        <span className="min-w-0 truncate text-sm font-medium">{template.name}</span>

        {doc.phase === "ready" && (
          // The text-boxes on/off switch used to sit here too. It now lives
          // ONLY in the tool rail, with the rest of the editing tools —
          // having it in both places meant two controls for one setting.
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("pdfTemplates.engineEditableSlots", "{{count}} editable slots", { count: editableCount })}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          {doc.busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={doc.phase !== "ready" || downloading || doc.busy}
            className="gap-1.5"
          >
            {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {t("pdfTemplates.masterDownload", "Download PDF")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6">
        {doc.phase === "downloading" && (
          <CenteredMessage>
            <Loader2Icon className="size-5 animate-spin" />
            <span>
              {t("pdfTemplates.engineDownloading", "Loading PDF")}
              {doc.downloadPercent !== null ? ` ${doc.downloadPercent}%` : ""}
            </span>
          </CenteredMessage>
        )}
        {doc.phase === "opening" && (
          <CenteredMessage>
            <Loader2Icon className="size-5 animate-spin" />
            <span>{t("pdfTemplates.engineOpening", "Preparing editor")}</span>
          </CenteredMessage>
        )}
        {doc.phase === "error" && (
          <CenteredMessage><span className="text-destructive">{doc.error}</span></CenteredMessage>
        )}

        {doc.phase === "ready" && (
          <div className="flex flex-col items-center gap-6">
            {/* data-engine-page-index lives on the page SURFACE inside
                PdfEnginePage, not on this wrapper: a drop is converted using
                the target's rect, and this wrapper can be wider than the page
                it holds, which would offset every landing position. Two
                elements carrying the attribute would also make the drag's
                hit-test ambiguous. */}
            {doc.pages.map((page, index) => (
              <div key={`${index}-${page.rotation}`}>
                <PdfEnginePage
                  page={page}
                  pageIndex={index}
                  displayWidth={PAGE_DISPLAY_WIDTH}
                  text={doc.pageText[index]}
                  images={doc.pageImages[index]}
                  contentMode={contentMode}
                  revision={doc.revision}
                  renderPage={doc.renderPage}
                  loadPageText={doc.loadPageText}
                  loadPageImages={doc.loadPageImages}
                  onSelectLine={openLine}
                  onReplaceImage={(pageIndex, imageIndex) => openFilePicker({ kind: "replace", pageIndex, imageIndex })}
                  onDropOnImage={(pageIndex, imageIndex, file) => void handleDropOnImage(pageIndex, imageIndex, file)}
                  onDropOnPage={(pageIndex, file, x, y) => void handleDropOnPage(pageIndex, file, x, y)}
                  onTransformImage={(pageIndex, imageIndex, rect) => void handleTransformImage(pageIndex, imageIndex, rect)}
                  onMoveStart={startDrag}
                  draggingSlot={drag ? { ...drag.item } : null}
                  dropTargetPage={drag !== null && drag.targetPageIndex === index}
                  onResizeText={(pageIndex, lineIndex, fontSize, maxWidth) => void handleResizeText(pageIndex, lineIndex, fontSize, maxWidth)}
                  selection={selection}
                  onSelect={setSelection}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {doc.phase === "ready" && (
        <PdfEditorRail
          top={railTop}
          contentMode={contentMode}
          onToggleContentMode={() => setContentMode((m) => (m === "text" ? "images" : "text"))}
          onOpenOrganizer={(mode) => void openOrganizer(mode)}
          // The switch belongs here rather than in the header: it is an
          // editing tool, and this editor's text layer stacks above its
          // image layer, so turning the boxes off is how a photo sitting
          // under a caption gets clicked.
          showContentModeToggle
          // Page rotation is deliberately not offered in this editor.
          showRotate={false}
          onAddText={() => setNewTextDraft({ pageIndex: visiblePageIndex(), text: "" })}
          onAddImage={() => openFilePicker({ kind: "overlay", pageIndex: visiblePageIndex() })}
        />
      )}

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
