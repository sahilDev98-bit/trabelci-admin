import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, CopyIcon, DownloadIcon, Loader2Icon, Trash2Icon, UploadIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import * as pdfjsLib from "pdfjs-dist"

import { Button } from "@/components/ui/button"
import { ROUTES } from "@/lib/routes"
import {
  startPdfMasterSession,
  fetchPdfMasterSessionJobStatus,
  fetchPdfMasterSessionFile,
  applyPdfMasterEditsAndExport,
  closePdfMasterSession,
} from "@/features/pdfTemplates/api"
import type { PdfMasterPagePlanEntry, PdfMasterPendingEdit } from "@/features/pdfTemplates/api"
import type { EditorPage, PdfHotspot, PdfSession, PdfTemplate } from "@/features/pdfTemplates/types"

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

// Analysis of a large, image-heavy catalog can legitimately take minutes —
// far longer than Cloudflare's ~100s ceiling for a single response. So the
// backend only starts the job and returns immediately; this polls a
// lightweight status endpoint instead of one long-held request.
const JOB_POLL_INTERVAL_MS = 2_000
const JOB_POLL_TIMEOUT_MS = 10 * 60 * 1000 // generous ceiling for a very heavy catalog

// Separator between an editor page's clientId and a hotspot's original id —
// see PdfHotspotBase.id. Chosen over ":" since generated ids (crypto
// randomUUID, server-issued hotspot ids like "p1-t1") never contain it.
const ID_NAMESPACE_SEP = "::"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForSessionJob(jobId: string): Promise<Omit<PdfSession, "templateId" | "templateName">> {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS
  while (true) {
    const status = await fetchPdfMasterSessionJobStatus(jobId)
    if (status.status === "done") return status.result
    if (status.status === "failed") throw new Error(status.error)
    if (Date.now() > deadline) throw new Error("PDF analysis is taking too long — try a smaller file")
    await sleep(JOB_POLL_INTERVAL_MS)
  }
}

interface PdfMasterCustomizerProps {
  template: PdfTemplate
}

