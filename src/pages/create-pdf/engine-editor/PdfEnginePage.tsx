import { useEffect, useRef, useState } from "react"

import { drawRenderedPage, type EnginePage, type EngineTextLine } from "@/lib/pdf-engine"
import type { PageTextState } from "./usePdfEngineDocument"

interface PdfEnginePageProps {
  page: EnginePage
  pageIndex: number
  /** CSS width the page is displayed at; the canvas is rendered at a higher
   * device resolution and scaled down to it. */
  displayWidth: number
  text: PageTextState | undefined
  /** Changes whenever the document is edited, forcing a repaint. */
  revision: number
  renderPage: (pageIndex: number, scale: number) => Promise<{ width: number; height: number; rgba: ArrayBuffer } | null>
  loadPageText: (pageIndex: number) => Promise<void>
  onSelectLine: (pageIndex: number, line: EngineTextLine) => void
}

/**
 * One page: a PDFium-rendered canvas with a clickable box over every
 * editable line of text.
 *
 * The canvas is painted from PDFium's own output — the same engine that
 * writes the downloaded file — so what is on screen is what gets saved.
 * That is the property the previous pdf.js + Canvas + PyMuPDF pipeline
 * could not guarantee, since three separate engines had to agree.
 */
export function PdfEnginePage({
  page, pageIndex, displayWidth, text, revision,
  renderPage, loadPageText, onSelectLine,
}: PdfEnginePageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [painting, setPainting] = useState(false)

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
        // Render above CSS size so the page stays sharp on high-DPI
        // screens, capped so a large monitor can't request an enormous
        // bitmap for every page at once.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const result = await renderPage(pageIndex, scale * dpr)
        if (cancelled || !result || !canvasRef.current) return
        drawRenderedPage(canvasRef.current, result)
      } finally {
        if (!cancelled) setPainting(false)
      }
    }
    void paint()
    return () => { cancelled = true }
  }, [visible, pageIndex, scale, displayWidth, revision, renderPage])

  useEffect(() => {
    if (!visible || text?.loaded) return
    void loadPageText(pageIndex)
  }, [visible, text?.loaded, pageIndex, loadPageText])

  return (
    <div
      ref={containerRef}
      className="relative mx-auto bg-white shadow-sm ring-1 ring-black/10"
      style={{ width: displayWidth, height: displayHeight }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ width: displayWidth, height: displayHeight }}
      />

      {painting && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-black/[0.03]" />
      )}

      {text?.lines.map((line) => {
        // PDF's y axis grows upward from the bottom; CSS grows downward
        // from the top, so the box's top is measured from the page height.
        const left = line.bbox.left * scale
        const top = (page.heightPts - line.bbox.top) * scale
        const width = Math.max(4, (line.bbox.right - line.bbox.left) * scale)
        const height = Math.max(4, (line.bbox.top - line.bbox.bottom) * scale)
        return (
          <button
            key={`${pageIndex}-${line.lineIndex}`}
            type="button"
            onClick={() => onSelectLine(pageIndex, line)}
            title={line.text}
            className="absolute cursor-text rounded-[2px] ring-1 ring-blue-500/30 transition hover:bg-blue-500/10 hover:ring-2 hover:ring-blue-500/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            style={{ left, top, width, height }}
          />
        )
      })}
    </div>
  )
}
