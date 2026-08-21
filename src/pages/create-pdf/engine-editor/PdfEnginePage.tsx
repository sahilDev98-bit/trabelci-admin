import { useEffect, useRef, useState } from "react"

import {
  drawRenderedPage, drawPagePatch,
  type EnginePage, type EngineTextLine, type PdfRect,
} from "@/lib/pdf-engine"
import type { PdfContentMode } from "../pdfEditorTypes"
import type { PageTextState, PageImageState, PageVectorState } from "./usePdfEngineDocument"
import { PdfEngineImageSlot } from "./PdfEngineImageSlot"
import { PdfEngineTextSlot } from "./PdfEngineTextSlot"
import { PdfEngineVectorSlot } from "./PdfEngineVectorSlot"

interface PdfEnginePageProps {
  page: EnginePage
  pageIndex: number
  /** CSS width the page is displayed at; the canvas is rendered at a higher
   * device resolution and scaled down to it. */
  displayWidth: number
  text: PageTextState | undefined
  images: PageImageState | undefined
  /** Logos and icons drawn as vector paths rather than placed as images. */
  vectors: PageVectorState | undefined
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
  /** Pixels for one rectangle of the page, used to touch up the canvas
   * after an edit instead of redrawing the whole thing. */
  renderPageRegion: (
    pageIndex: number, rect: PdfRect, scale: number,
  ) => Promise<{ width: number; height: number; rgba: ArrayBuffer; x: number; y: number } | null>
  /** The area the last edit touched, or null when the whole page has to be
   * repainted (a cross-page move, or anything that did not report an area). */
  lastChange: { pageIndex: number; rect: PdfRect; revision: number } | null
  loadPageText: (pageIndex: number) => Promise<void>
  loadPageImages: (pageIndex: number) => Promise<void>
  loadPageVectors: (pageIndex: number) => Promise<void>
  onReplaceVector: (pageIndex: number, vectorIndex: number) => void
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
  selection: { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null
  onSelect: (selection: { pageIndex: number; kind: "text" | "image" | "vector"; index: number } | null) => void
  /** Starts a document-wide move of a slot on this page. */
  onMoveStart: (
    e: React.PointerEvent,
    item: {
      kind: "text" | "image"; pageIndex: number; index: number; label: string
      direction?: "ltr" | "rtl"
      fontSizePx?: number
      color?: { r: number; g: number; b: number; a: number }
      previewUrl?: string
    },
    rect: DOMRect,
  ) => void
  /** The slot currently in flight, so its box can dim in place while the
   * ghost carries it. */
  draggingSlot: { pageIndex: number; kind: "text" | "image"; index: number } | null
  /** True while a cross-page drag is hovering THIS page. */
  dropTargetPage: boolean
  /** A picture of the dragged slot's area WITHOUT it, laid over the place it
   * came from so that spot looks empty rather than still occupied. Null
   * until it has been prepared, or if it could not be. */
  originPatchUrl: string | null
  /** The selected image rendered on its own, handed to the drag so the
   * thing under the cursor is the image and nothing drawn over it. */
  imagePreviewUrl: { pageIndex: number; index: number; url: string } | null
  /** Text resized: a new type size and the width it should wrap to. */
  onResizeText: (pageIndex: number, lineIndex: number, fontSize: number, maxWidth: number) => void
}

/**
 * Widest bitmap PDFium is asked to produce for one page, in device pixels.
 *
 * Paired with the zoom ceiling (see zoom.ts): at the maximum 400% an A4 page
 * is ~3173 CSS px, so this has to be at least that or zooming in to read
 * small text would just enlarge a blurry bitmap. One page at this size is
 * ~54MB of RGBA, and only pages near the viewport are ever rendered.
 */
const MAX_RENDER_WIDTH_PX = 3200

/**
 * Largest share of a page that is still worth repainting as a patch.
 *
 * Rendering a region costs roughly in proportion to its area, so patching
 * most of a page saves little while adding a second code path to be wrong
 * in. Past this, the page is simply repainted.
 */
const MAX_PATCH_COVERAGE = 0.4

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
  page, pageIndex, displayWidth, text, images, vectors, contentMode, revision,
  renderPage, renderPageRegion, lastChange, loadPageText, loadPageImages, loadPageVectors,
  onSelectLine, onReplaceImage, onReplaceVector,
  onDropOnImage, onDropOnPage, onTransformImage, onResizeText,
  selection, onSelect, onMoveStart, draggingSlot, dropTargetPage, originPatchUrl, imagePreviewUrl,
}: PdfEnginePageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /**
   * What is currently ON the canvas: which revision, at which raster scale.
   *
   * A patch is only valid as a touch-up of the picture immediately before
   * it. If this page missed a revision (it was scrolled out of view), or the
   * zoom changed since it was painted, the canvas is not the picture the
   * patch assumes and the page must be repainted in full.
   */
  const paintedRef = useRef<{ revision: number; scale: number; width: number } | null>(null)
  const lastChangeRef = useRef(lastChange)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [painting, setPainting] = useState(false)
  /** Which image slot a file is hovering over, if any. */
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  /** True while a file hovers the page but not over any slot. */
  const [dropPage, setDropPage] = useState(false)
  const selectedImage = selection?.pageIndex === pageIndex && selection.kind === "image" ? selection.index : null
  const selectedVector = selection?.pageIndex === pageIndex && selection.kind === "vector" ? selection.index : null
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

  // Declared BEFORE the paint effect so it runs first on every commit: the
  // paint effect reads this ref, and must see the change belonging to the
  // revision it is about to paint, not the previous one.
  useEffect(() => { lastChangeRef.current = lastChange })

  useEffect(() => {
    if (!visible || displayWidth <= 0) return
    let cancelled = false

    /** True if `rect` is a small enough part of the page to be worth
     * patching. A region render costs roughly in proportion to its area, so
     * past this share there is little left to save and a full repaint is
     * the simpler, always-correct path. */
    const worthPatching = (rect: PdfRect) => {
      const pageArea = page.widthPts * page.heightPts
      if (pageArea <= 0) return false
      const area = Math.max(0, rect.right - rect.left) * Math.max(0, rect.top - rect.bottom)
      return area / pageArea <= MAX_PATCH_COVERAGE
    }

    /**
     * True if this page is ALREADY right and needs no drawing at all.
     *
     * Every page the reader has scrolled past stays mounted, and an edit
     * bumps a revision the whole document shares — so without this, moving
     * one caption on page 2 redrew all fourteen pages at roughly 145ms
     * each. Thirteen of those redraw content that did not change.
     *
     * Safe only when the engine named the page it touched and this is not
     * it, this page is already painted at the size being asked for, and it
     * did not miss the revision in between.
     */
    const alreadyCurrent = (cappedScale: number) => {
      const change = lastChangeRef.current
      const painted = paintedRef.current
      if (!change || !painted) return false
      if (change.revision !== revision) return false
      if (change.pageIndex === pageIndex) return false
      if (painted.revision !== revision - 1) return false
      return painted.scale === cappedScale
    }

    /** Repaints only what changed. Returns false if that was not possible,
     * in which case the caller falls back to repainting everything. */
    const patch = async (cappedScale: number) => {
      const change = lastChangeRef.current
      const painted = paintedRef.current
      const canvas = canvasRef.current
      if (!change || !painted || !canvas) return false
      // Every one of these must hold, or the patch would be applied to a
      // picture it was not computed against.
      if (change.pageIndex !== pageIndex) return false
      if (change.revision !== revision) return false
      if (painted.revision !== revision - 1) return false
      if (painted.scale !== cappedScale) return false
      if (canvas.width <= 0 || canvas.height <= 0) return false
      if (!worthPatching(change.rect)) return false

      const region = await renderPageRegion(pageIndex, change.rect, cappedScale)
      if (cancelled || !region || !canvasRef.current) return false
      // The canvas may have been resized between the request and the reply.
      if (canvasRef.current !== canvas || canvas.width !== painted.width) return false
      if (!drawPagePatch(canvas, region)) return false
      paintedRef.current = { ...painted, revision }
      return true
    }

    const paint = async () => {
      // Render above CSS size so the page stays sharp on high-DPI screens.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cappedScale = Math.min(scale * dpr, MAX_RENDER_WIDTH_PX / page.widthPts)
      // Nothing happened on this page: keep the picture, and record that it
      // is current so the next edit can reason from it too.
      if (alreadyCurrent(cappedScale)) {
        paintedRef.current = { ...paintedRef.current!, revision }
        return
      }
      // Tried first, and silently: a patch is fast enough that showing a
      // "rendering" state for it would be a flash of overlay rather than
      // useful feedback.
      if (await patch(cappedScale)) return
      if (cancelled) return
      setPainting(true)
      try {
        // The raster is never wider than MAX_RENDER_WIDTH_PX. Pages are laid out as
        // wide as the window allows, and on a large monitor "CSS width x
        // device pixel ratio" grows fast: a 2500px-wide page at 2x is a
        // 5000x7000 bitmap, ~140MB of RGBA for ONE page, several of which
        // are held at once while scrolling. Capping the raster instead of
        // the layout keeps the paper full width and bounds the memory; the
        // cap only bites on displays wider than roughly 1200 CSS px of
        // page, and costs sharpness there rather than correctness.
        const result = await renderPage(pageIndex, cappedScale)
        if (cancelled || !result || !canvasRef.current) return
        drawRenderedPage(canvasRef.current, result)
        paintedRef.current = { revision, scale: cappedScale, width: result.width }
      } finally {
        if (!cancelled) setPainting(false)
      }
    }
    void paint()
    return () => { cancelled = true }
  }, [
    visible, pageIndex, scale, displayWidth, page.widthPts, page.heightPts,
    revision, renderPage, renderPageRegion,
  ])

  useEffect(() => {
    if (!visible || text?.loaded) return
    void loadPageText(pageIndex)
  }, [visible, text?.loaded, pageIndex, loadPageText])

  useEffect(() => {
    if (!visible || images?.loaded) return
    void loadPageImages(pageIndex)
  }, [visible, images?.loaded, pageIndex, loadPageImages])

  useEffect(() => {
    if (!visible || vectors?.loaded) return
    void loadPageVectors(pageIndex)
  }, [visible, vectors?.loaded, pageIndex, loadPageVectors])

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
              originPatchUrl={originPatchUrl}
              onMoveStart={(e, r) => onMoveStart(
                e,
                {
                  kind: "image", pageIndex, index: image.imageIndex, label: "",
                  previewUrl: imagePreviewUrl?.index === image.imageIndex
                    ? imagePreviewUrl.url
                    : undefined,
                },
                r,
              )}
              onSelect={() => onSelect({ pageIndex, kind: "image", index: image.imageIndex })}
              onReplace={() => onReplaceImage(pageIndex, image.imageIndex)}
              onTransform={(rect) => onTransformImage(pageIndex, image.imageIndex, rect)}
            />
          </div>
        )
      })}

      {/* Above the image layer and below the text layer, which is the order
          the PDF itself paints them: a logo sits on the background photo,
          and a caption sits on top of both. */}
      {vectors?.groups.map((group) => (
        <PdfEngineVectorSlot
          key={`v-${pageIndex}-${group.vectorIndex}`}
          rect={boxStyle(group.bbox)}
          selected={selectedVector === group.vectorIndex}
          onSelect={() => onSelect({ pageIndex, kind: "vector", index: group.vectorIndex })}
          onReplace={() => onReplaceVector(pageIndex, group.vectorIndex)}
        />
      ))}

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
          originPatchUrl={originPatchUrl}
          onSelect={() => onSelect({ pageIndex, kind: "text", index: line.lineIndex })}
          onEdit={() => onSelectLine(pageIndex, line)}
          onMoveStart={(e, r) => onMoveStart(
            e,
            {
              kind: "text", pageIndex, index: line.lineIndex,
              label: line.text, direction: line.direction,
              // PDF points -> CSS px, so the ghost's words are the size
              // they are on the page.
              fontSizePx: line.fontSize * scale,
              color: line.color,
            },
            r,
          )}
          // Stays selected through a resize: dropping the selection meant
          // pulling a corner and then having to click the box again to pull
          // another.
          onResize={(fontSize, maxWidth) => onResizeText(pageIndex, line.lineIndex, fontSize, maxWidth)}
        />
      ))}
    </div>
  )
}
