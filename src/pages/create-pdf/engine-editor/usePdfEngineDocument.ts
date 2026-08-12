import { useCallback, useEffect, useRef, useState } from "react"

import {
  PdfEngineClient,
  type EnginePage,
  type EngineTextLine,
  type EditTextOptions,
} from "@/lib/pdf-engine"
import { fetchPdfMasterTemplateSource } from "@/features/pdfTemplates/api"

/**
 * Owns one PDF editing session: the worker, the open document, and the
 * per-page text lines the UI draws boxes for.
 *
 * The engine runs in a Web Worker, so every operation here is async. That
 * is the point — editing a full catalogue is over a second of CPU, and on
 * the main thread that would freeze the page.
 *
 * The worker is created once per mount and terminated on unmount. Without
 * that, navigating away would leave a worker holding a multi-megabyte
 * document in WASM memory for the life of the tab.
 */

export type LoadPhase = "idle" | "downloading" | "opening" | "ready" | "error"

export interface PageTextState {
  /** Text lines as the engine currently sees them. Re-fetched after every
   * edit, because editing a line renumbers the list. */
  lines: EngineTextLine[]
  loaded: boolean
}

export interface UsePdfEngineDocumentResult {
  phase: LoadPhase
  error: string | null
  /** Percent 0-100 while downloading, null otherwise. */
  downloadPercent: number | null
  pages: EnginePage[]
  docId: string | null
  /** Text lines per page index, loaded lazily as pages come into view. */
  pageText: Record<number, PageTextState>
  loadPageText: (pageIndex: number) => Promise<void>
  renderPage: (pageIndex: number, scale: number) => Promise<{ width: number; height: number; rgba: ArrayBuffer } | null>
  editText: (pageIndex: number, lineIndex: number, newText: string, options?: EditTextOptions) => Promise<void>
  save: () => Promise<Blob>
  /** True while any mutating operation is in flight. */
  busy: boolean
  /** Bumped whenever the document changes, so canvases know to repaint. */
  revision: number
}

/**
 * @param templateId Loads that template's source PDF through the API. Not
 * the raw R2 URL: those objects are served without CORS headers, so a
 * direct browser fetch is blocked (and the API route additionally requires
 * a logged-in user).
 */
export function usePdfEngineDocument(templateId: string | null | undefined): UsePdfEngineDocumentResult {
  const engineRef = useRef<PdfEngineClient | null>(null)
  const docIdRef = useRef<string | null>(null)

  const [phase, setPhase] = useState<LoadPhase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null)
  const [pages, setPages] = useState<EnginePage[]>([])
  const [docId, setDocId] = useState<string | null>(null)
  const [pageText, setPageText] = useState<Record<number, PageTextState>>({})
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)

  // One worker per mount. Created lazily so a page that never loads a PDF
  // never spins one up.
  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new PdfEngineClient()
    return engineRef.current
  }, [])

  useEffect(() => {
    return () => {
      engineRef.current?.terminate()
      engineRef.current = null
      docIdRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!templateId) return
    let cancelled = false

    const load = async () => {
      setPhase("downloading")
      setError(null)
      setDownloadPercent(0)
      try {
        // Progress is reported as it streams, so a 9MB catalogue on a slow
        // connection shows a real percentage rather than an idle spinner.
        const bytes = await fetchPdfMasterTemplateSource(templateId, (progress) => {
          if (cancelled || !progress.total) return
          setDownloadPercent(Math.round((progress.loaded / progress.total) * 100))
        })
        if (cancelled) return

        setDownloadPercent(100)
        setPhase("opening")
        const engine = getEngine()
        const opened = await engine.open(bytes)
        if (cancelled) return

        docIdRef.current = opened.docId
        setDocId(opened.docId)
        setPages(opened.pages)
        setPageText({})
        setPhase("ready")
        setRevision((r) => r + 1)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase("error")
      } finally {
        if (!cancelled) setDownloadPercent(null)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [templateId, getEngine])

  const loadPageText = useCallback(async (pageIndex: number) => {
    const id = docIdRef.current
    if (!id) return
    const { lines } = await getEngine().listTextLines(id, pageIndex)
    setPageText((prev) => ({ ...prev, [pageIndex]: { lines, loaded: true } }))
  }, [getEngine])

  const renderPage = useCallback(async (pageIndex: number, scale: number) => {
    const id = docIdRef.current
    if (!id) return null
    return getEngine().renderPage(id, pageIndex, scale)
  }, [getEngine])

  const editText = useCallback(async (
    pageIndex: number, lineIndex: number, newText: string, options?: EditTextOptions,
  ) => {
    const id = docIdRef.current
    if (!id) return
    setBusy(true)
    try {
      await getEngine().editTextLine(id, pageIndex, lineIndex, newText, options)
      // Editing splits or merges objects, so the line list for this page is
      // now stale — refresh it before anything can act on old indices.
      const { lines } = await getEngine().listTextLines(id, pageIndex)
      setPageText((prev) => ({ ...prev, [pageIndex]: { lines, loaded: true } }))
      setRevision((r) => r + 1)
    } finally {
      setBusy(false)
    }
  }, [getEngine])

  const save = useCallback(async () => {
    const id = docIdRef.current
    if (!id) throw new Error("No document is open")
    setBusy(true)
    try {
      const { bytes } = await getEngine().save(id)
      return new Blob([bytes], { type: "application/pdf" })
    } finally {
      setBusy(false)
    }
  }, [getEngine])

  return {
    phase, error, downloadPercent, pages, docId, pageText,
    loadPageText, renderPage, editText, save, busy, revision,
  }
}
