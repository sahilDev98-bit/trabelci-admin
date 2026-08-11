import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, UploadIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import * as pdfjsLib from "pdfjs-dist"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { PdfEditorRail, type PdfContentMode, type PdfOrganizerMode } from "./PdfEditorRail"
import { PdfPageOrganizer, type OrganizerPage } from "./PdfPageOrganizer"
import { PdfTextPreview, type PdfTextPreviewBackgroundPatch } from "./PdfTextPreview"
import { PdfOverlayItem } from "./PdfOverlayItem"
import { PdfOverlayToolbar } from "./PdfOverlayToolbar"
import {
  FALLBACK_FONT_STACK,
  fontCanDraw,
  hotspotCanvasFont,
  loadPdfSessionFonts,
  pdfFontFamily,
  unloadPdfSessionFonts,
} from "./pdfFonts"
import { fitText } from "./pdfTextFit"
import { ROUTES } from "@/lib/routes"
import type { DownloadProgress } from "@/lib/apiClient"
import {
  startPdfMasterSession,
  fetchPdfMasterSessionJobStatus,
  fetchPdfMasterSessionFile,
  fetchPdfMasterSessionFonts,
  fetchPdfMasterHotspotMask,
  fetchPdfMasterCleanPatch,
  applyPdfMasterEditsAndExport,
  closePdfMasterSession,
} from "@/features/pdfTemplates/api"
import type { PdfMasterPagePlanEntry, PdfMasterPendingEdit } from "@/features/pdfTemplates/api"
import type {
  EditorPage,
  PdfHotspot,
  PdfOverlay,
  PdfSession,
  PdfSessionFont,
  PdfTemplate,
  PdfTextHotspot,
  PdfTextRenderPlan,
} from "@/features/pdfTemplates/types"

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
// A paragraph that no longer fits its original space even after wrapping —
// distinct from IMAGE_OUTLINE's amber so the two "something needs your
// attention" cases (a box that spilled past its original height vs. an
// image slot) never look the same as each other.
const TEXT_OVERFLOW_OUTLINE = "rgba(220,38,38,0.85)"
const TEXT_OVERFLOW_OUTLINE_BG = "rgba(220,38,38,0.10)"

// Fallback native render resolution — only actually used for the rare page
// that renders before the container's real width has ever been measured
// (see renderPage/containerWidthRef below). Every other render uses the
// container's own measured width instead, so the page fills it exactly on
// any screen rather than being capped at one guessed number.
const PAPER_TARGET_WIDTH = 1300

// Tiny fixed breathing room around each page — just enough that its drop
// shadow (see the page card's boxShadow below) doesn't get clipped by the
// container's overflow-x-hidden. Kept in sync between the render
// resolution (renderPage) and the on-screen display scale (below) so the
// page fills the container exactly rather than being rendered at one size
// and then still shrunk to fit a differently-computed one.
const PAGE_SIDE_GUTTER_PX = 24

// Analysis of a large, image-heavy catalog can legitimately take minutes —
// far longer than Cloudflare's ~100s ceiling for a single response. So the
// backend only starts the job and returns immediately; this polls a
// lightweight status endpoint instead of one long-held request.
const JOB_POLL_INTERVAL_MS = 2_000
const JOB_POLL_TIMEOUT_MS = 10 * 60 * 1000 // generous ceiling for a very heavy catalog

// ── Loading-progress phase boundaries (percent) ─────────────────────────────
//
// The initial load has three phases with very different characters, so one
// uniform bar would either lie (claim more progress than we actually know)
// or stall (sit frozen while real work happens). Each phase is handled
// honestly instead:
//   1. Start session — a single request; jumps straight to its endpoint the
//      moment it resolves, nothing to show in between.
//   2. Analysis (job polling) — the server only ever reports "still
//      processing" or "done" (see waitForSessionJob), no page-by-page
//      signal. With nothing real to measure, this phase creeps toward its
//      ceiling on every poll tick and deliberately never touches it —
//      the moment the real "done" arrives, it snaps straight to the ceiling.
//   3. File download — a real binary transfer, so this is genuine
//      bytes-received-vs-total progress (see DownloadProgress), mapped onto
//      the remaining slice of the bar.
const PROGRESS_SESSION_STARTED_PCT = 12
const PROGRESS_ANALYSIS_CEILING_PCT = 65
const PROGRESS_FILE_DOWNLOAD_END_PCT = 97
// How much of the remaining gap to the analysis ceiling each poll tick
// closes — smaller = slower, more gradual crawl. 0.15 reaches ~90% of the
// way to the ceiling after 5 ticks (~10s) and keeps visibly, gently
// creeping for as long as the analysis actually takes.
const PROGRESS_ANALYSIS_TICK_FACTOR = 0.15

// Separator between an editor page's clientId and a hotspot's original id —
// see PdfHotspotBase.id. Chosen over ":" since generated ids (crypto
// randomUUID, server-issued hotspot ids like "p1-t1") never contain it.
const ID_NAMESPACE_SEP = "::"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** onTick fires once per "still processing" poll (not on the final, done
 * check) — the caller uses it to nudge a progress indicator, since this
 * function itself has no notion of percentages. */
async function waitForSessionJob(
  jobId: string,
  onTick?: () => void,
): Promise<Omit<PdfSession, "templateId" | "templateName">> {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS
  while (true) {
    const status = await fetchPdfMasterSessionJobStatus(jobId)
    if (status.status === "done") return status.result
    if (status.status === "failed") throw new Error(status.error)
    if (Date.now() > deadline) throw new Error("PDF analysis is taking too long — try a smaller file")
    onTick?.()
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

// Every upload is squeezed under this before being sent. A reverse proxy in
// front of the API caps request bodies — nginx defaults to 1MB — and it
// rejects an oversized upload BEFORE proxying it, so the request never
// reaches the app at all: nothing in the server log, and the browser sees a
// bare network failure with no status code, which is impossible to act on.
// Staying comfortably under the smallest common limit means the feature
// works regardless of how that proxy is configured.
const UPLOAD_TARGET_BYTES = 900 * 1024
// Progressively harder attempts. A page slot is at most a few hundred
// points across, so even the smallest of these carries more detail than the
// PDF can show — a modern phone photo is 4000px+ on its long edge.
const UPLOAD_ATTEMPTS: { maxPx: number; quality: number }[] = [
  { maxPx: 2400, quality: 0.85 },
  { maxPx: 1800, quality: 0.8 },
  { maxPx: 1400, quality: 0.7 },
  { maxPx: 1000, quality: 0.6 },
  { maxPx: 700, quality: 0.5 },
]
// Absolute refusal point, if even the hardest attempt can't get there.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

async function encodeAt(
  bitmap: ImageBitmap,
  maxPx: number,
  quality: number,
  keepAlpha: boolean,
): Promise<Blob | null> {
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) =>
    canvas.toBlob(resolve, keepAlpha ? "image/png" : "image/jpeg", quality),
  )
}

/**
 * Shrink an image until it will pass through the proxy, trying progressively
 * smaller/harder encodings and stopping at the first that fits.
 *
 * PNG stays PNG: overlay logos and cut-outs rely on transparency, and
 * re-encoding those as JPEG would fill every transparent pixel with black.
 * That means a PNG can only be made smaller by shrinking it, never by
 * lowering quality — so it may not reach the target, and the caller's size
 * check is what catches that.
 */
async function downscaleImageFile(file: File): Promise<File> {
  if (file.size <= UPLOAD_TARGET_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const keepAlpha = file.type === "image/png"
    let best: Blob | null = null
    try {
      for (const attempt of UPLOAD_ATTEMPTS) {
        const blob = await encodeAt(bitmap, attempt.maxPx, attempt.quality, keepAlpha)
        if (!blob) continue
        if (!best || blob.size < best.size) best = blob
        if (blob.size <= UPLOAD_TARGET_BYTES) break
      }
    } finally {
      bitmap.close()
    }
    // Never take a re-encode that made things worse — a small PNG can come
    // back bigger than it went in.
    if (!best || best.size >= file.size) return file
    return new File([best], file.name, { type: best.type })
  } catch {
    return file // undecodable here; let the server have the original
  }
}

/** Decode a base64 PNG into something canvas can draw. Resolves even on a
 * decode failure (with a blank 1×1) so a malformed mask degrades to "no
 * shape applied" rather than leaving the replacement undrawn entirely. */
function loadImageFromBase64Png(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(new Image(1, 1))
    img.src = `data:image/png;base64,${base64}`
  })
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

// Text wrapping/measurement/auto-fit all moved to pdfTextFit.ts, which does
// it in the document's OWN embedded typeface (see pdfFonts.ts) rather than
// the generic system-ui face used here before. That mattered: the export
// draws in the real font, so measuring in a different one meant the preview
// and the downloaded file could legitimately disagree about where lines
// wrap and whether the text fit at all.

