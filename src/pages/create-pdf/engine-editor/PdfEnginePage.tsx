import { useEffect, useRef, useState } from "react"

import { drawRenderedPage, type EnginePage, type EngineTextLine } from "@/lib/pdf-engine"
import type { PdfContentMode } from "../PdfEditorRail"
import type { PageTextState, PageImageState } from "./usePdfEngineDocument"
import { PdfEngineImageSlot } from "./PdfEngineImageSlot"
import { PdfEngineTextSlot } from "./PdfEngineTextSlot"

interface PdfEnginePageProps {
  page: EnginePage
  pageIndex: number
  /** CSS width the page is displayed at; the canvas is rendered at a higher
   * device resolution and scaled down to it. */
  displayWidth: number
  text: PageTextState | undefined
  images: PageImageState | undefined
  /**
   * Image slots are ALWAYS shown; this only controls whether the text
   * layer is drawn on top of them.
   *
   * Matching the existing editor deliberately (see PdfMasterCustomizer's
   * `if (isText && contentMode !== "text") return null` — only text is
   * ever filtered). Hiding images behind a mode switch, as an earlier
   * version of this file did, left the page looking as though it had no
   * editable images at all unless the user happened to find the toggle.
   */
  contentMode: PdfContentMode
  /** Changes whenever the document is edited, forcing a repaint. */
  revision: number
  renderPage: (pageIndex: number, scale: number) => Promise<{ width: number; height: number; rgba: ArrayBuffer } | null>
  loadPageText: (pageIndex: number) => Promise<void>
  loadPageImages: (pageIndex: number) => Promise<void>
  onSelectLine: (pageIndex: number, line: EngineTextLine) => void
  onReplaceImage: (pageIndex: number, imageIndex: number) => void
  /** A file dropped onto an existing photo — replaces it in place. */
  onDropOnImage: (pageIndex: number, imageIndex: number, file: File) => void
  /** A file dropped on bare page area — added as a new image AT that spot.
   * Coordinates are PDF points measured from the page's top-left, which is
   * how a human describes a position; the caller converts to PDF's
   * bottom-up space. */
  onDropOnPage: (pageIndex: number, file: File, xPts: number, yFromTopPts: number) => void
  /** Committed once a move/resize gesture ends, in PDF points. */
  onTransformImage: (
    pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => void
  /** The one selected slot in the WHOLE document, or null. Lifted out of
   * this component so selecting on page 2 clears page 1 — with per-page
   * state, two pages could each show handles at once, and a keyboard
   * delete would have no way to tell which one was meant. */
  selection: { pageIndex: number; kind: "text" | "image"; index: number } | null
  onSelect: (selection: { pageIndex: number; kind: "text" | "image"; index: number } | null) => void
  /** Starts a document-wide move of a slot on this page. */
  onMoveStart: (
    e: React.PointerEvent,
    item: { kind: "text" | "image"; pageIndex: number; index: number; label: string; direction?: "ltr" | "rtl" },
    rect: DOMRect,
  ) => void
  /** The slot currently in flight, so its box can dim in place while the
   * ghost carries it. */
  draggingSlot: { pageIndex: number; kind: "text" | "image"; index: number } | null
  /** True while a cross-page drag is hovering THIS page. */
  dropTargetPage: boolean
  /** Text resized: a new type size and the width it should wrap to. */
  onResizeText: (pageIndex: number, lineIndex: number, fontSize: number, maxWidth: number) => void
}

/** Widest bitmap PDFium is asked to produce for one page, in device pixels.
 * See the paint effect for why this is capped independently of layout. */
const MAX_RENDER_WIDTH_PX = 2400

/** The first image file in a drag payload, or null if it carries none.
 * Checked before showing any drop affordance so dragging a text selection
 * or a link never lights the page up as if it were droppable. */
function imageFromDrag(dt: DataTransfer | null): File | null {
  if (!dt) return null
  for (const file of Array.from(dt.files ?? [])) {
    if (file.type.startsWith("image/")) return file
  }
  return null
}

function dragCarriesFile(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.items ?? []).some((i) => i.kind === "file")
}

