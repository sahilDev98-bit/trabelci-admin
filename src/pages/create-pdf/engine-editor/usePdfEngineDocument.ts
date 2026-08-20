import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  PdfEngineClient,
  type EnginePage,
  type EngineTextLine,
  type EngineImage,
  type EngineVectorGroup,
  type PdfRect,
  type EditTextOptions,
  type TextOverlayRequest,
  type ImageOverlayRequest,
  type PagePlanRequest,
} from "@/lib/pdf-engine"
import { fetchPdfMasterTemplateSource } from "@/features/pdfTemplates/api"

/**
 * Owns one PDF editing session: the worker, the open document, and the
 * per-page text/image lists the UI draws boxes for.
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

export interface PageVectorState {
  groups: EngineVectorGroup[]
  loaded: boolean
}

export interface PageImageState {
  images: EngineImage[]
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
  /** Image slots per page index, loaded lazily alongside the text. */
  pageImages: Record<number, PageImageState>
  loadPageText: (pageIndex: number) => Promise<void>
  loadPageImages: (pageIndex: number) => Promise<void>
  renderPage: (pageIndex: number, scale: number) => Promise<{ width: number; height: number; rgba: ArrayBuffer } | null>
  editText: (pageIndex: number, lineIndex: number, newText: string, options?: EditTextOptions) => Promise<void>
  removeText: (pageIndex: number, lineIndex: number) => Promise<void>
  /** Shift a line. dy is PDF-space, so positive moves it up the page. */
  /** All four movers resolve to the object's NEW index, or -1. */
  moveText: (pageIndex: number, lineIndex: number, dx: number, dy: number) => Promise<number>
  pageVectors: Record<number, PageVectorState>
  renderCleanPatch: (
    pageIndex: number, kind: "text" | "image", index: number, scale: number,
  ) => Promise<string | null>
  renderImagePreview: (pageIndex: number, imageIndex: number) => Promise<string | null>
  /** Raw pixels for one rectangle of a page, for patching a canvas. */
  renderPageRegion: (
    pageIndex: number, rect: PdfRect, scale: number,
  ) => Promise<{ width: number; height: number; rgba: ArrayBuffer; x: number; y: number } | null>
  /** The area the last edit touched, or null if the whole page must be
   * repainted. */
  lastChange: { pageIndex: number; rect: PdfRect; revision: number } | null
  loadPageVectors: (pageIndex: number) => Promise<void>
  removeVector: (pageIndex: number, vectorIndex: number) => Promise<void>
  styleText: (
    pageIndex: number, lineIndex: number,
    style: { bold: boolean; italic: boolean; color: { r: number; g: number; b: number } },
  ) => Promise<number>
  scaleText: (pageIndex: number, lineIndex: number, factor: number) => Promise<number>
  alignText: (
    pageIndex: number, lineIndex: number, alignment: "left" | "center" | "right",
  ) => Promise<number>
  transformImage: (
    pageIndex: number, imageIndex: number,
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => Promise<number>
  replaceVector: (pageIndex: number, vectorIndex: number, file: File) => Promise<void>
  moveTextToPage: (
    sourcePageIndex: number, lineIndex: number,
    targetPageIndex: number, x: number, yBaseline: number,
  ) => Promise<number>
  moveImageToPage: (
    sourcePageIndex: number, imageIndex: number,
    targetPageIndex: number, rect: { x: number; y: number; width: number; height: number },
  ) => Promise<number>
  replaceImage: (pageIndex: number, imageIndex: number, file: File) => Promise<void>
  removeImage: (pageIndex: number, imageIndex: number) => Promise<void>
  setImageRect: (
    pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => Promise<number>
  addTextOverlay: (pageIndex: number, overlay: TextOverlayRequest) => Promise<void>
  addImageOverlay: (
    pageIndex: number, overlay: ImageOverlayRequest, file: File,
  ) => Promise<number>
  applyPagePlan: (plan: PagePlanRequest[]) => Promise<void>
  save: () => Promise<Blob>
  /** True while any mutating operation is in flight. */
  busy: boolean
  /** Bumped whenever the document changes, so canvases know to repaint. */
  revision: number
}

/** PDFium accepts PNG and JPEG directly; anything else has to be converted
 * before it can be embedded. Done via canvas rather than rejected, so a
 * user picking a WebP or GIF logo still gets what they expect. */
async function toEmbeddableImage(file: File): Promise<{ bytes: ArrayBuffer; kind: "png" | "jpeg" }> {
  const type = file.type.toLowerCase()
  if (type === "image/png") return { bytes: await file.arrayBuffer(), kind: "png" }
  if (type === "image/jpeg" || type === "image/jpg") return { bytes: await file.arrayBuffer(), kind: "jpeg" }

  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not read that image")
    ctx.drawImage(bitmap, 0, 0)
    // PNG rather than JPEG: the source may have transparency (a cut-out
    // logo), and re-encoding that to JPEG would fill it with black.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!blob) throw new Error("Could not convert that image")
    return { bytes: await blob.arrayBuffer(), kind: "png" }
  } finally {
    bitmap.close()
  }
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
  const [pageImages, setPageImages] = useState<Record<number, PageImageState>>({})
  const [pageVectors, setPageVectors] = useState<Record<number, PageVectorState>>({})
  /**
   * The area the last edit touched, if it reported one.
   *
   * Carried so a page can repaint just that rectangle rather than the whole
   * page. Repainting a page at editing zoom costs 145-417ms against about
   * 7ms for the edit itself, which is the entire reason the editor felt
   * slow after every action.
   */
  const [lastChange, setLastChange] = useState<
    { pageIndex: number; rect: PdfRect; revision: number } | null
  >(null)
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
        setPageImages({})
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

  const loadPageVectors = useCallback(async (pageIndex: number) => {
    const id = docIdRef.current
    if (!id) return
    const { groups } = await getEngine().listVectorGroups(id, pageIndex)
    setPageVectors((prev) => ({ ...prev, [pageIndex]: { groups, loaded: true } }))
  }, [getEngine])

  const loadPageImages = useCallback(async (pageIndex: number) => {
    const id = docIdRef.current
    if (!id) return
    const { images } = await getEngine().listImages(id, pageIndex)
    setPageImages((prev) => ({ ...prev, [pageIndex]: { images, loaded: true } }))
  }, [getEngine])

  /**
   * A picture of a slot's area with the slot itself left out, as a data URL.
   *
   * Used to make the spot a dragged object came from look genuinely empty.
   * Read-only as far as the caller is concerned — the engine puts the
   * document back before it answers.
   */
  const renderCleanPatch = useCallback(async (
    pageIndex: number, kind: "text" | "image", index: number, scale: number,
  ): Promise<string | null> => {
    const id = docIdRef.current
    if (!id) return null
    const patch = await getEngine().renderCleanPatch(id, pageIndex, kind, index, scale)
    if (!patch.width || !patch.height) return null
    const canvas = document.createElement("canvas")
    canvas.width = patch.width
    canvas.height = patch.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    const image = ctx.createImageData(patch.width, patch.height)
    image.data.set(new Uint8ClampedArray(patch.rgba))
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL("image/png")
  }, [getEngine])

  /** One image on its own, as a data URL — its clip and transparency
   * included, and nothing that happens to be drawn over it. */
  const renderImagePreview = useCallback(async (
    pageIndex: number, imageIndex: number,
  ): Promise<string | null> => {
    const id = docIdRef.current
    if (!id) return null
    const shot = await getEngine().renderImagePreview(id, pageIndex, imageIndex)
    if (!shot.width || !shot.height) return null
    const canvas = document.createElement("canvas")
    canvas.width = shot.width
    canvas.height = shot.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    const image = ctx.createImageData(shot.width, shot.height)
    image.data.set(new Uint8ClampedArray(shot.rgba))
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL("image/png")
  }, [getEngine])

  const renderPageRegion = useCallback(async (
    pageIndex: number, rect: PdfRect, scale: number,
  ) => {
    const id = docIdRef.current
    if (!id) return null
    return getEngine().renderPageRegion(id, pageIndex, rect, scale)
  }, [getEngine])

  const renderPage = useCallback(async (pageIndex: number, scale: number) => {
    const id = docIdRef.current
    if (!id) return null
    return getEngine().renderPage(id, pageIndex, scale)
  }, [getEngine])

  /** Runs a mutation, then refreshes the affected pages' slot lists.
   * Centralised because every mutation invalidates them the same way:
   * adding or removing objects renumbers everything after it, so acting on
   * a stale index afterwards would edit the wrong thing.
   *
   * Takes a LIST of pages because a cross-page move dirties two of them —
   * refreshing only the target would leave the source still showing a box
   * for content that has left it. */
  const mutate = useCallback(async <T,>(
    pageIndexes: number | number[], run: (id: string) => Promise<T>,
  ): Promise<T | undefined> => {
    const id = docIdRef.current
    if (!id) return undefined
    const pages = [...new Set(Array.isArray(pageIndexes) ? pageIndexes : [pageIndexes])]
    setBusy(true)
    try {
      const result = await run(id)
      const refreshed = await Promise.all(pages.map(async (pageIndex) => {
        const [{ lines }, { images }, { groups }] = await Promise.all([
          getEngine().listTextLines(id, pageIndex),
          getEngine().listImages(id, pageIndex),
          getEngine().listVectorGroups(id, pageIndex),
        ])
        return { pageIndex, lines, images, groups }
      }))
      setPageText((prev) => {
        const next = { ...prev }
        for (const r of refreshed) next[r.pageIndex] = { lines: r.lines, loaded: true }
        return next
      })
      setPageImages((prev) => {
        const next = { ...prev }
        for (const r of refreshed) next[r.pageIndex] = { images: r.images, loaded: true }
        return next
      })
      setPageVectors((prev) => {
        const next = { ...prev }
        for (const r of refreshed) next[r.pageIndex] = { groups: r.groups, loaded: true }
        return next
      })
      // A change that reported the area it touched, and touched only ONE
      // page, can be patched instead of fully repainted. Anything else
      // (a cross-page move, an operation with no reported area) falls back
      // to a full repaint, which is always correct if slower.
      const changed = (result as { changedRect?: PdfRect } | undefined)?.changedRect
      setRevision((r) => {
        const next = r + 1
        setLastChange(changed && pages.length === 1
          ? { pageIndex: pages[0], rect: changed, revision: next }
          : null)
        return next
      })
      return result
    } finally {
      setBusy(false)
    }
  }, [getEngine])

  const editText = useCallback(async (
    pageIndex: number, lineIndex: number, newText: string, options?: EditTextOptions,
  ) => {
    await mutate(pageIndex, (id) => getEngine().editTextLine(id, pageIndex, lineIndex, newText, options).then(() => undefined))
  }, [getEngine, mutate])

  /** Bold / italic / colour, applied without rebuilding the text — so the
   * document's own typeface survives. Resolves to the line's new index. */
  const styleText = useCallback(async (
    pageIndex: number, lineIndex: number,
    style: { bold: boolean; italic: boolean; color: { r: number; g: number; b: number } },
  ) => {
    const r = await mutate(pageIndex, (id) => getEngine().styleTextLine(id, pageIndex, lineIndex, style))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const scaleText = useCallback(async (pageIndex: number, lineIndex: number, factor: number) => {
    const r = await mutate(pageIndex, (id) => getEngine().scaleTextLine(id, pageIndex, lineIndex, factor))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const alignText = useCallback(async (
    pageIndex: number, lineIndex: number, alignment: "left" | "center" | "right",
  ) => {
    const r = await mutate(pageIndex, (id) => getEngine().alignTextLine(id, pageIndex, lineIndex, alignment))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const transformImage = useCallback(async (
    pageIndex: number, imageIndex: number,
    op: "rotate-left" | "rotate-right" | "flip-horizontal" | "flip-vertical",
  ) => {
    const r = await mutate(pageIndex, (id) => getEngine().transformImage(id, pageIndex, imageIndex, op))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const removeVector = useCallback(async (pageIndex: number, vectorIndex: number) => {
    await mutate(pageIndex, (id) => getEngine().removeVectorGroup(id, pageIndex, vectorIndex).then(() => undefined))
  }, [getEngine, mutate])

  /** Swap a logo or icon for an uploaded image, in the box it occupied. */
  const replaceVector = useCallback(async (pageIndex: number, vectorIndex: number, file: File) => {
    const { bytes, kind } = await toEmbeddableImage(file)
    await mutate(pageIndex, (id) =>
      getEngine().replaceVectorGroupWithImage(id, pageIndex, vectorIndex, bytes, kind).then(() => undefined))
  }, [getEngine, mutate])

  const removeText = useCallback(async (pageIndex: number, lineIndex: number) => {
    await mutate(pageIndex, (id) => getEngine().removeTextLine(id, pageIndex, lineIndex).then(() => undefined))
  }, [getEngine, mutate])

  /** Resolves to the line's NEW index — moving renumbers it, see the worker. */
  const moveText = useCallback(async (pageIndex: number, lineIndex: number, dx: number, dy: number) => {
    const r = await mutate(pageIndex, (id) => getEngine().moveTextLine(id, pageIndex, lineIndex, dx, dy))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  /** Move a line to ANOTHER page. x/yBaseline are in the target page's PDF
   * points, with y measured from its bottom edge as PDF stores it. */
  const moveTextToPage = useCallback(async (
    sourcePageIndex: number, lineIndex: number,
    targetPageIndex: number, x: number, yBaseline: number,
  ) => {
    const r = await mutate([sourcePageIndex, targetPageIndex], (id) =>
      getEngine().moveTextLineToPage(id, sourcePageIndex, lineIndex, targetPageIndex, x, yBaseline))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const moveImageToPage = useCallback(async (
    sourcePageIndex: number, imageIndex: number,
    targetPageIndex: number, rect: { x: number; y: number; width: number; height: number },
  ) => {
    const r = await mutate([sourcePageIndex, targetPageIndex], (id) =>
      getEngine().moveImageToPage(id, sourcePageIndex, imageIndex, targetPageIndex, rect))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const replaceImage = useCallback(async (pageIndex: number, imageIndex: number, file: File) => {
    const { bytes, kind } = await toEmbeddableImage(file)
    await mutate(pageIndex, (id) => getEngine().replaceImage(id, pageIndex, imageIndex, bytes, kind).then(() => undefined))
  }, [getEngine, mutate])

  const removeImage = useCallback(async (pageIndex: number, imageIndex: number) => {
    await mutate(pageIndex, (id) => getEngine().removeImage(id, pageIndex, imageIndex).then(() => undefined))
  }, [getEngine, mutate])

  const setImageRect = useCallback(async (
    pageIndex: number, imageIndex: number,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const r = await mutate(pageIndex, (id) => getEngine().setImageRect(id, pageIndex, imageIndex, rect))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const addTextOverlay = useCallback(async (pageIndex: number, overlay: TextOverlayRequest) => {
    await mutate(pageIndex, (id) => getEngine().addTextOverlay(id, pageIndex, overlay).then(() => undefined))
  }, [getEngine, mutate])

  /** Resolves to the new image's index, so the caller can select it. */
  const addImageOverlay = useCallback(async (
    pageIndex: number, overlay: ImageOverlayRequest, file: File,
  ) => {
    const { bytes, kind } = await toEmbeddableImage(file)
    const r = await mutate(pageIndex, (id) =>
      getEngine().addImageOverlay(id, pageIndex, overlay, bytes, kind))
    return r?.newIndex ?? -1
  }, [getEngine, mutate])

  const applyPagePlan = useCallback(async (plan: PagePlanRequest[]) => {
    const id = docIdRef.current
    if (!id) return
    setBusy(true)
    try {
      const result = await getEngine().applyPagePlan(id, plan)
      setPages(result.pages)
      // A page plan renumbers, duplicates and drops pages wholesale, so
      // every cached per-page list now refers to pages that may not exist.
      // Cleared rather than remapped: rebuilding from the engine is cheap
      // and cannot be subtly wrong.
      setPageText({})
      setPageImages({})
      setPageVectors({})
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

  // Memoised deliberately, and it matters more than it looks.
  //
  // The editor holds this whole object and passes it to effects. Returned
  // as a fresh literal, its identity changed on EVERY render — including
  // the one React does for each pointermove of a drag — so effects keyed on
  // it re-ran continuously. Two of them ask the engine to re-render the
  // dragged object and the hole it left, about 35ms each, which piled work
  // into the worker faster than it could clear it: the drag stuttered and
  // the drop had to wait behind the backlog. Stable identity means those
  // effects run when the document actually changes, and not while a finger
  // is moving.
  return useMemo(() => ({
    phase, error, downloadPercent, pages, docId, pageText, pageImages,
    loadPageText, loadPageImages, loadPageVectors, pageVectors,
    renderCleanPatch, renderImagePreview, renderPageRegion, lastChange,
    removeVector, replaceVector, styleText, scaleText, alignText, transformImage, renderPage, editText, moveText, moveTextToPage, moveImageToPage, removeText,
    replaceImage, removeImage, setImageRect, addTextOverlay, addImageOverlay, applyPagePlan,
    save, busy, revision,
  }), [
    phase, error, downloadPercent, pages, docId, pageText, pageImages,
    loadPageText, loadPageImages, loadPageVectors, pageVectors,
    renderCleanPatch, renderImagePreview, renderPageRegion, lastChange,
    removeVector, replaceVector, styleText, scaleText, alignText, transformImage,
    renderPage, editText, moveText, moveTextToPage, moveImageToPage, removeText,
    replaceImage, removeImage, setImageRect, addTextOverlay, addImageOverlay,
    applyPagePlan, save, busy, revision,
  ])
}
