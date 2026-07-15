import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import * as pdfjsLib from "pdfjs-dist"

import { Button } from "@/components/ui/button"
import { ROUTES } from "@/lib/routes"
import {
  startPdfMasterSession,
  editPdfMasterText,
  editPdfMasterImage,
  fetchPdfMasterSessionFile,
  fetchPdfMasterSessionPage,
  exportPdfMasterSession,
  closePdfMasterSession,
} from "@/features/pdfTemplates/api"
import type { PdfHotspot, PdfSession, PdfTemplate } from "@/features/pdfTemplates/types"

// Vite statically detects this `new URL(..., import.meta.url)` pattern and
// bundles the worker as a proper asset — no ambient module typing needed
// (unlike the `?url` import suffix, which pdfjs-dist's .mjs extension isn't
// covered for by Vite's built-in client types).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

// Same visual language as the HTML-template customizer's slot outlines
const TEXT_OUTLINE = "rgba(59,130,246,0.7)"
const TEXT_OUTLINE_BG = "rgba(59,130,246,0.08)"
const IMAGE_OUTLINE = "rgba(245,158,11,0.8)"
const IMAGE_OUTLINE_BG = "rgba(245,158,11,0.08)"

const PAPER_TARGET_WIDTH = 1000 // CSS px the page renders at before browser scaling

interface PdfMasterCustomizerProps {
  template: PdfTemplate
}

interface PageRenderState {
  page: number
  cssWidth: number
  cssHeight: number
}

// The session response already carries each page's true size in PDF points
// (1 unit = 1/72"), the same unit pdf.js's viewport uses at scale 1 — so
// card sizing doesn't need to wait for pdf.js to parse anything.
function pageSizeToCss(widthPts: number, heightPts: number): { cssWidth: number; cssHeight: number } {
  return {
    cssWidth: PAPER_TARGET_WIDTH,
    cssHeight: heightPts * (PAPER_TARGET_WIDTH / widthPts),
  }
}

function colorIntToCss(color: number): string {
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  return `rgb(${r}, ${g}, ${b})`
}