// Defense in depth alongside the server's own fix (see pdf_editor.py's
// _extract_hotspots): a hotspot with a missing/zero/degenerate lineHeight —
// whatever the source, past or future — must never be allowed to collapse
// every wrapped line onto the same baseline again (that's exactly what
// produced illegible overlapping text and a squashed-to-nothing box for a
// real table-of-contents row). Falls back to the same size*1.2 default used
// server-side.
function effectiveLineHeight(hotspot: { size: number; lineHeight: number }): number {
  return hotspot.lineHeight > hotspot.size * 0.3 ? hotspot.lineHeight : hotspot.size * 1.2
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
  // 0–100. See the PROGRESS_* constants above for what drives each phase.
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageStates, setPageStates] = useState<PageRenderState[]>([])
  const [busyHotspotId, setBusyHotspotId] = useState<string | null>(null)
  const [editingHotspotId, setEditingHotspotId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState("")
  const [editingBackground, setEditingBackground] = useState("#ffffff")
  // The document's REAL background behind the hotspot currently being
  // edited, decoded and ready to draw — see loadCleanPatchForEditing. null
  // while it's still loading (or genuinely unavailable), in which case the
  // modal preview falls back to editingBackground's sampled flat colour.
  const [editingCleanPatch, setEditingCleanPatch] = useState<PdfTextPreviewBackgroundPatch | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  // What clicking on a page does in the MAIN view. Page arranging isn't part
  // of this any more — it happens entirely inside the organizer dialog, so
  // the main view never goes half-disabled while a page tool is active.
  const [contentMode, setContentMode] = useState<PdfContentMode>("text")
  // Which job the organizer dialog is open for, or null when it's closed.
  const [organizerMode, setOrganizerMode] = useState<PdfOrganizerMode | null>(null)
  // Snapshots of each page's current appearance (data URLs, keyed by
  // clientId), captured when the organizer opens so its thumbnails show the
  // real document — edits included — rather than the pristine original.
  const [pageThumbnails, setPageThumbnails] = useState<Record<string, string>>({})
  // Items the user ADDED on top of pages (as opposed to hotspots, which are
  // regions the PDF already contained). Free position, size and angle.
  const [overlays, setOverlays] = useState<PdfOverlay[]>([])
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
  // Which added text item is in typing mode. Separate from selection: a
  // selected item is being moved/resized, an editing one is being written in,
  // and the pointer can't serve both at once.
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null)
  // The document's own faces, kept so added text can be set in the
  // catalogue's real typeface rather than always a generic one.
  const [sessionFonts, setSessionFonts] = useState<Record<string, PdfSessionFont>>({})
  // Viewport y the right rail pins its top edge to — measured from the
  // sticky header rather than hardcoded, so a header that grows taller (a
  // long template name wrapping on a narrow screen) pushes the rail down
  // with it instead of letting it slide underneath.
  const [railTop, setRailTop] = useState<number | null>(null)
  // Font ids from this document that the browser successfully registered
  // (see pdfFonts.ts). A hotspot whose fontId is in here gets measured and
  // previewed in the page's REAL typeface — which is the same one the export
  // draws with, so what's on screen is what lands in the file.
  const [availableFontIds, setAvailableFontIds] = useState<Set<string>>(new Set())
  // Auto-fit: shrink the type (down to a floor) so a replacement stays inside
  // its box, the way a real layout tool behaves. On by default — the common
  // case is wanting the text to work, not wanting it to spill.
  const [autoFit, setAutoFit] = useState(true)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  // Mirrors containerWidth for reading inside renderPage without putting it
  // in that useCallback's deps (which would re-create it, and cascade into
  // re-running the paint effect, on every ResizeObserver tick).
  const containerWidthRef = useRef<number | null>(null)
  // Hotspots cleared via their "✕" (or committed to empty text) — the
  // overlay's border/tint/remove-button are what actually made a cleared
  // area still look like an occupied box, so this drives hiding them,
  // making the area behave like genuinely empty space. State, not a ref,
  // since it has to trigger a re-render of the overlay itself.
  const [removedHotspotIds, setRemovedHotspotIds] = useState<Set<string>>(new Set())
  // A committed text edit's actual rendered height (PDF points), keyed by
  // hotspot id — lets a paragraph's box visually shrink to what it now
  // contains (2 lines instead of the original 10) instead of always
  // showing the full original area. Absent entries fall back to the
  // hotspot's own (original) bbox height, so untouched hotspots are
  // unaffected. Never used for the actual cover/redaction area, which must
  // always use the full ORIGINAL bbox regardless — only for this visual
  // outline, so shorter replacement text can never leave old text peeking
  // out from a gap the cover didn't reach.
  const [hotspotVisualHeightPts, setHotspotVisualHeightPts] = useState<Record<string, number>>({})

  // Keyed by editor page clientId (not a raw page number) — a duplicated
  // page needs its own independent canvas even though it started as a copy
  // of another page's content.
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The text-edit modal's textarea — focused manually via DialogContent's
  // onOpenAutoFocus (see below) instead of a plain `autoFocus` prop, since
  // Radix's own focus-trap setup would otherwise sometimes win the race and
  // land focus on the dialog's Cancel button instead.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingImageHotspotId = useRef<string | null>(null)
  // Files for image overlays, keyed by overlay id. A ref rather than state:
  // a File isn't meaningfully renderable (the object URL on the overlay is
  // what's displayed), and this is only read once, at export.
  const overlayFilesRef = useRef<Record<string, File>>({})
  // Shape stencil per image hotspot, keyed by its namespaced id. "" means
  // "asked, and it's a plain rectangle" — distinct from undefined ("not
  // asked yet"), so a rectangular slot is never re-queried on every edit.
  const overlayMaskCacheRef = useRef<Record<string, string>>({})
  // The document's real background behind each text slot, keyed by
  // namespaced hotspot id. null means "asked, and none available" — distinct
  // from undefined ("not asked yet"), so it isn't re-requested every edit.
  const cleanPatchCacheRef = useRef<Record<string, { patch: string; rect: number[] } | null>>({})
  // Set while the file picker is open for a NEW overlay rather than for
  // replacing an existing image hotspot — the two share one <input>.
  const pendingOverlayUpload = useRef(false)
  // Mirrors editingHotspotId (kept in sync by an effect below) so an
  // in-flight clean-patch fetch can tell, once it resolves, whether the
  // modal is still open on the SAME hotspot it was fetched for — without
  // this, quickly closing one edit and opening another could apply the
  // wrong hotspot's background patch to whatever is open by the time the
  // network response lands.
  const editingHotspotIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const sessionStartedRef = useRef(false)
  const pagesContainerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  // The parsed original PDF, downloaded and parsed exactly once (initial
  // load). Every ORIGINAL page renders from this shared document; edits,
  // and duplicated pages, are drawn straight onto each page's own canvas
  // (see drawTextEditOnCanvas/drawImageEditOnCanvas/duplicatePage) and never
  // touch this again.
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
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

  /** Download the current working copy once and (re)parse it.
   * onDownloadProgress (optional) reports real bytes-received-vs-total as
   * the file streams in, for the initial-load progress bar. */
  const reloadDocument = useCallback(async (onDownloadProgress?: (progress: DownloadProgress) => void) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const bytes = await fetchPdfMasterSessionFile(sessionId, onDownloadProgress)
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise
    const old = pdfDocRef.current
    pdfDocRef.current = doc
    if (old) void old.destroy()
  }, [])

  /** Paint a parsed pdf.js page onto an editor page's canvas, at native
   * resolution targetWidth (see renderPage — normally the container's own
   * measured width, so the page fills it exactly rather than being capped
   * at one fixed guess). */
  const drawPageToCanvas = useCallback(async (page: pdfjsLib.PDFPageProxy, clientId: string, targetWidth: number) => {
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = targetWidth / baseViewport.width
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
    // Render at the container's actual current width (set by the
    // ResizeObserver effect below, which fires on mount well before any
    // session finishes loading) so the page fills it exactly. Falls back to
    // a fixed guess only if a page somehow renders before that measurement
    // ever arrives.
    const targetWidth = containerWidthRef.current
      ? Math.max(300, containerWidthRef.current - PAGE_SIDE_GUTTER_PX)
      : PAPER_TARGET_WIDTH
    await drawPageToCanvas(page, clientId, targetWidth)
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

  /** Can this hotspot's own embedded face actually DRAW this text? A subset
   * keeps cmap entries for characters whose outlines it discarded, so the
   * font loads, reports the glyph, and prints nothing — which is exactly how
   * "Yash" came out as "ash". When it can't, everything (measuring, preview,
   * page canvas and the export) must switch to the bundled face together, or
   * they disagree about widths. */
  const hotspotNeedsFallbackFont = useCallback((hotspot: PdfTextHotspot, text: string): boolean => {
    if (!hotspot.fontId || !availableFontIds.has(hotspot.fontId)) return true
    return !fontCanDraw(sessionFonts[hotspot.fontId]?.usable ?? "", text)
  }, [availableFontIds, sessionFonts])

  /**
   * Draw a text edit directly onto the page's canvas — no network call.
   * Mirrors the server's own approach (cover the old line, draw the new one
   * on top) so it looks right immediately.
   *
   * Takes the already-computed PdfTextRenderPlan rather than re-deriving the
   * layout: the exact same lines/size/font-fallback/direction/alignment are
   * what get sent to the server and drawn into the exported PDF, so the page
   * you're looking at, the modal preview and the downloaded file are all
   * guaranteed to agree. Re-deriving any of that here — in particular,
   * re-checking whether the fallback font is needed — would reopen exactly
   * the bug this plan exists to close: that check has to run against the
   * text actually being drawn, and by the time this function runs, the only
   * "current text" available locally is whatever's left on the stale
   * `hotspot` object, not the new value the user just typed.
   */
  const drawTextEditOnCanvas = useCallback(async (hotspot: PdfHotspot, plan: PdfTextRenderPlan, backgroundColor: string) => {
    if (hotspot.type !== "text") return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const ctx = canvas?.getContext("2d")
    if (!canvas || !pageInfo || !ctx) return

    const pxPerPoint = canvas.width / pageInfo.width
    const [x0, y0, x1, y1] = hotspot.bbox
    const pad = 1.5 * pxPerPoint

    // Erase the old text by restoring the document's REAL background, not by
    // painting a colour over it. A sampled flat colour is fine on plain
    // paper but lands as an obvious grey rectangle over a photograph, and
    // the export never had that problem — it redacts, so whatever was
    // underneath simply shows through. This fetches exactly that redacted
    // patch, once per slot, so the preview matches.
    let patch = cleanPatchCacheRef.current[hotspot.id]
    if (patch === undefined) {
      try {
        patch = session ? await fetchPdfMasterCleanPatch(session.session_id, hotspot.originalId) : null
      } catch {
        patch = null
      }
      cleanPatchCacheRef.current[hotspot.id] = patch
    }

    if (patch?.patch && patch.rect.length === 4) {
      const img = await loadImageFromBase64Png(patch.patch)
      const [rx0, ry0, rx1, ry1] = patch.rect
      ctx.drawImage(img, rx0 * pxPerPoint, ry0 * pxPerPoint, (rx1 - rx0) * pxPerPoint, (ry1 - ry0) * pxPerPoint)
    } else {
      // Fall back to the old sampled fill only when the real patch can't be
      // had — better an approximate cover than old and new text on top of
      // each other.
      ctx.fillStyle = backgroundColor
      ctx.fillRect(x0 * pxPerPoint - pad, y0 * pxPerPoint - pad, (x1 - x0) * pxPerPoint + pad * 2, (y1 - y0) * pxPerPoint + pad * 2)
    }

    if (plan.lines.length === 0) return

    ctx.font = hotspotCanvasFont(
      hotspot, session?.session_id ?? null, availableFontIds, plan.fontSize * pxPerPoint,
      plan.useFallbackFont,
    )
    ctx.fillStyle = colorIntToCss(hotspot.color)
    ctx.direction = plan.direction
    ctx.textAlign = plan.align
    ctx.textBaseline = "alphabetic"

    // The real first line's baseline (server-measured) — NOT y1 (the
    // bottom of the whole paragraph). Anchoring to y1 was fine when a
    // hotspot was a single line (its bottom ≈ its own baseline), but for a
    // multi-line paragraph it draws the replacement text at the very
    // bottom of the box. A paragraph that wraps into more lines than it
    // originally had will simply overflow past y1, same as the export.
    const originY = hotspot.originY
    // The x anchor follows ALIGNMENT, not direction directly — "right"
    // hugs the box's right edge, "left" its left edge, "center" its
    // middle, and ctx.textAlign does the actual per-glyph placement from
    // there. Direction and alignment are related (RTL defaults to right)
    // but not the same thing: see PdfTextRenderPlan.align.
    const boxCenter = ((x0 + x1) / 2) * pxPerPoint
    const x = plan.align === "right" ? x1 * pxPerPoint : plan.align === "center" ? boxCenter : x0 * pxPerPoint
    plan.lines.forEach((line, i) => {
      ctx.fillText(line, x, (originY + i * plan.lineHeight) * pxPerPoint)
    })
  }, [session, availableFontIds])

  /** Draw a replacement image directly onto the page's canvas — no network call. */
  const drawImageEditOnCanvas = useCallback(async (hotspot: PdfHotspot, file: File) => {
    if (hotspot.type !== "image") return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const ctx = canvas?.getContext("2d")
    if (!canvas || !pageInfo || !ctx) return

    const bitmap = await createImageBitmap(file)
    try {
      const pxPerPoint = canvas.width / pageInfo.width
      const [x0, y0, x1, y1] = hotspot.bbox
      const dx = x0 * pxPerPoint
      const dy = y0 * pxPerPoint
      const dw = (x1 - x0) * pxPerPoint
      const dh = (y1 - y0) * pxPerPoint

      // Does this slot clip its picture to a shape? The page's own drawing
      // instructions decide that, and only the server can see them — so ask,
      // once per slot, and remember the answer.
      let maskB64 = overlayMaskCacheRef.current[hotspot.id]
      if (maskB64 === undefined) {
        try {
          maskB64 = session ? await fetchPdfMasterHotspotMask(session.session_id, hotspot.originalId) : ""
        } catch {
          maskB64 = ""
        }
        overlayMaskCacheRef.current[hotspot.id] = maskB64
      }

      if (!maskB64) {
        ctx.drawImage(bitmap, dx, dy, dw, dh)
        return
      }

      // The slot is cut to a shape (a circle, rounded corners, a silhouette).
      // Compose the replacement through that shape off-screen, so what's
      // drawn here matches the exported page — which keeps the shape,
      // because the clip lives in the page and survives the swap. A plain
      // rectangle on screen would be a preview that lies about the result.
      const mask = await loadImageFromBase64Png(maskB64)
      const stencil = document.createElement("canvas")
      stencil.width = Math.max(1, Math.round(dw))
      stencil.height = Math.max(1, Math.round(dh))
      const sctx = stencil.getContext("2d")
      if (!sctx) {
        ctx.drawImage(bitmap, dx, dy, dw, dh)
        return
      }
      sctx.drawImage(bitmap, 0, 0, stencil.width, stencil.height)
      // Keeps the replacement only where the mask is opaque — everything
      // outside the shape is cut away, exactly as the PDF's own soft mask does.
      sctx.globalCompositeOperation = "destination-in"
      sctx.drawImage(mask, 0, 0, stencil.width, stencil.height)
      // No need to clear underneath first: the old picture occupied exactly
      // this same masked area, so the new one covers every pixel it did.
      ctx.drawImage(stencil, dx, dy)
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
      setLoadProgress(0)
      setLoadError(null)
      try {
        const jobStart = await startPdfMasterSession(template.id)
        // Phase 1 done: nothing to show in between a single request resolving.
        setLoadProgress(PROGRESS_SESSION_STARTED_PCT)

        // Phase 2: no real signal (see waitForSessionJob) — creep toward the
        // ceiling on every poll tick without ever reaching it, then snap to
        // it the instant the real "done" arrives below.
        const jobResult = await waitForSessionJob(jobStart.jobId, () => {
          setLoadProgress((prev) => prev + (PROGRESS_ANALYSIS_CEILING_PCT - prev) * PROGRESS_ANALYSIS_TICK_FACTOR)
        })
        setLoadProgress(PROGRESS_ANALYSIS_CEILING_PCT)

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
          rotation: 0,
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

        // The document's own typefaces. Deliberately non-fatal and not
        // awaited into the failure path: if this can't be fetched or a face
        // won't parse, the editor still works exactly as before — it just
        // measures/previews in a generic face instead of the real one.
        try {
          const fonts = await fetchPdfMasterSessionFonts(result.session_id)
          setSessionFonts(fonts)
          setAvailableFontIds(await loadPdfSessionFonts(result.session_id, fonts))
        } catch (err) {
          console.warn("Could not load the document's own fonts — preview will use a fallback face", err)
        }

        // Phase 3: a real binary transfer, so this is genuine bytes-received-
        // vs-total progress, mapped onto the remaining slice of the bar. If
        // the response has no Content-Length to compare against, fall back
        // to the same honest crawl phase 2 used, just within this phase's
        // own slice — one download + one parse for the whole document.
        await reloadDocument(({ loaded, total }) => {
          if (total) {
            const fraction = Math.min(1, loaded / total)
            setLoadProgress(
              PROGRESS_ANALYSIS_CEILING_PCT + fraction * (PROGRESS_FILE_DOWNLOAD_END_PCT - PROGRESS_ANALYSIS_CEILING_PCT),
            )
          } else {
            setLoadProgress((prev) => prev + (PROGRESS_FILE_DOWNLOAD_END_PCT - prev) * PROGRESS_ANALYSIS_TICK_FACTOR)
          }
        })

        // Pre-size every page card from the session's own PDF-point
        // dimensions — cards mount at their correct final height immediately,
        // no waiting for pdf.js to render anything first (that ordering bug
        // is exactly what left pages blank/collapsed before this fix: the
        // old code tried to paint onto canvases in this same async function,
        // before React had ever mounted them — every draw silently no-opped).
        setPageStates(pages.map((p) => ({ page: p.clientId, ...pageSizeToCss(p.width, p.height) })))
        setLoadProgress(100)

        // Let "100%" actually register on screen for a beat before swapping
        // to the loaded document — without this, isLoading flips false in
        // the very same tick this reaches 100%, so the number never really
        // gets seen. Deliberately placed BEFORE setSession, not after: this
        // is an await, and setSession must land in the SAME commit as
        // isLoading turning false below (no await between them) — that's
        // what guarantees the page canvases already exist in the DOM by the
        // time the paint effect's passive phase runs (see the comment above
        // this same effect). An await sitting between setSession and
        // isLoading going false would reintroduce exactly the blank-page bug
        // that comment describes, just moved a few lines down.
        await sleep(1500)

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
      // Drop this document's registered faces too — otherwise opening
      // several templates in one page-load keeps every previous one's fonts
      // resident for the lifetime of the tab.
      if (sessionIdRef.current) {
        unloadPdfSessionFonts(sessionIdRef.current)
        void closePdfMasterSession(sessionIdRef.current)
      }
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
  // Pages render at the container's own measured native resolution (see
  // renderPage) for crisp canvas output filling it exactly, then get shrunk
  // via a CSS transform on the whole "paper" (canvas + hotspot overlays
  // together, so they always stay pixel-aligned) if the container later
  // gets narrower than that — no re-render, no extra network/CPU cost.
  // Never scales up past native resolution (would blur): if the container
  // instead gets WIDER after the initial render, the page stays at the
  // width it already rendered at until something re-renders it (e.g.
  // duplicating a page, or reopening the template) rather than upscaling.
  useEffect(() => {
    const el = pagesContainerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) {
        setContainerWidth(width)
        containerWidthRef.current = width
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Right-rail anchoring ────────────────────────────────────────────────────
  //
  // The rail is position:fixed (it must stay put while the pages scroll), so
  // it can't inherit the header's position from the layout — it needs a real
  // pixel value. Measured rather than hardcoded so a taller header (long
  // template name wrapping on a narrow screen) moves the rail down with it.
  // The header is sticky at the app chrome's own offset and never actually
  // moves, so its bottom is stable and doesn't need a scroll listener.
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    // + the same my-3 (12px) each page card uses, so the rail's top edge
    // lines up exactly with the top of the page below it rather than sitting
    // at some unrelated offset.
    const measure = () => setRailTop(el.getBoundingClientRect().bottom + 12)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    editingHotspotIdRef.current = editingHotspotId
  }, [editingHotspotId])

  // ── Added items (overlays) ──────────────────────────────────────────────────

  /** Where a newly added item lands: centred horizontally, a little down from
   * the top of whichever page is nearest the middle of the viewport — i.e.
   * the page you're actually looking at, so a new item never appears
   * offscreen. */
  function newOverlayPlacement(): { pageClientId: string; x: number; y: number } | null {
    if (editorPages.length === 0) return null
    const viewportMiddle = window.innerHeight / 2
    let best = editorPages[0]
    let bestDistance = Number.POSITIVE_INFINITY
    for (const page of editorPages) {
      const canvas = canvasRefs.current[page.clientId]
      if (!canvas) continue
      const rect = canvas.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - viewportMiddle)
      if (distance < bestDistance) {
        bestDistance = distance
        best = page
      }
    }
    return { pageClientId: best.clientId, x: best.width * 0.25, y: best.height * 0.2 }
  }

  function addTextOverlay() {
    const placement = newOverlayPlacement()
    if (!placement) return
    const overlay: PdfOverlay = {
      id: crypto.randomUUID(),
      type: "text",
      pageClientId: placement.pageClientId,
      x: placement.x,
      y: placement.y,
      width: 220,
      height: 60,
      rotation: 0,
      text: t("pdfTemplates.overlayNewText"),
      fontId: "",
      fontSize: 18,
      color: "#000000",
      bold: false,
      italic: false,
      align: "left",
    }
    setOverlays((prev) => [...prev, overlay])
    setSelectedOverlayId(overlay.id)
    // Straight into typing mode with the placeholder selected, so the first
    // thing you type replaces it. Adding a text box and then having to hunt
    // for how to write in it is the wrong first experience.
    setEditingOverlayId(overlay.id)
  }

  /** Shrink an upload to something sane, and refuse anything still too big —
   * with a message, rather than letting the export die later as a bare
   * network failure the user can't interpret. Returns null if rejected. */
  async function prepareUpload(file: File): Promise<File | null> {
    const prepared = await downscaleImageFile(file)
    if (prepared.size > MAX_UPLOAD_BYTES) {
      toast.error(t("pdfTemplates.masterImageTooLarge", { mb: Math.round(prepared.size / 1024 / 1024) }))
      return null
    }
    return prepared
  }

  async function addImageOverlay(file: File) {
    const placement = newOverlayPlacement()
    if (!placement) return
    // Sized from the image's real proportions so it doesn't land visibly
    // stretched and need fixing before it can even be looked at.
    let ratio = 1
    try {
      const bitmap = await createImageBitmap(file)
      ratio = bitmap.height / bitmap.width
      bitmap.close()
    } catch {
      // Undecodable here — the browser's <img> may still manage it; a square
      // default is a harmless starting point.
    }
    const width = 200
    const id = crypto.randomUUID()
    overlayFilesRef.current[id] = file
    const overlay: PdfOverlay = {
      id,
      type: "image",
      pageClientId: placement.pageClientId,
      x: placement.x,
      y: placement.y,
      width,
      height: Math.max(20, width * ratio),
      rotation: 0,
      previewUrl: URL.createObjectURL(file),
    }
    setOverlays((prev) => [...prev, overlay])
    setSelectedOverlayId(id)
  }

  function updateOverlay(id: string, patch: Partial<PdfOverlay>) {
    // Cast: the patch always comes from a control bound to THIS overlay, so
    // its fields belong to that overlay's own variant — but TypeScript can't
    // see that through a Partial of the union.
    setOverlays((prev) => prev.map((o) => (o.id === id ? ({ ...o, ...patch } as PdfOverlay) : o)))
  }

  function removeOverlay(id: string) {
    setOverlays((prev) => {
      const target = prev.find((o) => o.id === id)
      // Object URLs are held by the browser until explicitly released, so a
      // session of adding and removing images would otherwise leak every
      // one of them for the lifetime of the tab.
      if (target?.type === "image") URL.revokeObjectURL(target.previewUrl)
      return prev.filter((o) => o.id !== id)
    })
    delete overlayFilesRef.current[id]
    setSelectedOverlayId((prev) => (prev === id ? null : prev))
    setEditingOverlayId((prev) => (prev === id ? null : prev))
  }

  // ── Page management (via the organizer dialog) ──────────────────────────────

  /** Open the organizer for one job, snapshotting every page's CURRENT
   * appearance first so the thumbnails show the real document — text edits,
   * replaced images and all — rather than the pristine original. */
  function openOrganizer(mode: PdfOrganizerMode) {
    if (editingHotspotId) cancelEditText()
    const shots: Record<string, string> = {}
    for (const page of editorPages) {
      const canvas = canvasRefs.current[page.clientId]
      if (!canvas || canvas.width === 0) continue
      try {
        // Drawn down to a small offscreen canvas first: toDataURL on a
        // full-resolution page canvas produces a multi-megabyte string per
        // page, which for a 15-page catalog is enough to noticeably stall
        // the tab just to open a dialog.
        const targetWidth = 220
        const shrunk = document.createElement("canvas")
        shrunk.width = targetWidth
        shrunk.height = Math.max(1, Math.round((canvas.height / canvas.width) * targetWidth))
        const ctx = shrunk.getContext("2d")
        if (!ctx) continue
        ctx.drawImage(canvas, 0, 0, shrunk.width, shrunk.height)
        shots[page.clientId] = shrunk.toDataURL("image/jpeg", 0.7)
      } catch {
        // Tainted canvas or similar — that page just shows its number instead.
      }
    }
    setPageThumbnails(shots)
    setOrganizerMode(mode)
  }

  /** Clone everything a page owns — its pixels, hotspots, pending edits — under
   * a fresh clientId, WITHOUT placing it in the document. Ordering is the
   * organizer's job; this only materialises the resources a new copy needs. */
  async function clonePageResources(sourceClientId: string): Promise<string | null> {
    const sourceCanvas = canvasRefs.current[sourceClientId]
    if (!sourceCanvas) return null

    // Snapshot the source's CURRENT pixels (includes any edits already made)
    // — independent of whatever happens to the source canvas later.
    const bitmap = await createImageBitmap(sourceCanvas)
    const newClientId = crypto.randomUUID()
    renderedClientIdsRef.current.add(newClientId) // never rendered via pdf.js — the bitmap effect handles it
    pendingPageBitmapRef.current[newClientId] = bitmap

    const clonedHotspots: Record<string, PdfHotspot> = {}
    const clonedEdits: Record<string, PdfMasterPendingEdit> = {}
    const clonedRemovedIds: string[] = []
    const clonedVisualHeights: Record<string, number> = {}
    for (const h of Object.values(hotspots)) {
      if (ownerClientId(h.id) !== sourceClientId) continue
      const newId = `${newClientId}${ID_NAMESPACE_SEP}${h.originalId}`
      clonedHotspots[newId] = { ...h, id: newId }
      const existingEdit = pendingEditsRef.current[h.id]
      if (existingEdit) clonedEdits[newId] = { ...existingEdit, hotspotId: newId }
      if (removedHotspotIds.has(h.id)) clonedRemovedIds.push(newId)
      const existingHeight = hotspotVisualHeightPts[h.id]
      if (existingHeight != null) clonedVisualHeights[newId] = existingHeight
    }
    if (Object.keys(clonedHotspots).length > 0) {
      setHotspots((prev) => ({ ...prev, ...clonedHotspots }))
    }
    Object.assign(pendingEditsRef.current, clonedEdits)
    if (clonedRemovedIds.length > 0) {
      setRemovedHotspotIds((prev) => new Set([...prev, ...clonedRemovedIds]))
    }
    if (Object.keys(clonedVisualHeights).length > 0) {
      setHotspotVisualHeightPts((prev) => ({ ...prev, ...clonedVisualHeights }))
    }
    setPageStates((prev) => {
      const src = prev.find((p) => p.page === sourceClientId)
      if (!src) return prev
      return [...prev, { page: newClientId, cssWidth: src.cssWidth, cssHeight: src.cssHeight }]
    })

    // Added items belong to the page too, so a copied page carries its own
    // independent copies of them — editing one afterwards must not change
    // the other. Image overlays share the same File (it never changes), but
    // get their own object URL so revoking one can't blank the other.
    setOverlays((prev) => {
      const cloned = prev
        .filter((o) => o.pageClientId === sourceClientId)
        .map((o) => {
          const id = crypto.randomUUID()
          if (o.type === "image") {
            const file = overlayFilesRef.current[o.id]
            if (file) overlayFilesRef.current[id] = file
            return { ...o, id, pageClientId: newClientId, previewUrl: file ? URL.createObjectURL(file) : o.previewUrl }
          }
          return { ...o, id, pageClientId: newClientId }
        })
      return cloned.length > 0 ? [...prev, ...cloned] : prev
    })
    return newClientId
  }

  /** Drop everything belonging to pages that no longer exist. Without this a
   * deleted page's hotspots and pending edits would linger and still be sent
   * at Download time, re-applying edits to a page that isn't there. */
  function releasePages(ids: Set<string>) {
    if (ids.size === 0) return
    const owned = (id: string) => ids.has(ownerClientId(id))

    setHotspots((prev) => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (owned(id)) delete next[id]
      }
      return next
    })
    setRemovedHotspotIds((prev) => {
      const next = new Set(prev)
      for (const id of next) {
        if (owned(id)) next.delete(id)
      }
      return next
    })
    setHotspotVisualHeightPts((prev) => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (owned(id)) delete next[id]
      }
      return next
    })
    for (const id of Object.keys(pendingEditsRef.current)) {
      if (owned(id)) delete pendingEditsRef.current[id]
    }
    for (const clientId of ids) {
      delete canvasRefs.current[clientId]
      renderedClientIdsRef.current.delete(clientId)
      delete pendingPageBitmapRef.current[clientId]
    }
    setPageStates((prev) => prev.filter((p) => !ids.has(p.page)))
    // Added items go with the page they were placed on, object URLs released
    // so a deleted page's images don't stay resident for the tab's lifetime.
    setOverlays((prev) => {
      const doomed = prev.filter((o) => ids.has(o.pageClientId))
      if (doomed.length === 0) return prev
      for (const o of doomed) {
        if (o.type === "image") URL.revokeObjectURL(o.previewUrl)
        delete overlayFilesRef.current[o.id]
      }
      return prev.filter((o) => !ids.has(o.pageClientId))
    })
    if (selectedOverlayId && ids.has(overlays.find((o) => o.id === selectedOverlayId)?.pageClientId ?? "")) {
      setSelectedOverlayId(null)
    }
    if (editingHotspotId && owned(editingHotspotId)) setEditingHotspotId(null)
  }

  /** Commit the organizer's result: the dialog decided the final order,
   * which pages were dropped, which are new copies and how each is rotated —
   * this turns that plan into real editor state. */
  async function applyOrganizer(result: OrganizerPage[]) {
    setOrganizerMode(null)

    const byClientId = new Map(editorPages.map((p) => [p.clientId, p]))
    const kept = new Set(result.map((r) => r.clientId).filter((id): id is string => id !== null))
    const removed = new Set(editorPages.map((p) => p.clientId).filter((id) => !kept.has(id)))

    // Copies are materialised BEFORE the new order is committed, since each
    // needs a snapshot of its source's canvas — which must still be mounted.
    const nextPages: EditorPage[] = []
    for (const entry of result) {
      const source = byClientId.get(entry.sourceClientId)
      if (!source) continue
      if (entry.clientId) {
        nextPages.push({ ...source, rotation: entry.rotation })
        continue
      }
      const newClientId = await clonePageResources(entry.sourceClientId)
      if (!newClientId) continue
      nextPages.push({
        clientId: newClientId,
        originalPage: source.originalPage,
        width: source.width,
        height: source.height,
        rotation: entry.rotation,
      })
    }

    if (nextPages.length === 0) return
    setEditorPages(nextPages)
    releasePages(removed)
  }

  // ── Text editing ─────────────────────────────────────────────────────────────

  function beginEditText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const bg = canvas && pageInfo ? sampleBackgroundColor(canvas, hotspot.bbox, pageInfo.width) : "#ffffff"
    setEditingHotspotId(hotspot.id)
    setEditingValue(hotspot.text)
    setEditingBackground(bg)
    // Reset rather than reuse stale state from whatever was open before —
    // the real patch loads asynchronously below, and the sampled `bg` above
    // is what the preview shows in the meantime.
    setEditingCleanPatch(null)
    void loadCleanPatchForEditing(hotspot)
  }

  /**
   * Fetches (or reuses the cache from) the document's REAL background
   * behind `hotspot`, decodes it, and — only if the edit modal is still
   * open on this SAME hotspot once that's done — makes it the live
   * preview's background, in place of the sampled flat colour.
   *
   * Reuses cleanPatchCacheRef, the exact same cache drawTextEditOnCanvas
   * reads at Save time, so opening the modal and then saving never fetches
   * the same patch twice.
   */
  async function loadCleanPatchForEditing(hotspot: PdfTextHotspot) {
    if (!session) return
    let patch = cleanPatchCacheRef.current[hotspot.id]
    if (patch === undefined) {
      try {
        patch = await fetchPdfMasterCleanPatch(session.session_id, hotspot.originalId)
      } catch {
        patch = null
      }
      cleanPatchCacheRef.current[hotspot.id] = patch
    }
    // The modal may have been closed, or reopened on a DIFFERENT hotspot,
    // while the request above was in flight — applying this result then
    // would paint the wrong hotspot's background into whatever is open now.
    if (editingHotspotIdRef.current !== hotspot.id) return
    if (!patch?.patch || patch.rect.length !== 4) {
      setEditingCleanPatch(null)
      return
    }
    const img = await loadImageFromBase64Png(patch.patch)
    if (editingHotspotIdRef.current !== hotspot.id) return // same race, after the decode too
    setEditingCleanPatch({ img, rect: patch.rect as [number, number, number, number] })
  }

  /** Close the edit modal WITHOUT saving — Cancel button, Escape, or a click
   * outside the dialog (all routed through the Dialog's onOpenChange). */
  function cancelEditText() {
    setEditingHotspotId(null)
    setEditingCleanPatch(null)
  }

  /** Lay out `text` inside `hotspot` using the document's own typeface —
   * the ONE place per edit this is decided (see PdfTextRenderPlan), so the
   * page canvas, the modal preview and the pending-edit record all read the
   * same answer instead of each asking the question themselves. The
   * fallback check runs here against `text` — the text actually being laid
   * out — never against `hotspot.text`, which may already be stale by the
   * time a caller reaches for it. */
  const fitForHotspot = useCallback((hotspot: PdfTextHotspot, text: string): PdfTextRenderPlan => {
    const useFallbackFont = hotspotNeedsFallbackFont(hotspot, text)
    return fitText(
      text,
      {
        fontId: hotspot.fontId,
        bold: hotspot.bold,
        italic: hotspot.italic,
        size: hotspot.size,
        align: hotspot.align,
        boxWidthPts: hotspot.bbox[2] - hotspot.bbox[0],
        boxHeightPts: hotspot.bbox[3] - hotspot.bbox[1],
        lineHeightPts: effectiveLineHeight(hotspot),
      },
      // Session STATE, not sessionIdRef: this runs during render (to lay out
      // whatever is currently typed), and a ref read there can go stale
      // without re-rendering.
      session?.session_id ?? null,
      availableFontIds,
      autoFit,
      useFallbackFont,
    )
  }, [session, availableFontIds, autoFit, hotspotNeedsFallbackFont])

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

  /** Recompute and store (or clear) how tall a paragraph's box should visually
   * look after an edit — based on what the NEW text actually wraps into, not
   * the original hotspot's bbox. Purely cosmetic: the cover/redaction area
   * used to hide the OLD content always stays the full original bbox
   * regardless of this (see hotspotVisualHeightPts's declaration). */
  function updateHotspotVisualHeight(hotspot: PdfHotspot, plan: PdfTextRenderPlan) {
    if (hotspot.type !== "text") return
    if (plan.lines.length === 0) {
      setHotspotVisualHeightPts((prev) => {
        if (!(hotspot.id in prev)) return prev
        const next = { ...prev }
        delete next[hotspot.id]
        return next
      })
      return
    }
    setHotspotVisualHeightPts((prev) => ({ ...prev, [hotspot.id]: plan.heightPts }))
  }

  /** Save — the modal's Save button (or Ctrl/Cmd+Enter) is now the ONLY path
   * that reaches this function; there's no implicit blur-commits-your-edit
   * behavior anymore, so no double-commit guard is needed either. */
  function commitEditText() {
    const hotspot = editingHotspotId ? hotspots[editingHotspotId] : null
    if (!hotspot || hotspot.type !== "text" || !session) {
      setEditingHotspotId(null)
      return
    }

    const newText = editingValue
    setEditingHotspotId(null)
    setEditingCleanPatch(null)
    if (newText === hotspot.text) return

    // The plan is computed ONCE here and reused for everything: drawn on
    // the page canvas, stored for the box's visual height, and sent to the
    // server as the exact lines/size to draw. That's what makes the export
    // reproduce what was previewed instead of being re-wrapped independently.
    const plan = fitForHotspot(hotspot, newText)

    // No server round-trip — just draw it and remember it for Download.
    void drawTextEditOnCanvas(hotspot, plan, editingBackground)
    pendingEditsRef.current[hotspot.id] = {
      hotspotId: hotspot.id,
      originalHotspotId: hotspot.originalId,
      type: "text",
      value: newText,
      lines: plan.lines,
      fontSize: plan.fontSize,
      // Frontend-only, not sent to the server yet (see
      // applyPdfMasterEditsAndExport's explicit field list) — kept so the
      // decision this plan already made isn't lost if something needs it
      // again before the backend is taught to accept it directly.
      lineHeight: plan.lineHeight,
      direction: plan.direction,
      align: plan.align,
      useFallbackFont: plan.useFallbackFont,
    }
    setHotspots((prev) => ({
      ...prev,
      // rtl updates to match the NEW text's own direction (see
      // pdfTextFit.ts's detectTextDirection) — replacing English with
      // Hebrew (or the reverse) must not leave the hotspot's stored
      // direction describing text that's no longer there, so a later
      // re-open starts from the right direction too.
      [hotspot.id]: { ...hotspot, text: newText, rtl: plan.direction === "rtl" },
    }))
    markHotspotRemoved(hotspot.id, newText.trim() === "")
    updateHotspotVisualHeight(hotspot, plan)
  }

  /** Clear a text hotspot straight from its "✕" button — same result as
   * opening it, deleting everything, and committing, without the detour. */
  function removeText(hotspot: PdfHotspot) {
    if (hotspot.type !== "text" || busyHotspotId) return
    const canvas = canvasRefs.current[ownerClientId(hotspot.id)]
    const pageInfo = session?.pages.find((p) => p.page === hotspot.page)
    const bg = canvas && pageInfo ? sampleBackgroundColor(canvas, hotspot.bbox, pageInfo.width) : "#ffffff"

    const plan = fitForHotspot(hotspot, "")
    void drawTextEditOnCanvas(hotspot, plan, bg)
    pendingEditsRef.current[hotspot.id] = {
      hotspotId: hotspot.id,
      originalHotspotId: hotspot.originalId,
      type: "text",
      value: "",
    }
    setHotspots((prev) => ({ ...prev, [hotspot.id]: { ...hotspot, text: "", rtl: plan.direction === "rtl" } }))
    markHotspotRemoved(hotspot.id, true)
    updateHotspotVisualHeight(hotspot, plan)
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
    const forOverlay = pendingOverlayUpload.current
    e.target.value = ""
    pendingImageHotspotId.current = null
    pendingOverlayUpload.current = false

    // Same <input> serves both "replace this image slot" and "add a new
    // image anywhere" — which one is decided by whichever flag was set
    // before it was opened.
    if (forOverlay) {
      if (!file) return
      const prepared = await prepareUpload(file)
      if (prepared) await addImageOverlay(prepared)
      return
    }
    if (!file || !hotspotId || !session) return
    const hotspot = hotspots[hotspotId]
    if (!hotspot) return

    setBusyHotspotId(hotspotId)
    try {
      const prepared = await prepareUpload(file)
      if (!prepared) return
      // No server round-trip — just draw it and remember it for Download.
      await drawImageEditOnCanvas(hotspot, prepared)
      pendingEditsRef.current[hotspotId] = {
        hotspotId,
        originalHotspotId: hotspot.originalId,
        type: "image",
        file: prepared,
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
        // Applied by the server AFTER this page's edits, since rotation is a
        // page attribute rather than a redraw — so every edit keeps the
        // coordinates it was made in and the turn is the last thing to happen.
        rotation: p.rotation,
        edits: Object.values(pendingEditsRef.current).filter((e) => ownerClientId(e.hotspotId) === p.clientId),
        overlays: overlays.filter((o) => o.pageClientId === p.clientId),
      }))
      const result = await applyPdfMasterEditsAndExport(session.session_id, pagePlan, overlayFilesRef.current)

      // Force the type. A Blob built without one gets an empty MIME type,
      // and a browser handed a typeless blob can refuse to save it or save
      // it under the wrong extension.
      const blob = result instanceof Blob
        ? new Blob([result], { type: "application/pdf" })
        : new Blob([result as BlobPart], { type: "application/pdf" })

      if (blob.size === 0) throw new Error(t("pdfTemplates.masterEmptyExport"))

      // A template name can carry anything a person typed — slashes, colons,
      // quotes — none of which are legal in a filename, and a browser given
      // an illegal one can silently drop the download instead of saving it.
      const safeName = (template.name || "document").replace(/[^\w.\-֐-׿ ]+/g, "_").trim() || "document"

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${safeName}.pdf`
      a.rel = "noopener"
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Deliberately NOT revoked on the next line. Revoking straight after
      // click() destroys the blob before the browser has finished reading
      // it, and the download then fails silently — no error, no file, just
      // nothing. The bigger the document the more reliably that race is
      // lost, which is why this only started showing up as exports grew
      // past a few megabytes. The delay costs a little memory until it
      // fires; a download that doesn't happen costs the whole feature.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
  // Narrowed to the text variant specifically — beginEditText only ever sets
  // editingHotspotId for a text hotspot (it bails out early otherwise), so
  // this is always non-null-or-text at runtime; the narrowing here is just
  // to give TypeScript that same guarantee for the .rtl/.text access below.
  const editingHotspotRaw = editingHotspotId ? hotspots[editingHotspotId] : null
  const editingHotspot = editingHotspotRaw?.type === "text" ? editingHotspotRaw : null
  // The single render decision for whatever is CURRENTLY typed — layout,
  // font-fallback, direction and alignment together (see
  // PdfTextRenderPlan). This replaced a character cap (new.length <=
  // old.length), which was the wrong unit entirely: a box cares about
  // WIDTH, and "WWWWW" is roughly three times the width of "iiiii" at the
  // same character count — so the cap simultaneously blocked edits that
  // would have fit and allowed ones that couldn't. Measuring the real thing
  // is both more permissive and more accurate. Every other place that needs
  // any of these answers (the textarea's dir/align, the live preview, the
  // hotspot outline's overflow state) reads THIS object rather than asking
  // its own version of the same question.
  const editingPlan = editingHotspot ? fitForHotspot(editingHotspot, editingValue) : null
  // The face genuinely used for this box. When the document's own font isn't
  // available the preview is an approximation, and saying so is better than
  // quietly showing something that won't match the export.
  const editingUsesRealFont = !editingPlan?.useFallbackFont

  // The current document, as the organizer needs to see it. Every entry
  // starts out as a real page (clientId set); the dialog may add entries
  // with a null clientId, which applyOrganizer then materialises into real
  // copies.
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId) ?? null

  const organizerPages: OrganizerPage[] = editorPages.map((p) => ({
    key: p.clientId,
    clientId: p.clientId,
    sourceClientId: p.clientId,
    rotation: p.rotation,
  }))


  return (
    <div className="-m-6 flex flex-col" style={{ minHeight: "calc(100vh - 57px)" }}>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onImageFileSelected(e)} />

      <header ref={headerRef} className="sticky z-20 flex items-center gap-3 border-b bg-background/90 px-5 py-3 backdrop-blur-md" style={{ top: 57 }}>
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
            {/* Fixed colors, not bg-muted/bg-primary: this sits on the fixed
                #EEECE6 above (the page-preview area always reads as light
                paper, independent of app theme — see its own hardcoded
                background), but bg-primary flips to near-white in dark mode
                (correct for the app's own dark surfaces) — placed here
                instead it would wash out to invisible against this same
                light backdrop. Same reasoning as TEXT_OUTLINE/IMAGE_OUTLINE
                above being fixed rgba rather than theme classes. Fill color
                is --primary's own LIGHT-mode value (rgb(23,23,23), see
                index.css), hardcoded — the same near-black the rest of the
                app's primary actions (e.g. the Download PDF button) use in
                light mode, so this reads as "the" emphasis color rather than
                an unrelated accent hue. */}
            <div className="h-1.5 w-64 max-w-[70vw] overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.1)" }}>
              {/* width, not transform: this updates in small, frequent steps
                  (poll ticks, byte-progress events) rather than one big jump,
                  so a transform-based approach would fight itself restarting
                  mid-transition on every step instead of just growing. */}
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{ width: `${loadProgress}%`, background: "rgb(23,23,23)" }}
              />
            </div>
            <p className="text-sm" style={{ color: "rgba(0,0,0,0.55)" }}>
              {t("pdfTemplates.masterLoading", { percent: Math.round(loadProgress) })}
            </p>
          </div>
        )}

        {!isLoading && loadError && (
          // Fixed colors here too, same reasoning as the loading state above:
          // text-destructive/text-muted-foreground are tuned for the app's
          // own dark surfaces in dark mode and wash out against this area's
          // fixed light background.
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <p className="text-sm" style={{ color: "rgb(185,28,28)" }}>{t("common.error")}</p>
            <p className="max-w-md text-xs" style={{ color: "rgba(0,0,0,0.55)" }}>{loadError}</p>
          </div>
        )}

        {!isLoading && !loadError &&
          editorPages.map((ep) => {
            const pageState = pageStates.find((ps) => ps.page === ep.clientId)
            // Hotspot positions stay in this "natural" (unscaled,
            // PAPER_TARGET_WIDTH-wide) coordinate space — the whole
            // subtree (canvas + overlays) is shrunk together below via a
            // single CSS transform, so this math never needs to change.
            const scale = pageState ? pageState.cssWidth / ep.width : PAPER_TARGET_WIDTH / ep.width
            const pageHotspots = hotspotList.filter((h) => ownerClientId(h.id) === ep.clientId)

            const naturalWidth = pageState?.cssWidth ?? PAPER_TARGET_WIDTH
            const naturalHeight = pageState?.cssHeight ?? naturalWidth * (ep.height / ep.width)
            // Same gutter renderPage rendered this page's native resolution
            // against, so this normally comes out to ~1 (no extra shrink
            // needed) rather than the page having been sized for one gutter
            // and then measured against a different one here. Never
            // upscales past native raster resolution (would blur) — only
            // ever shrinks further, if the container's gotten narrower since.
            const displayScale = containerWidth ? Math.min(1, (containerWidth - PAGE_SIDE_GUTTER_PX) / naturalWidth) : 1

            // A quarter-turned page occupies a box with its width and height
            // swapped, so the slot it sits in has to swap too — otherwise a
            // rotated landscape page overlaps its neighbours.
            const isQuarterTurned = ep.rotation === 90 || ep.rotation === 270
            const slotWidth = (isQuarterTurned ? naturalHeight : naturalWidth) * displayScale
            const slotHeight = (isQuarterTurned ? naturalWidth : naturalHeight) * displayScale

            return (
              <div
                key={ep.clientId}
                // Flex-centred so the rotate/scale transform below can pivot
                // about the page's own centre. Rotating about a corner (the
                // top-left origin this used before rotation existed) would
                // swing the page clean out of its slot.
                className="mx-auto my-3 flex items-center justify-center"
                style={{ width: slotWidth, height: slotHeight }}
              >
                <div
                  className="relative shrink-0 overflow-hidden rounded-sm bg-white"
                  style={{
                    width: naturalWidth,
                    height: naturalHeight,
                    transform: `rotate(${ep.rotation}deg) scale(${displayScale})`,
                    transformOrigin: "center",
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
                    const isText = h.type === "text"
                    // Text tool off: text hotspots don't render at all (not
                    // just de-prioritized), so any click in this area can
                    // only ever reach an image hotspot underneath, with no
                    // invisible text box stealing it.
                    if (isText && contentMode !== "text") return null
                    const isBusy = busyHotspotId === h.id
                    const isEditing = editingHotspotId === h.id
                    // Once cleared via "✕", a slot goes permanently inert
                    // for the rest of this session — no click, no re-upload,
                    // no re-typing, and its overlay (border/tint/buttons)
                    // disappears entirely, so it behaves and looks like
                    // genuinely empty space rather than an editable box that
                    // merely happens to be empty right now.
                    const isRemoved = removedHotspotIds.has(h.id)

                    // A paragraph's box visually tracks what its last
                    // COMMITTED content actually needs — shrinks toward
                    // fewer lines, grows (and flags as overflowing) past
                    // its original space — instead of always showing the
                    // full original area. Purely cosmetic: h.bbox itself
                    // (the cover/redaction area, and what future
                    // re-edits/removal target) never changes because of
                    // this.
                    //
                    // Deliberately NOT applied while isEditing: hiding the
                    // OLD content only happens once, at commit time (see
                    // drawTextEditOnCanvas, called from commitEditText) —
                    // the canvas still shows the untouched original
                    // underneath for as long as the edit modal is open. If
                    // the box itself shrank live to match what's been typed
                    // so far, that uncovered original would show through
                    // below it. So while editing, the box stays at its full
                    // original size exactly as it always did — only the
                    // border reacts live (see isEditing below: solid
                    // instead of dashed), as an early "this won't fit"
                    // signal, without the box changing size until commit.
                    const originalHeightPts = h.bbox[3] - h.bbox[1]
                    let effectiveHeightPts = originalHeightPts
                    let isOverflowing = false
                    if (isText) {
                      if (isEditing) {
                        // Reuses the live fit already computed for the modal
                        // rather than measuring again — one verdict, so the
                        // box outline and the modal can never disagree about
                        // whether the current text fits.
                        isOverflowing = editingPlan?.overflows ?? false
                      } else {
                        const stored = hotspotVisualHeightPts[h.id]
                        if (stored != null) effectiveHeightPts = stored
                        isOverflowing = effectiveHeightPts > originalHeightPts + 0.5
                      }
                    }
                    const height = effectiveHeightPts * scale

                    return (
                      <div
                        key={h.id}
                        title={isOverflowing ? t("pdfTemplates.masterTextOverflow") : undefined}
                        // "group" so the ✕ button (and, for images, the
                        // upload icon) can stay hidden until this specific
                        // box is hovered — with paragraph-level boxes now
                        // far bigger than a single line, a permanently
                        // visible ✕ per box is no longer the clutter it
                        // was, but hover-only keeps the page readable when
                        // scanning it without editing anything.
                        className="group"
                        role={isRemoved || isEditing ? undefined : "button"}
                        tabIndex={isRemoved || isEditing ? undefined : 0}
                        // Disabled while isEditing as a second line of
                        // defense — the textarea below also stops its own
                        // click/keydown from bubbling here, but a hotspot
                        // this large (a whole paragraph, not one line) is
                        // exactly the box the user is clicking/typing
                        // *inside of* while editing, so this can't rely on
                        // the event-stopping alone.
                        onClick={isRemoved || isEditing ? undefined : () => (isText ? beginEditText(h) : beginEditImage(h))}
                        onKeyDown={isRemoved || isEditing ? undefined : (e) => {
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
                          // Text always paints (and is clicked) above an
                          // overlapping image — with no z-index at all here
                          // before, DOM order (images appended after text
                          // per page, see pdf_editor.py's _extract_hotspots)
                          // silently made every overlapping image win the
                          // click, which is exactly what made text sitting
                          // on top of a background image unreachable.
                          zIndex: isText ? 2 : 1,
                          cursor: isRemoved ? "default" : isBusy ? "wait" : "pointer",
                          // Editing this hotspot no longer means "an inline
                          // textarea lives inside this box" (that's the edit
                          // modal's job now) — a solid, thicker border is the
                          // only thing marking it as "the one currently open
                          // in the modal" while it stays visible behind the
                          // dialog overlay.
                          border: isRemoved
                            ? "none"
                            : `${isEditing ? "2.5px solid" : "1.5px dashed"} ${isText ? (isOverflowing ? TEXT_OVERFLOW_OUTLINE : TEXT_OUTLINE) : IMAGE_OUTLINE}`,
                          background: isRemoved
                            ? "transparent"
                            : isText ? (isOverflowing ? TEXT_OVERFLOW_OUTLINE_BG : TEXT_OUTLINE_BG) : IMAGE_OUTLINE_BG,
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
                              className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-destructive"
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
                            className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-destructive"
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Items the user added, drawn above every hotspot (see
                      PdfOverlayItem's z-index) so a new item is always
                      reachable rather than trapped behind a region of the
                      original document. */}
                  {overlays
                    .filter((o) => o.pageClientId === ep.clientId)
                    .map((o) => (
                      <PdfOverlayItem
                        key={o.id}
                        overlay={o}
                        scale={scale}
                        isSelected={selectedOverlayId === o.id}
                        isEditing={editingOverlayId === o.id}
                        onSelect={() => {
                          setSelectedOverlayId(o.id)
                          // Selecting a DIFFERENT item closes whatever was
                          // being typed in, so two boxes are never in edit
                          // mode at once.
                          setEditingOverlayId((prev) => (prev === o.id ? prev : null))
                        }}
                        onStartEdit={() => setEditingOverlayId(o.id)}
                        onEndEdit={() => setEditingOverlayId((prev) => (prev === o.id ? null : prev))}
                        onChange={(patch) => updateOverlay(o.id, patch)}
                        onRemove={() => removeOverlay(o.id)}
                        fontFamily={
                          o.type === "text" && o.fontId && availableFontIds.has(o.fontId)
                            ? pdfFontFamily(session?.session_id ?? "", o.fontId)
                            : FALLBACK_FONT_STACK
                        }
                      />
                    ))}
                </div>
              </div>
            )
          })}

        <div className="h-12" />
      </div>

      {!isLoading && !loadError && (
        <PdfEditorRail
          top={railTop}
          contentMode={contentMode}
          onToggleContentMode={() => {
            if (editingHotspotId) cancelEditText()
            setContentMode((prev) => (prev === "text" ? "images" : "text"))
          }}
          onOpenOrganizer={openOrganizer}
          onAddText={addTextOverlay}
          onAddImage={() => {
            pendingOverlayUpload.current = true
            fileInputRef.current?.click()
          }}
        />
      )}

      {/* Properties for the selected added item. Nothing is shown when
          nothing is selected, so the bar never sits there taking up room
          against a document you're only reading. */}
      {selectedOverlay && !isLoading && !loadError && (
        <PdfOverlayToolbar
          top={railTop}
          overlay={selectedOverlay}
          fonts={sessionFonts}
          availableFontIds={availableFontIds}
          onChange={(patch) => updateOverlay(selectedOverlay.id, patch)}
          onRemove={() => removeOverlay(selectedOverlay.id)}
        />
      )}

      {/* Page organizer — one dialog, but opened for exactly one job at a
          time (see PdfOrganizerMode). Nothing it does touches the document
          until Done, so Cancel genuinely undoes the whole session. */}
      {organizerMode && (
        <PdfPageOrganizer
          // Keyed by mode so switching tools remounts it with a clean draft
          // and empty history — a previous session's changes can never leak
          // into the next one.
          key={organizerMode}
          mode={organizerMode}
          pages={organizerPages}
          thumbnails={pageThumbnails}
          onApply={(result) => void applyOrganizer(result)}
          onCancel={() => setOrganizerMode(null)}
        />
      )}

      {/* Text-edit modal — replaces the old inline textarea nested inside
          the hotspot overlay box. That approach relied on onBlur to save,
          which meant clicking ANY other element (another hotspot, a
          toolbar button, even the scrollbar) silently committed whatever
          was typed so far — plus a guard ref to stop Enter/Escape's own
          unmount from double-firing that same onBlur. Saving here only
          ever happens from the Save button (or Ctrl/Cmd+Enter) below, so
          there's no implicit-commit path left to misfire, and no guard
          needed. The hotspot itself stays visible (solid-bordered, see
          isEditing above) behind the dialog overlay the whole time. */}
      <Dialog
        open={editingHotspotId !== null}
        onOpenChange={(open) => { if (!open) cancelEditText() }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={(e) => {
            // Radix would otherwise focus the dialog's first focusable
            // element (Cancel) — redirect straight to the textarea so
            // typing can start immediately.
            e.preventDefault()
            textareaRef.current?.focus()
            textareaRef.current?.select()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pdfTemplates.masterEditTextTitle")}</DialogTitle>
          </DialogHeader>

          <Textarea
            ref={textareaRef}
            // Direction/alignment follow whatever is CURRENTLY typed (see
            // editingPlan, derived fresh from editingValue on every
            // keystroke) — not the hotspot's original PDF direction, which
            // describes text that may no longer be there. Typing Hebrew
            // over an English original flips this immediately, and back
            // again if it's typed back over.
            dir={editingPlan?.direction ?? "ltr"}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                commitEditText()
              }
              // Plain Enter/Shift+Enter both just insert a newline (the
              // textarea's own default) — unlike the old inline editor,
              // there's no "plain Enter saves" special case here, since a
              // modal's whole point is that saving is an explicit,
              // unambiguous action.
            }}
            className="max-h-40 min-h-24 overflow-y-auto text-base"
            style={{ textAlign: editingPlan?.align ?? "left" }}
          />

          {/* Live preview — the replacement drawn in the document's real
              typeface, at its real size and line spacing, inside its real
              box. This is what the exported PDF will contain; nothing here
              is an approximation of it. Seeing the result while typing is
              what the image-replacement flow already gets right and what a
              bare textarea + character counter never could. */}
          {editingHotspot && editingPlan && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("pdfTemplates.masterEditTextPreview")}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={autoFit}
                    onChange={(e) => setAutoFit(e.target.checked)}
                    className="size-3.5 accent-current"
                  />
                  {t("pdfTemplates.masterEditTextAutoFit")}
                </label>
              </div>

              <PdfTextPreview
                hotspot={editingHotspot}
                plan={editingPlan}
                sessionId={session?.session_id ?? null}
                availableFontIds={availableFontIds}
                background={editingBackground}
                backgroundPatch={editingCleanPatch}
              />

              {/* Real fit feedback, in the units that actually matter —
                  lines and size — instead of a character count that
                  correlates poorly with whether anything fits. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">
                  {t("pdfTemplates.masterEditTextLines", { count: editingPlan.lines.length })}
                </span>
                {editingPlan.shrunk && !editingPlan.overflows && (
                  <span className="text-muted-foreground">
                    {t("pdfTemplates.masterEditTextShrunk", {
                      percent: Math.round((editingPlan.fontSize / editingHotspot.size) * 100),
                    })}
                  </span>
                )}
                {editingPlan.overflows && (
                  <span className="font-medium text-destructive">
                    {t("pdfTemplates.masterEditTextOverflows")}
                  </span>
                )}
                {!editingUsesRealFont && (
                  <span className="text-amber-600 dark:text-amber-500">
                    {t("pdfTemplates.masterEditTextFallbackFont")}
                  </span>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelEditText}>
              {t("common.cancel")}
            </Button>
            {/* Never disabled on overflow any more: overflowing is now a
                visible, understood state (you can see exactly how far past
                the box it runs) rather than an invisible rule blocking the
                save. Blocking it was the old character cap's job, and that
                cap was measuring the wrong thing in the first place. */}
            <Button type="button" onClick={commitEditText}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