interface PageRenderState {
  /** An editor page's clientId — NOT a raw page number, since page order/
   * count can now change (duplicate/remove) after the initial analysis. */
  page: string
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

/** Which editor page (clientId) a namespaced hotspot id/hotspot belongs to. */
function ownerClientId(namespacedId: string): string {
  return namespacedId.split(ID_NAMESPACE_SEP)[0]
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
  // Further out than the element's own edge (clears rounded corners/thin
  // borders sitting right at the boundary) and sampled around the FULL
  // perimeter, not just the top/bottom edges with a single point on each
  // side — a lone side-point on a large element can land on something else
  // entirely and still "win" the majority vote if it's the only side sample.
  const pad = 10
  const steps = 12
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const fx = x0 + ((x1 - x0) * i) / steps
    points.push([fx, y0 - pad], [fx, y1 + pad])
  }
  for (let i = 0; i <= steps; i++) {
    const fy = y0 + ((y1 - y0) * i) / steps
    points.push([x0 - pad, fy], [x1 + pad, fy])
  }

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

// For removing an image entirely (as opposed to covering a line of text
// before writing new text over it): sampling right around the removed
// element — even across its full perimeter — can still pick up a shadow,
// gradient, or antialiasing from the element's own rounded corners instead
// of the true page background. The page's own corners are virtually always
// genuine, unobstructed background for this kind of flat-background design,
// completely independent of whatever shape used to sit near the removed
// image, so they're a far more reliable source for "what should this blank
// space look like" than anything sampled locally.
function samplePageBackgroundColor(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d")
  if (!ctx || canvas.width === 0 || canvas.height === 0) return "#ffffff"

  const inset = 6
  const corners: [number, number][] = [
    [inset, inset],
    [canvas.width - inset, inset],
    [inset, canvas.height - inset],
    [canvas.width - inset, canvas.height - inset],
  ]

  const counts = new Map<string, number>()
  for (const [cx, cy] of corners) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const ix = Math.min(canvas.width - 1, Math.max(0, cx + dx))
        const iy = Math.min(canvas.height - 1, Math.max(0, cy + dy))
        try {
          const [r, g, b] = ctx.getImageData(ix, iy, 1, 1).data
          const key = `${r},${g},${b}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        } catch {
          // tainted canvas — skip this sample point
        }
      }
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
  // Current arrangement of pages in the editor — distinct from
  // session.pages (the fixed, one-time analysis result). This is what
  // actually drives display order/composition once pages can be
  // duplicated/removed. See EditorPage.
  const [editorPages, setEditorPages] = useState<EditorPage[]>([])
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
  // Hotspots cleared via their "✕" (or committed to empty text) — the
  // overlay's border/tint/remove-button are what actually made a cleared
  // area still look like an occupied box, so this drives hiding them,
  // making the area behave like genuinely empty space. State, not a ref,
  // since it has to trigger a re-render of the overlay itself.
  const [removedHotspotIds, setRemovedHotspotIds] = useState<Set<string>>(new Set())

  // Keyed by editor page clientId (not a raw page number) — a duplicated
  // page needs its own independent canvas even though it started as a copy
  // of another page's content.
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingImageHotspotId = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionStartedRef = useRef(false)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  // The parsed original PDF, downloaded and parsed exactly once (initial
  // load). Every ORIGINAL page renders from this shared document; edits,
  // and duplicated pages, are drawn straight onto each page's own canvas
  // (see drawTextEditOnCanvas/drawImageEditOnCanvas/duplicatePage) and never
  // touch this again.
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  // Guards against committing the same text edit twice: pressing Enter (or
  // Escape) unmounts the still-focused textarea, and a focused element being
  // removed from the DOM fires a native blur on its way out — which would
  // otherwise re-invoke the onBlur handler a second time, against a stale
  // snapshot of state from before the first commit. Reset per edit in
  // beginEditText; the ref itself (unlike the state it guards) is the same
  // mutable object across both the fresh and the stale closure, which is
  // exactly what makes it work as a guard here.
  const commitInFlightRef = useRef(false)
  // Every clientId that has already had its canvas painted at least once
  // (either from the original PDF via pdf.js, or as a duplicate's pixel
  // copy) — the paint-pages effect only ever touches a clientId once,
  // otherwise re-painting would wipe out any edits already drawn on it.
  const renderedClientIdsRef = useRef<Set<string>>(new Set())
  // A duplicated page's snapshot, captured synchronously from its source
  // canvas at the moment of duplication, waiting for its own canvas to
  // exist in the DOM so it can be painted onto it (see the bitmap-paint
  // effect below).
  const pendingPageBitmapRef = useRef<Record<string, ImageBitmap>>({})

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

  /** Paint a parsed pdf.js page onto an editor page's canvas. */
  const drawPageToCanvas = useCallback(async (page: pdfjsLib.PDFPageProxy, clientId: string) => {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = PAPER_TARGET_WIDTH / baseViewport.width
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    const canvas = canvasRefs.current[clientId]
    if (!canvas) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    await page.render({ canvasContext: ctx, viewport }).promise

    setPageStates((prev) => {
      const next = prev.filter((p) => p.page !== clientId)
      next.push({ page: clientId, cssWidth: viewport.width / dpr, cssHeight: viewport.height / dpr })
      return next
    })
  }, [])

  /** Render one ORIGINAL page from the already-parsed document onto the given editor page's canvas. */
  const renderPage = useCallback(async (originalPageNumber: number, clientId: string) => {
    const doc = pdfDocRef.current
    if (!doc) return
    const page = await doc.getPage(originalPageNumber)
    await drawPageToCanvas(page, clientId)
  }, [drawPageToCanvas])

  /**
   * Pending edits, keyed by (namespaced) hotspot id — the entire reason this
   * exists is to avoid calling the server per edit. Every text/image change
   * is drawn straight onto the canvas below and just remembered here; the
   * server only ever sees this list once, in one batch, at Download time. A
   * ref (not state) because writes here don't need to trigger a re-render —
   * the canvas draw is what actually updates what the user sees.
   */
  const pendingEditsRef = useRef<Record<string, PdfMasterPendingEdit>>({})

  /**
   * Draw a text edit directly onto the page's canvas — no network call.
   * Mirrors the server's own approach (cover the old line, draw the new one
   * on top) so it looks right immediately. The server redoes this exactly
   * once, with the PDF's real embedded fonts, when Download is clicked —
   * this preview uses the browser's own font rendering instead, which can
   * differ very slightly from the final file (spacing/kerning), but keeps
   * every edit instant instead of round-tripping to the server for each one.
   */
  const drawTextEditOnCanvas = useCallback((hotspot: PdfHotspot, newText: string, backgroundColor: string) => {
    if (hotspot.type !== "text") return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const ctx = canvas?.getContext("2d")
    if (!canvas || !pageInfo || !ctx) return

    const pxPerPoint = canvas.width / pageInfo.width
    const [x0, y0, x1, y1] = hotspot.bbox
    const pad = 1.5 * pxPerPoint

    // Cover the old line (same padding the server uses around the bbox)
    ctx.fillStyle = backgroundColor
    ctx.fillRect(x0 * pxPerPoint - pad, y0 * pxPerPoint - pad, (x1 - x0) * pxPerPoint + pad * 2, (y1 - y0) * pxPerPoint + pad * 2)

    const trimmed = newText.trim()
    if (!trimmed) return

    const fontSizePx = hotspot.size * pxPerPoint
    const isBold = hotspot.font.toLowerCase().includes("bold")
    ctx.font = `${isBold ? "bold " : ""}${fontSizePx}px system-ui, sans-serif`
    ctx.fillStyle = colorIntToCss(hotspot.color)
    ctx.direction = hotspot.rtl ? "rtl" : "ltr"
    ctx.textAlign = hotspot.rtl ? "right" : "left"
    ctx.textBaseline = "alphabetic"

    // No baseline info reaches the frontend (see PdfTextHotspot) — same
    // fallback the server itself uses when it's missing.
    const originY = y1 - hotspot.size * 0.2
    const x = (hotspot.rtl ? x1 : x0) * pxPerPoint
    ctx.fillText(trimmed, x, originY * pxPerPoint)
  }, [session])

  /** Draw a replacement image directly onto the page's canvas — no network call. */
  const drawImageEditOnCanvas = useCallback(async (hotspot: PdfHotspot, file: File) => {
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const ctx = canvas?.getContext("2d")
    if (!canvas || !pageInfo || !ctx) return

    const bitmap = await createImageBitmap(file)
    try {
      const pxPerPoint = canvas.width / pageInfo.width
      const [x0, y0, x1, y1] = hotspot.bbox
      ctx.drawImage(bitmap, x0 * pxPerPoint, y0 * pxPerPoint, (x1 - x0) * pxPerPoint, (y1 - y0) * pxPerPoint)
    } finally {
      bitmap.close()
    }
  }, [session])

  /** Cover an image hotspot with the page's own background — leaves blank
   * space, no network call. Uses samplePageBackgroundColor (the page's
   * corners), not the local edge-sampling used for text — an image being
   * removed is often large with its own rounded corners/shadow, which local
   * sampling can pick up instead of the true background. */
  const drawImageRemovalOnCanvas = useCallback((hotspot: PdfHotspot) => {
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const ctx = canvas?.getContext("2d")
    if (!canvas || !pageInfo || !ctx) return

    const bg = samplePageBackgroundColor(canvas)
    const pxPerPoint = canvas.width / pageInfo.width
    const [x0, y0, x1, y1] = hotspot.bbox
    const pad = 1.5 * pxPerPoint
    ctx.fillStyle = bg
    ctx.fillRect(x0 * pxPerPoint - pad, y0 * pxPerPoint - pad, (x1 - x0) * pxPerPoint + pad * 2, (y1 - y0) * pxPerPoint + pad * 2)
  }, [session])

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
        const jobStart = await startPdfMasterSession(template.id)
        const jobResult = await waitForSessionJob(jobStart.jobId)
        const result: PdfSession = {
          ...jobResult,
          templateId: jobStart.templateId,
          templateName: jobStart.templateName,
        }
        sessionIdRef.current = result.session_id

        const pages: EditorPage[] = result.pages.map((p) => ({
          clientId: crypto.randomUUID(),
          originalPage: p.page,
          width: p.width,
          height: p.height,
        }))
        const pageByOriginal = new Map(pages.map((p) => [p.originalPage, p]))

        const namespacedHotspots: Record<string, PdfHotspot> = {}
        for (const h of result.hotspots) {
          const owner = pageByOriginal.get(h.page)
          if (!owner) continue
          const id = `${owner.clientId}${ID_NAMESPACE_SEP}${h.id}`
          namespacedHotspots[id] = { ...h, id, originalId: h.id }
        }
        setHotspots(namespacedHotspots)
        setEditorPages(pages)

        // One download + one parse for the whole document
        await reloadDocument()

        // Pre-size every page card from the session's own PDF-point
        // dimensions — cards mount at their correct final height immediately,
        // no waiting for pdf.js to render anything first (that ordering bug
        // is exactly what left pages blank/collapsed before this fix: the
        // old code tried to paint onto canvases in this same async function,
        // before React had ever mounted them — every draw silently no-opped).
        setPageStates(pages.map((p) => ({ page: p.clientId, ...pageSizeToCss(p.width, p.height) })))

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
  // Runs after the effect above sets `session` (initial mount), and again
  // whenever a page is added — but only ever paints a clientId ONCE
  // (renderedClientIdsRef), since re-running drawPageToCanvas on a page that
  // already has edits drawn on it would wipe them out (setting canvas.width/
  // height clears the canvas). Duplicated pages are excluded here entirely —
  // they're painted by the bitmap-copy effect below instead of via pdf.js.
  useEffect(() => {
    if (!session) return
    const toRender = editorPages.filter(
      (p) => !renderedClientIdsRef.current.has(p.clientId) && !pendingPageBitmapRef.current[p.clientId],
    )
    if (toRender.length === 0) return
    void Promise.all(
      toRender.map(async (p) => {
        renderedClientIdsRef.current.add(p.clientId)
        try {
          await renderPage(p.originalPage, p.clientId)
        } catch (err) {
          console.error(`Failed to render page ${p.clientId}`, err)
        }
      }),
    )
  }, [session, editorPages, renderPage])

  // ── Paint duplicated pages from their captured snapshot ─────────────────────
  //
  // duplicatePage captures a bitmap of the source page's CURRENT pixels
  // (including any edits already drawn) before the new page's canvas even
  // exists in the DOM. This runs once that canvas has mounted and paints it.
  useEffect(() => {
    for (const p of editorPages) {
      const bitmap = pendingPageBitmapRef.current[p.clientId]
      if (!bitmap) continue
      const canvas = canvasRefs.current[p.clientId]
      if (!canvas) continue
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext("2d")
      ctx?.drawImage(bitmap, 0, 0)
      bitmap.close()
      delete pendingPageBitmapRef.current[p.clientId]
    }
  }, [editorPages])

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

  // ── Page management (duplicate / remove) ────────────────────────────────────

  async function duplicatePage(sourcePage: EditorPage) {
    const sourceCanvas = canvasRefs.current[sourcePage.clientId]
    if (!sourceCanvas) return

    // Snapshot the source's CURRENT pixels now (includes any edits already
    // made) — independent of whatever happens to the source canvas later.
    const bitmap = await createImageBitmap(sourceCanvas)
    const newClientId = crypto.randomUUID()
    renderedClientIdsRef.current.add(newClientId) // never rendered via pdf.js — the bitmap effect handles it
    pendingPageBitmapRef.current[newClientId] = bitmap

    const clonedHotspots: Record<string, PdfHotspot> = {}
    const clonedEdits: Record<string, PdfMasterPendingEdit> = {}
    const clonedRemovedIds: string[] = []
    for (const h of Object.values(hotspots)) {
      if (ownerClientId(h.id) !== sourcePage.clientId) continue
      const newId = `${newClientId}${ID_NAMESPACE_SEP}${h.originalId}`
      clonedHotspots[newId] = { ...h, id: newId }
      const existingEdit = pendingEditsRef.current[h.id]
      if (existingEdit) clonedEdits[newId] = { ...existingEdit, hotspotId: newId }
      if (removedHotspotIds.has(h.id)) clonedRemovedIds.push(newId)
    }
    if (Object.keys(clonedHotspots).length > 0) {
      setHotspots((prev) => ({ ...prev, ...clonedHotspots }))
    }
    Object.assign(pendingEditsRef.current, clonedEdits)
    if (clonedRemovedIds.length > 0) {
      setRemovedHotspotIds((prev) => new Set([...prev, ...clonedRemovedIds]))
    }

    const newPage: EditorPage = {
      clientId: newClientId,
      originalPage: sourcePage.originalPage,
      width: sourcePage.width,
      height: sourcePage.height,
    }
    setEditorPages((prev) => {
      const idx = prev.findIndex((p) => p.clientId === sourcePage.clientId)
      const next = [...prev]
      next.splice(idx + 1, 0, newPage)
      return next
    })
    setPageStates((prev) => {
      const src = prev.find((p) => p.page === sourcePage.clientId)
      if (!src) return prev
      return [...prev, { page: newClientId, cssWidth: src.cssWidth, cssHeight: src.cssHeight }]
    })
    toast.success(t("pdfTemplates.pageDuplicated"))
  }

  function removePage(pageToRemove: EditorPage) {
    if (editorPages.length <= 1) {
      toast.error(t("pdfTemplates.cannotRemoveLastPage"))
      return
    }
    setEditorPages((prev) => prev.filter((p) => p.clientId !== pageToRemove.clientId))
    setHotspots((prev) => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (ownerClientId(id) === pageToRemove.clientId) delete next[id]
      }
      return next
    })
    setRemovedHotspotIds((prev) => {
      const next = new Set(prev)
      for (const id of next) {
        if (ownerClientId(id) === pageToRemove.clientId) next.delete(id)
      }
      return next
    })
    for (const id of Object.keys(pendingEditsRef.current)) {
      if (ownerClientId(id) === pageToRemove.clientId) delete pendingEditsRef.current[id]
    }
    delete canvasRefs.current[pageToRemove.clientId]
    renderedClientIdsRef.current.delete(pageToRemove.clientId)
    delete pendingPageBitmapRef.current[pageToRemove.clientId]
    setPageStates((prev) => prev.filter((p) => p.page !== pageToRemove.clientId))
    if (editingHotspotId && ownerClientId(editingHotspotId) === pageToRemove.clientId) {
      setEditingHotspotId(null)
    }
    toast.success(t("pdfTemplates.pageRemoved"))
  }

  // ── Text editing ─────────────────────────────────────────────────────────────

  function beginEditText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const bg = canvas && pageInfo ? sampleBackgroundColor(canvas, hotspot.bbox, pageInfo.width) : "#ffffff"
    commitInFlightRef.current = false // re-arm the guard for this new edit
    setEditingHotspotId(hotspot.id)
    setEditingValue(hotspot.text)
    setEditingBackground(bg)
  }

  /** Marks whether a hotspot is currently "empty" (removed text/image) —
   * drives hiding its overlay border/tint/buttons so it reads as genuinely
   * blank space rather than a still-outlined box. */
  function markHotspotRemoved(id: string, removed: boolean) {
    setRemovedHotspotIds((prev) => {
      if (prev.has(id) === removed) return prev
      const next = new Set(prev)
      if (removed) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function commitEditText() {
    // See commitInFlightRef's declaration: Enter/Escape unmount this
    // still-focused textarea, which fires a second, stale onBlur — this
    // makes that second call a no-op instead of re-processing old state.
    if (commitInFlightRef.current) return
    commitInFlightRef.current = true

    const hotspot = editingHotspotId ? hotspots[editingHotspotId] : null
    setEditingHotspotId(null)
    if (!hotspot || hotspot.type !== "text" || !session) return

    const newText = editingValue
    if (newText === hotspot.text) return

    // No server round-trip — just draw it and remember it for Download.
    drawTextEditOnCanvas(hotspot, newText, editingBackground)
    pendingEditsRef.current[hotspot.id] = {
      hotspotId: hotspot.id,
      originalHotspotId: hotspot.originalId,
      type: "text",
      value: newText,
    }
    setHotspots((prev) => ({ ...prev, [hotspot.id]: { ...hotspot, text: newText } }))
    markHotspotRemoved(hotspot.id, newText.trim() === "")
  }

  /** Clear a text hotspot straight from its "✕" button — same result as
   * opening it, deleting everything, and committing, without the detour. */
  function removeText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const bg = canvas && pageInfo ? sampleBackgroundColor(canvas, hotspot.bbox, pageInfo.width) : "#ffffff"

    drawTextEditOnCanvas(hotspot, "", bg)
    pendingEditsRef.current[hotspot.id] = {
      hotspotId: hotspot.id,
      originalHotspotId: hotspot.originalId,
      type: "text",
      value: "",
    }
    setHotspots((prev) => ({ ...prev, [hotspot.id]: { ...hotspot, text: "" } }))
    markHotspotRemoved(hotspot.id, true)
    toast.success(t("pdfTemplates.masterTextRemoved"))
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
      // No server round-trip — just draw it and remember it for Download.
      await drawImageEditOnCanvas(hotspot, file)
      pendingEditsRef.current[hotspotId] = {
        hotspotId,
        originalHotspotId: hotspot.originalId,
        type: "image",
        file,
      }
      toast.success(t("pdfTemplates.masterImageReplaced"))
    } catch (err) {
      console.error(err)
      toast.error(t("pdfTemplates.masterEditFailed"))
    } finally {
      setBusyHotspotId(null)
    }
  }

  function removeImage(hotspot: PdfHotspot) {
    if (hotspot.type !== "image" || busyHotspotId) return
    drawImageRemovalOnCanvas(hotspot)
    pendingEditsRef.current[hotspot.id] = {
      hotspotId: hotspot.id,
      originalHotspotId: hotspot.originalId,
      type: "image",
      remove: true,
    }
    markHotspotRemoved(hotspot.id, true)
    toast.success(t("pdfTemplates.masterImageRemoved"))
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  async function handleDownload() {
    if (!session) return
    setIsExporting(true)
    try {
      // The only point the server's copy of the document is touched — every
      // edit and page change up to now only ever changed canvases in this
      // browser tab. Pages the user removed simply aren't in editorPages
      // anymore, so they're naturally excluded here too.
      const pagePlan: PdfMasterPagePlanEntry[] = editorPages.map((p) => ({
        originalPage: p.originalPage,
        edits: Object.values(pendingEditsRef.current).filter((e) => ownerClientId(e.hotspotId) === p.clientId),
      }))
      const blob = await applyPdfMasterEditsAndExport(session.session_id, pagePlan)
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
      toast.error(err instanceof Error ? err.message : t("common.error"))
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

            {editorPages.map((ep) => {
              const pageState = pageStates.find((ps) => ps.page === ep.clientId)
              // Hotspot positions stay in this "natural" (unscaled,
              // PAPER_TARGET_WIDTH-wide) coordinate space — the whole
              // subtree (canvas + overlays) is shrunk together below via a
              // single CSS transform, so this math never needs to change.
              const scale = pageState ? pageState.cssWidth / ep.width : PAPER_TARGET_WIDTH / ep.width
              const pageHotspots = hotspotList.filter((h) => ownerClientId(h.id) === ep.clientId)

              const naturalWidth = pageState?.cssWidth ?? PAPER_TARGET_WIDTH
              const naturalHeight = pageState?.cssHeight ?? naturalWidth * (ep.height / ep.width)
              // Never upscale past native raster resolution (would blur) —
              // only ever shrink to fit narrower viewports.
              const displayScale = containerWidth ? Math.min(1, (containerWidth - 48) / naturalWidth) : 1

              return (
                <div
                  key={ep.clientId}
                  className="relative mx-auto my-6"
                  style={{ width: naturalWidth * displayScale, height: naturalHeight * displayScale }}
                >
                  <div className="absolute -top-3 right-0 z-10 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void duplicatePage(ep)}
                      title={t("pdfTemplates.duplicatePage")}
                      className="flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                    >
                      <CopyIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePage(ep)}
                      title={t("pdfTemplates.removePage")}
                      className="flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </div>

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
                      ref={(el) => { canvasRefs.current[ep.clientId] = el }}
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
                      // Once cleared via "✕", a slot goes permanently inert
                      // for the rest of this session — no click, no re-upload,
                      // no re-typing, and its overlay (border/tint/buttons)
                      // disappears entirely, so it behaves and looks like
                      // genuinely empty space rather than an editable box that
                      // merely happens to be empty right now.
                      const isRemoved = removedHotspotIds.has(h.id)

                      return (
                        <div
                          key={h.id}
                          role={isRemoved ? undefined : "button"}
                          tabIndex={isRemoved ? undefined : 0}
                          onClick={isRemoved ? undefined : () => (isText ? beginEditText(h) : beginEditImage(h))}
                          onKeyDown={isRemoved ? undefined : (e) => {
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
                            cursor: isRemoved ? "default" : isBusy ? "wait" : "pointer",
                            border: isRemoved ? "none" : `1.5px dashed ${isText ? TEXT_OUTLINE : IMAGE_OUTLINE}`,
                            background: isRemoved || isEditing ? "transparent" : isText ? TEXT_OUTLINE_BG : IMAGE_OUTLINE_BG,
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isBusy && <Loader2Icon className="size-4 animate-spin text-white drop-shadow" />}
                          {!isRemoved && !isBusy && !isText && !isEditing && (
                            <>
                              <UploadIcon className="size-4 opacity-0 transition-opacity group-hover:opacity-70" style={{ color: IMAGE_OUTLINE }} />
                              <button
                                type="button"
                                title={t("pdfTemplates.removeImage")}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeImage(h)
                                }}
                                className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                              >
                                <XIcon className="size-3" />
                              </button>
                            </>
                          )}
                          {!isRemoved && !isBusy && isText && !isEditing && (
                            <button
                              type="button"
                              title={t("pdfTemplates.removeText")}
                              onClick={(e) => {
                                e.stopPropagation()
                                removeText(h)
                              }}
                              className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
                            >
                              <XIcon className="size-3" />
                            </button>
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
                                  // Also unmounts this focused textarea, which
                                  // fires the same stale onBlur commitEditText
                                  // guards against — without this, Escape
                                  // would silently commit instead of cancel.
                                  commitInFlightRef.current = true
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
