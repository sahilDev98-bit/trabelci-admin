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
  const [isExporting, setIsExporting] = useState(false)

  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImageHotspotId = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  const renderPage = useCallback(async (pageNumber: number) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return

    const bytes = await fetchPdfMasterSessionFile(sessionId)
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = PAPER_TARGET_WIDTH / baseViewport.width
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale: scale * dpr })

      const canvas = canvasRefs.current[pageNumber]
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / dpr}px`
      canvas.style.height = `${viewport.height / dpr}px`

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport }).promise

      setPageStates((prev) => {
        const next = prev.filter((p) => p.page !== pageNumber)
        next.push({ page: pageNumber, cssWidth: viewport.width / dpr, cssHeight: viewport.height / dpr })
        return next.sort((a, b) => a.page - b.page)
      })
    } finally {
      await doc.destroy()
    }
  }, [])

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await startPdfMasterSession(template.id)
        if (cancelled) return
        sessionIdRef.current = result.session_id
        setSession(result)
        setHotspots(Object.fromEntries(result.hotspots.map((h) => [h.id, h])))

        for (const p of result.pages) {
          if (cancelled) break
          await renderPage(p.page)
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
      if (sessionIdRef.current) void closePdfMasterSession(sessionIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted template
  }, [template.id])

  // ── Text editing ─────────────────────────────────────────────────────────────

  function beginEditText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    setEditingHotspotId(hotspot.id)
    setEditingValue(hotspot.text)
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
      await renderPage(hotspot.page)
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
      await renderPage(hotspot.page)
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

      <div className="flex-1" style={{ background: "#EEECE6" }}>
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
              const scale = pageState ? pageState.cssWidth / p.width : PAPER_TARGET_WIDTH / p.width
              const pageHotspots = hotspotList.filter((h) => h.page === p.page)

              return (
                <div key={p.page} className="mx-auto my-6" style={{ width: PAPER_TARGET_WIDTH, maxWidth: "calc(100% - 48px)" }}>
                  <div
                    className="relative mx-auto overflow-hidden rounded-sm bg-white"
                    style={{
                      width: pageState?.cssWidth ?? PAPER_TARGET_WIDTH,
                      height: pageState?.cssHeight,
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
                                background: "#fff",
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