/**
 * One page: a PDFium-rendered canvas with clickable boxes over every
 * editable slot.
 *
 * The canvas is painted from PDFium's own output — the same engine that
 * writes the downloaded file — so what is on screen is what gets saved.
 * That is the property the previous pdf.js + Canvas + PyMuPDF pipeline
 * could not guarantee, since three separate engines had to agree.
 */
export function PdfEnginePage({
  page, pageIndex, displayWidth, text, images, contentMode, revision,
  renderPage, loadPageText, loadPageImages, onSelectLine, onReplaceImage,
  onDropOnImage, onDropOnPage, onTransformImage, onResizeText,
  selection, onSelect, onMoveStart, draggingSlot, dropTargetPage,
}: PdfEnginePageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [painting, setPainting] = useState(false)
  /** Which image slot a file is hovering over, if any. */
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  /** True while a file hovers the page but not over any slot. */
  const [dropPage, setDropPage] = useState(false)
  const selectedImage = selection?.pageIndex === pageIndex && selection.kind === "image" ? selection.index : null
  const selectedText = selection?.pageIndex === pageIndex && selection.kind === "text" ? selection.index : null

  const displayHeight = page.heightPts > 0 ? (displayWidth * page.heightPts) / page.widthPts : 0
  // PDF points -> CSS pixels, for placing hotspot boxes over the canvas.
  const scale = page.widthPts > 0 ? displayWidth / page.widthPts : 1

  // Pages are rendered only once they approach the viewport: a 14-page
  // catalogue rendered eagerly is 14 full-page rasters the user may never
  // scroll to, and each one occupies real memory.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setVisible(true) },
      { rootMargin: "400px 0px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || displayWidth <= 0) return
    let cancelled = false
    const paint = async () => {
      setPainting(true)
      try {
        // Render above CSS size so the page stays sharp on high-DPI screens.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        // ...but never beyond MAX_RENDER_WIDTH_PX. Pages are laid out as
        // wide as the window allows, and on a large monitor "CSS width x
        // device pixel ratio" grows fast: a 2500px-wide page at 2x is a
        // 5000x7000 bitmap, ~140MB of RGBA for ONE page, several of which
        // are held at once while scrolling. Capping the raster instead of
        // the layout keeps the paper full width and bounds the memory; the
        // cap only bites on displays wider than roughly 1200 CSS px of
        // page, and costs sharpness there rather than correctness.
        const cappedScale = Math.min(scale * dpr, MAX_RENDER_WIDTH_PX / page.widthPts)
        const result = await renderPage(pageIndex, cappedScale)
        if (cancelled || !result || !canvasRef.current) return
        drawRenderedPage(canvasRef.current, result)
      } finally {
        if (!cancelled) setPainting(false)
      }
    }
    void paint()
    return () => { cancelled = true }
  }, [visible, pageIndex, scale, displayWidth, page.widthPts, revision, renderPage])

  useEffect(() => {
    if (!visible || text?.loaded) return
    void loadPageText(pageIndex)
  }, [visible, text?.loaded, pageIndex, loadPageText])

  useEffect(() => {
    if (!visible || images?.loaded) return
    void loadPageImages(pageIndex)
  }, [visible, images?.loaded, pageIndex, loadPageImages])

  /** PDF's y axis grows upward from the bottom; CSS grows downward from the
   * top, so a box's top edge is measured from the page height. */
  const boxStyle = (bbox: { left: number; right: number; top: number; bottom: number }) => ({
    left: bbox.left * scale,
    top: (page.heightPts - bbox.top) * scale,
    width: Math.max(4, (bbox.right - bbox.left) * scale),
    height: Math.max(4, (bbox.top - bbox.bottom) * scale),
  })

  /** Page-level drop = add a NEW image exactly where it landed. Slots stop
   * propagation, so anything reaching here is genuinely bare page. */
  const handlePageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDropPage(false)
    setDropSlot(null)
    const file = imageFromDrag(e.dataTransfer)
    if (!file) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Drop point -> PDF points, measured from the page's top-left.
    const xPts = (e.clientX - rect.left) / scale
    const yFromTopPts = (e.clientY - rect.top) / scale
    onDropOnPage(pageIndex, file, xPts, yFromTopPts)
  }

  return (
    <div
      ref={containerRef}
      data-engine-page-index={pageIndex}
      className={`relative mx-auto bg-white shadow-sm ring-1 transition ${
        dropPage
          ? "ring-2 ring-emerald-500"
          : dropTargetPage
            ? "ring-2 ring-sky-500"
            : "ring-black/10"
      }`}
      style={{ width: displayWidth, height: displayHeight }}
      onDragEnter={(e) => { if (dragCarriesFile(e.dataTransfer)) { e.preventDefault(); setDropPage(true) } }}
      onDragOver={(e) => {
        if (!dragCarriesFile(e.dataTransfer)) return
        // Both preventDefault AND a copy effect are required, or the
        // browser refuses the drop and opens the file in a new tab.
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(e) => {
        // Ignore the leave events fired when the pointer crosses onto a
        // child; only a genuine exit of the page itself counts.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropPage(false)
      }}
      onDrop={handlePageDrop}
      onPointerDown={() => onSelect(null)}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ width: displayWidth, height: displayHeight }}
      />

      {painting && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-black/[0.03]" />
      )}

      {/* Images render FIRST so the text layer stacks above them: a caption
          sitting on a photo should be what a click lands on. Turning the
          text layer off is what lets a click reach the photo underneath. */}
      {images?.images.map((image) => {
        if (!image.bbox) return null
        return (
          <div
            key={`i-${pageIndex}-${image.imageIndex}`}
            className="contents"
            onDragEnter={(e) => {
              if (!dragCarriesFile(e.dataTransfer)) return
              e.preventDefault()
              e.stopPropagation()
              setDropSlot(image.imageIndex)
              setDropPage(false)
            }}
            onDragOver={(e) => {
              if (!dragCarriesFile(e.dataTransfer)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = "copy"
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDropSlot(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              // Stopped here so the page-level handler doesn't ALSO fire and
              // add a second copy as a floating image.
              e.stopPropagation()
              setDropSlot(null)
              setDropPage(false)
              const file = imageFromDrag(e.dataTransfer)
              if (file) onDropOnImage(pageIndex, image.imageIndex, file)
            }}
          >
            <PdfEngineImageSlot
              rect={boxStyle(image.bbox)}
              pageWidthPx={displayWidth}
              pageHeightPx={displayHeight}
              scale={scale}
              pageHeightPts={page.heightPts}
              selected={selectedImage === image.imageIndex}
              dropTarget={dropSlot === image.imageIndex}
              dragging={
                draggingSlot?.kind === "image"
                && draggingSlot.pageIndex === pageIndex
                && draggingSlot.index === image.imageIndex
              }
              onMoveStart={(e, r) => onMoveStart(
                e,
                { kind: "image", pageIndex, index: image.imageIndex, label: "" },
                r,
              )}
              onSelect={() => onSelect({ pageIndex, kind: "image", index: image.imageIndex })}
              onReplace={() => onReplaceImage(pageIndex, image.imageIndex)}
              onTransform={(rect) => onTransformImage(pageIndex, image.imageIndex, rect)}
            />
          </div>
        )
      })}

      {contentMode === "text" && text?.lines.map((line) => (
        <PdfEngineTextSlot
          key={`t-${pageIndex}-${line.lineIndex}`}
          line={line}
          rect={boxStyle(line.bbox)}
          pageWidthPx={displayWidth}
          pageHeightPx={displayHeight}
          scale={scale}
          selected={selectedText === line.lineIndex}
          dragging={
            draggingSlot?.kind === "text"
            && draggingSlot.pageIndex === pageIndex
            && draggingSlot.index === line.lineIndex
          }
          onSelect={() => onSelect({ pageIndex, kind: "text", index: line.lineIndex })}
          onEdit={() => onSelectLine(pageIndex, line)}
          onMoveStart={(e, r) => onMoveStart(
            e,
            { kind: "text", pageIndex, index: line.lineIndex, label: line.text, direction: line.direction },
            r,
          )}
          onResize={(fontSize, maxWidth) => { onSelect(null); onResizeText(pageIndex, line.lineIndex, fontSize, maxWidth) }}
        />
      ))}
    </div>
  )
}