// Approximates the real page background behind a hotspot by sampling pixels
// already rendered on the page's own canvas, just outside its box — same
// idea as the server's own background-cover logic, done client-side so the
// text-edit box blends into the actual design instead of sitting on a flat
// white/black box, with zero extra network calls (the pixels are already on
// screen).
function sampleBackgroundColor(
  canvas: HTMLCanvasElement,
  bbox: readonly [number, number, number, number],
  pageWidthPts: number,
): string {
  const ctx = canvas.getContext("2d")
  if (!ctx || canvas.width === 0) return "#ffffff"

  const pxPerPoint = canvas.width / pageWidthPts
  const [x0, y0, x1, y1] = bbox
  const pad = 4
  const points: [number, number][] = []
  const steps = 6
  for (let i = 0; i <= steps; i++) {
    const fx = x0 + ((x1 - x0) * i) / steps
    points.push([fx, y0 - pad], [fx, y1 + pad])
  }
  points.push([x0 - pad, (y0 + y1) / 2], [x1 + pad, (y0 + y1) / 2])

  const counts = new Map<string, number>()
  for (const [px, py] of points) {
    const ix = Math.min(canvas.width - 1, Math.max(0, Math.round(px * pxPerPoint)))
    const iy = Math.min(canvas.height - 1, Math.max(0, Math.round(py * pxPerPoint)))
    try {
      const [r, g, b] = ctx.getImageData(ix, iy, 1, 1).data
      const key = `${r},${g},${b}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    } catch {
      // out-of-bounds or tainted canvas — skip this sample point
    }
  }
  if (counts.size === 0) return "#ffffff"
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return `rgb(${best[0]})`
}

export function PdfMasterCustomizer({ template }: PdfMasterCustomizerProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [session, setSession] = useState<PdfSession | null>(null)
  const [hotspots, setHotspots] = useState<Record<string, PdfHotspot>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageStates, setPageStates] = useState<PageRenderState[]>([])
  const [busyHotspotId, setBusyHotspotId] = useState<string | null>(null)
  const [editingHotspotId, setEditingHotspotId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState("")
  const [editingBackground, setEditingBackground] = useState("#ffffff")
  const [isExporting, setIsExporting] = useState(false)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImageHotspotId = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionStartedRef = useRef(false)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  // The parsed working copy. The PDF is downloaded and parsed ONCE per
  // version (initial load + once after each edit) and every page renders from
  // this shared document — re-downloading the full multi-MB file per page is
  // what originally made large catalogs take minutes to open.
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  /** Download the current working copy once and (re)parse it. */
  const reloadDocument = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const bytes = await fetchPdfMasterSessionFile(sessionId)
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    const old = pdfDocRef.current
    pdfDocRef.current = doc
    if (old) void old.destroy()
  }, [])

  /** Paint a parsed pdf.js page onto the target page number's canvas. */
  const drawPageToCanvas = useCallback(async (page: pdfjsLib.PDFPageProxy, targetPageNumber: number) => {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = PAPER_TARGET_WIDTH / baseViewport.width
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    const canvas = canvasRefs.current[targetPageNumber]
    if (!canvas) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    await page.render({ canvasContext: ctx, viewport }).promise

    setPageStates((prev) => {
      const next = prev.filter((p) => p.page !== targetPageNumber)
      next.push({ page: targetPageNumber, cssWidth: viewport.width / dpr, cssHeight: viewport.height / dpr })
      return next.sort((a, b) => a.page - b.page)
    })
  }, [])

  /** Render one page from the already-parsed full document (initial load only). */
  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = pdfDocRef.current
    if (!doc) return
    const page = await doc.getPage(pageNumber)
    await drawPageToCanvas(page, pageNumber)
  }, [drawPageToCanvas])

  /**
   * After an edit: fetch ONLY the edited page (sliced server-side into its
   * own tiny PDF) and repaint just that one canvas — not the whole document.
   * Re-downloading and re-parsing the full working copy per edit was the
   * exact reason edits felt slow on large catalogs.
   */
  const refreshPageAfterEdit = useCallback(async (pageNumber: number) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const bytes = await fetchPdfMasterSessionPage(sessionId, pageNumber)
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    try {
      const page = await doc.getPage(1) // the slice always has exactly one page
      await drawPageToCanvas(page, pageNumber)
    } finally {
      await doc.destroy()
    }
  }, [drawPageToCanvas])

  // ── Initial load ────────────────────────────────────────────────────────────
  //
  // sessionStartedRef (not state) is what makes this StrictMode-safe: dev mode
  // intentionally invokes this effect twice (mount → cleanup → mount) to
  // surface missing cleanup. A `cancelled` flag alone doesn't help here — the
  // *server-side work itself* (opening a session, extracting hotspots) is
  // expensive, so the fix is to guarantee it only ever starts once per
  // component lifetime, not to discard a second run's results. The component
  // is remounted fresh (see `key={template.id}` where this is rendered) if
  // the template actually changes, which resets this ref naturally.
  useEffect(() => {
    if (sessionStartedRef.current) return
    sessionStartedRef.current = true

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await startPdfMasterSession(template.id)
        sessionIdRef.current = result.session_id
        setHotspots(Object.fromEntries(result.hotspots.map((h) => [h.id, h])))

        // One download + one parse for the whole document
        await reloadDocument()

        // Pre-size every page card from the session's own PDF-point
        // dimensions — cards mount at their correct final height immediately,
        // no waiting for pdf.js to render anything first (that ordering bug
        // is exactly what left pages blank/collapsed before this fix: the
        // old code tried to paint onto canvases in this same async function,
        // before React had ever mounted them — every draw silently no-opped).
        setPageStates(result.pages.map((p) => ({ page: p.page, ...pageSizeToCss(p.width, p.height) })))

        // Setting `session` last is what triggers the paint effect below,
        // and only after this render commits are the <canvas> elements for
        // each page actually in the DOM for it to draw into.
        setSession(result)
      } catch (err) {
        console.error(err)
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
      }
    }

    void load()

    return () => {
      if (sessionIdRef.current) void closePdfMasterSession(sessionIdRef.current)
      if (pdfDocRef.current) {
        void pdfDocRef.current.destroy()
        pdfDocRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted template
  }, [template.id])

  // ── Paint pages once their canvases actually exist ──────────────────────────
  //
  // Runs after the effect above sets `session`, which is what makes the page
  // cards (and their <canvas> refs) mount. Effects always run after React has
  // committed the DOM, so canvasRefs are guaranteed populated here — unlike
  // the old code, which tried to paint inside the same async load() call,
  // before isLoading ever flipped false and the cards existed at all.
  useEffect(() => {
    if (!session) return
    void Promise.all(
      session.pages.map((p) =>
        renderPage(p.page).catch((err) => console.error(`Failed to render page ${p.page}`, err)),
      ),
    )
  }, [session, renderPage])

  // ── Responsive scaling ───────────────────────────────────────────────────────
  //
  // Pages render at a fixed native resolution (PAPER_TARGET_WIDTH) for crisp
  // canvas output, then get shrunk to fit narrower viewports via a CSS
  // transform on the whole "paper" (canvas + hotspot overlays together, so
  // they always stay pixel-aligned) — no re-render, no extra network/CPU
  // cost. Never scales up past native resolution (would blur).
  useEffect(() => {
    const el = pagesContainerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setContainerWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Text editing ─────────────────────────────────────────────────────────────

  function beginEditText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    const canvas = canvasRefs.current[hotspot.page]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const bg = canvas && pageInfo ? sampleBackgroundColor(canvas, hotspot.bbox, pageInfo.width) : "#ffffff"
    setEditingHotspotId(hotspot.id)
    setEditingValue(hotspot.text)
    setEditingBackground(bg)
  }

  async function commitEditText() {
    const hotspot = editingHotspotId ? hotspots[editingHotspotId] : null
    setEditingHotspotId(null)
    if (!hotspot || hotspot.type !== "text" || !session) return

    const newText = editingValue
    if (newText === hotspot.text) return

    setBusyHotspotId(hotspot.id)
    try {
      await editPdfMasterText(session.session_id, hotspot.id, newText)
      setHotspots((prev) => ({ ...prev, [hotspot.id]: { ...hotspot, text: newText } }))
      await refreshPageAfterEdit(hotspot.page)
    } catch (err) {
      console.error(err)
      toast.error(t("pdfTemplates.masterEditFailed"))
    } finally {
      setBusyHotspotId(null)
    }
  }

  // ── Image editing ────────────────────────────────────────────────────────────

  function beginEditImage(hotspot: PdfHotspot) {
    if (hotspot.type !== "image" || busyHotspotId) return
    pendingImageHotspotId.current = hotspot.id
    fileInputRef.current?.click()
  }

  async function onImageFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const hotspotId = pendingImageHotspotId.current
    e.target.value = ""
    pendingImageHotspotId.current = null
    if (!file || !hotspotId || !session) return
    const hotspot = hotspots[hotspotId]
    if (!hotspot) return

    setBusyHotspotId(hotspotId)
    try {
      await editPdfMasterImage(session.session_id, hotspotId, file)
      await refreshPageAfterEdit(hotspot.page)
      toast.success(t("pdfTemplates.masterImageReplaced"))
    } catch (err) {
      console.error(err)
      toast.error(t("pdfTemplates.masterEditFailed"))
    } finally {
      setBusyHotspotId(null)
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!session) return
    setIsExporting(true)
    try {
      const blob = await exportPdfMasterSession(session.session_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${template.name}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t("pdfTemplates.pdfDownloaded"))
    } catch (err) {
      console.error(err)
      toast.error(t("common.error"))
    } finally {
      setIsExporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const hotspotList = Object.values(hotspots)

  return (
    <div className="-m-6 flex flex-col" style={{ minHeight: "calc(100vh - 57px)" }}>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onImageFileSelected(e)} />

      <header className="sticky z-20 flex items-center gap-3 border-b bg-background/90 px-5 py-3 backdrop-blur-md" style={{ top: 57 }}>
        <button
          type="button"
          onClick={() => void navigate({ to: ROUTES.CREATE_PDF })}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          <span>{t("common.back")}</span>
        </button>
        <span className="select-none text-muted-foreground/40">/</span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{template.name}</span>
        {hotspotList.length > 0 && (
          <span className="hidden shrink-0 rounded-full border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
            {hotspotList.length} {t("pdfTemplates.editableSlots").toLowerCase()}
          </span>
        )}
        <Button onClick={() => void handleDownload()} disabled={isExporting || isLoading || !session} size="sm" className="ml-auto shrink-0 gap-1.5 rounded-full px-5">
          {isExporting ? <Loader2Icon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
          {isExporting ? t("pdfTemplates.generating") : t("pdfTemplates.downloadPdf")}
        </Button>
      </header>

      <div ref={pagesContainerRef} className="flex-1 overflow-x-hidden" style={{ background: "#EEECE6" }}>
        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("pdfTemplates.masterLoading")}</p>
          </div>
        )}

        {!isLoading && loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm text-destructive">{t("common.error")}</p>
            <p className="max-w-md text-xs text-muted-foreground">{loadError}</p>
          </div>
        )}

        {!isLoading && !loadError && (
          <>
            <p className="pt-4 text-center text-[11px] text-stone-400">{t("pdfTemplates.slotLegend")}</p>

            {session?.pages.map((p) => {
              const pageState = pageStates.find((ps) => ps.page === p.page)
              // Hotspot positions stay in this "natural" (unscaled,
              // PAPER_TARGET_WIDTH-wide) coordinate space — the whole
              // subtree (canvas + overlays) is shrunk together below via a
              // single CSS transform, so this math never needs to change.
              const scale = pageState ? pageState.cssWidth / p.width : PAPER_TARGET_WIDTH / p.width
              const pageHotspots = hotspotList.filter((h) => h.page === p.page)

              const naturalWidth = pageState?.cssWidth ?? PAPER_TARGET_WIDTH
              const naturalHeight = pageState?.cssHeight ?? naturalWidth * (p.height / p.width)
              // Never upscale past native raster resolution (would blur) —
              // only ever shrink to fit narrower viewports.
              const displayScale = containerWidth ? Math.min(1, (containerWidth - 48) / naturalWidth) : 1

              return (
                <div
                  key={p.page}
                  className="mx-auto my-6"
                  style={{ width: naturalWidth * displayScale, height: naturalHeight * displayScale }}
                >
                  <div
                    className="relative overflow-hidden rounded-sm bg-white"
                    style={{
                      width: naturalWidth,
                      height: naturalHeight,
                      transform: `scale(${displayScale})`,
                      transformOrigin: "top left",
                      boxShadow: "0 1px 2px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.08), 0 20px 40px rgba(0,0,0,.1)",
                    }}
                  >
                    <canvas
                      ref={(el) => { canvasRefs.current[p.page] = el }}
                      className="block"
                    />

                    {pageHotspots.map((h) => {
                      const left = h.bbox[0] * scale
                      const top = h.bbox[1] * scale
                      const width = (h.bbox[2] - h.bbox[0]) * scale
                      const height = (h.bbox[3] - h.bbox[1]) * scale
                      const isText = h.type === "text"
                      const isBusy = busyHotspotId === h.id
                      const isEditing = editingHotspotId === h.id

                      return (
                        <div
                          key={h.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => (isText ? beginEditText(h) : beginEditImage(h))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              if (isText) beginEditText(h)
                              else beginEditImage(h)
                            }
                          }}
                          style={{
                            position: "absolute",
                            left,
                            top,
                            width,
                            height,
                            cursor: isBusy ? "wait" : "pointer",
                            border: `1.5px dashed ${isText ? TEXT_OUTLINE : IMAGE_OUTLINE}`,
                            background: isEditing ? "transparent" : isText ? TEXT_OUTLINE_BG : IMAGE_OUTLINE_BG,
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isBusy && <Loader2Icon className="size-4 animate-spin text-white drop-shadow" />}
                          {!isBusy && !isText && !isEditing && (
                            <UploadIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-70" style={{ color: IMAGE_OUTLINE }} />
                          )}
                          {isText && isEditing && (
                            <textarea
                              autoFocus
                              dir={h.rtl ? "rtl" : "ltr"}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => void commitEditText()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault()
                                  void commitEditText()
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  setEditingHotspotId(null)
                                }
                              }}
                              style={{
                                width: "100%",
                                height: "100%",
                                resize: "none",
                                border: "none",
                                outline: "none",
                                // Sampled from the real page pixels around this
                                // hotspot (see beginEditText) instead of a fixed
                                // white/black box, so editing feels like it's
                                // happening on the actual design, not a form
                                // field pasted on top of it.
                                background: editingBackground,
                                color: colorIntToCss(h.color),
                                fontSize: Math.max(10, h.size * scale * 0.92),
                                textAlign: h.rtl ? "right" : "left",
                                padding: 2,
                              }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}

        <div className="h-12" />
      </div>
    </div>
  )
}
