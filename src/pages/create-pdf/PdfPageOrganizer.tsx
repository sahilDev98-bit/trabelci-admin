import { useState } from "react"
import { CopyIcon, RotateCwIcon, Trash2Icon, Undo2Icon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import type { PdfOrganizerMode } from "./pdfEditorTypes"

/**
 * One page as the organizer sees it. Deliberately a light descriptor rather
 * than the editor's own page model: creating a genuine duplicate means cloning a
 * canvas bitmap, its hotspots and its pending edits, all of which live in
 * refs inside the customizer. So the dialog only ever says "here is a new
 * slot showing page X" and the customizer materialises it on Done.
 */
export interface OrganizerPage {
  /** Unique within this dialog session — a page and its copies must not
   * share a key or React (and the drag) would confuse them. */
  key: string
  /** The existing editor page this row IS, or null when it's a new copy that
   * doesn't exist yet. */
  clientId: string | null
  /** Which existing page's picture/content this shows. For an existing page
   * that's itself; for a copy it's the page it was copied from. */
  sourceClientId: string
  /** 0 | 90 | 180 | 270 — absolute, relative to how the page started. */
  rotation: number
}

interface PdfPageOrganizerProps {
  mode: PdfOrganizerMode
  pages: OrganizerPage[]
  /** clientId -> data URL of that page's current appearance, including any
   * edits already made, so the dialog shows the real document. */
  thumbnails: Record<string, string>
  onApply: (pages: OrganizerPage[]) => void
  onCancel: () => void
}

/** Every mode is one job. Splitting them this way is the whole point: in the
 * delete dialog nothing rotates, in the rotate dialog nothing is deleted. */
const DRAG_MODES: readonly PdfOrganizerMode[] = ["copy", "move"]

/**
 * The horizontal room between two thumbnails.
 *
 * In the drag modes this is the resting width of the drop strip that sits
 * between every pair of pages — the spacing there is a side effect of the
 * strips existing. The click-only modes have no strips, so they take the same
 * number as a plain column gap. One constant, because the whole point is that
 * the four modes are the same grid: if these were two numbers they would
 * drift, and Delete would go back to showing its pages jammed edge to edge
 * while Copy breathes.
 */
const PAGE_GAP_PX = 14

export function PdfPageOrganizer({ mode, pages, thumbnails, onApply, onCancel }: PdfPageOrganizerProps) {
  const { t } = useTranslation()

  // Working copy plus its full history. Every change pushes the PREVIOUS
  // state, so Undo can walk all the way back to how things were when the
  // dialog opened — not just one step.
  //
  // Seeded once, on mount, and never re-synced from props: the customizer
  // renders this only while a tool is open and keys it by mode, so every
  // open is a fresh mount. That's what makes Cancel trivially correct —
  // nothing here ever touched the real document in the first place.
  const [draft, setDraft] = useState<OrganizerPage[]>(pages)
  const [history, setHistory] = useState<OrganizerPage[][]>([])
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const commit = (next: OrganizerPage[]) => {
    setHistory((prev) => [...prev, draft])
    setDraft(next)
  }

  const undo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      setDraft(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }

  const isDragMode = DRAG_MODES.includes(mode)

  /** Insert a copy of the page at `from` into position `index`. Every copy
   * gets its own fresh key, so the same page can be copied as many times as
   * you like — there's no once-only anything here. */
  function insertCopy(from: number, index: number) {
    const source = draft[from]
    if (!source) return
    const copy: OrganizerPage = {
      key: crypto.randomUUID(),
      clientId: null, // materialised by the customizer on Done
      sourceClientId: source.sourceClientId,
      rotation: source.rotation,
    }
    const next = [...draft]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, copy)
    commit(next)
  }

  function handlePageClick(index: number) {
    if (mode === "delete") {
      // A document with no pages is not something the editor or the export
      // can represent, so the last one can't be removed.
      if (draft.length <= 1) return
      commit(draft.filter((_, i) => i !== index))
    } else if (mode === "rotate") {
      commit(draft.map((p, i) => (i === index ? { ...p, rotation: (p.rotation + 90) % 360 } : p)))
    } else if (mode === "copy") {
      // Plain click = "give me another one of these", dropped straight after
      // the original. Dragging is for placing a copy somewhere specific;
      // needing a precise drag just to get a second copy made repeat copying
      // far harder than it should be.
      insertCopy(index, index + 1)
    }
  }

  function handleDrop(index: number) {
    const key = draggingKey
    setDraggingKey(null)
    setDropIndex(null)
    if (!key) return
    const from = draft.findIndex((p) => p.key === key)
    if (from === -1) return

    if (mode === "copy") {
      insertCopy(from, index)
    } else {
      const next = [...draft]
      const [page] = next.splice(from, 1)
      // Removing the page first shifts everything after it up by one, so a
      // target beyond the old position comes back down by one to still mean
      // the gap the user was pointing at.
      const to = index > from ? index - 1 : index
      next.splice(Math.max(0, Math.min(to, next.length)), 0, page)
      commit(next)
    }
  }

  /** Which gap a drop on the page at `index` means: its near half inserts
   * before it, its far half after. Without this, releasing the mouse on a
   * page (rather than exactly on the thin strip between two pages) did
   * nothing at all — the drag just silently cancelled, which is what made
   * repeat copying feel broken. Mirrored for RTL, where "before" is visually
   * on the right. */
  function gapForPointerOver(e: React.DragEvent<HTMLElement>, index: number): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const past = e.clientX > rect.left + rect.width / 2
    const isRtl = document.documentElement.dir === "rtl"
    return (isRtl ? !past : past) ? index + 1 : index
  }

  const title = {
    copy: t("pdfTemplates.organizerCopyTitle"),
    move: t("pdfTemplates.organizerMoveTitle"),
    rotate: t("pdfTemplates.organizerRotateTitle"),
    delete: t("pdfTemplates.organizerDeleteTitle"),
  }[mode]

  const hint = {
    copy: t("pdfTemplates.organizerCopyHint"),
    move: t("pdfTemplates.organizerMoveHint"),
    rotate: t("pdfTemplates.organizerRotateHint"),
    delete: t("pdfTemplates.organizerDeleteHint"),
  }[mode]

  /** The gap a dragged thumbnail can land in. Only rendered in the drag
   * modes, so click-only modes have no stray drop targets between pages. */
  const dropZone = (index: number) => {
    const isActive = dropIndex === index
    return (
      <div
        onDragOver={(e) => {
          // preventDefault is what marks this a valid drop target at all —
          // without it the browser never fires onDrop here.
          e.preventDefault()
          if (dropIndex !== index) setDropIndex(index)
        }}
        onDrop={(e) => { e.preventDefault(); handleDrop(index) }}
        className="flex shrink-0 items-center justify-center self-stretch transition-all"
        style={{ width: isActive ? 34 : PAGE_GAP_PX }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: isActive ? 4 : 2, background: isActive ? "rgb(23,23,23)" : "rgba(0,0,0,0.10)" }}
        />
      </div>
    )
  }

  return (
    // Deliberately NOT the shared Dialog primitive: this needs the whole
    // viewport (many thumbnails at once is the entire reason the panel
    // exists), and that component is built around a centred, width-capped
    // card.
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <header className="flex shrink-0 items-center gap-3 border-b px-5 py-3">
          <h2 className="text-base font-medium">{title}</h2>
          <span className="hidden text-sm text-muted-foreground sm:inline">{hint}</span>
          <button
            type="button"
            onClick={onCancel}
            title={t("common.cancel")}
            className="ms-auto flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            data-organizer-row
            className="flex flex-wrap items-stretch gap-y-6"
            // The drag modes get their horizontal spacing from the drop
            // strips between pages, so adding a gap there would double it.
            // The click-only modes take the same distance as a real gap.
            //
            // The leading pad matches it for the same reason: in the drag
            // modes every row opens with a strip (the "insert before page 1"
            // target), so without this the first page would sit 14px further
            // out in Delete than in Copy and the grid would visibly shift
            // when you switch tools. Logical properties, so it mirrors in
            // Hebrew.
            style={isDragMode
              ? undefined
              : { columnGap: PAGE_GAP_PX, paddingInlineStart: PAGE_GAP_PX }}
          >
            {draft.map((page, index) => {
              const rotated = page.rotation === 90 || page.rotation === 270
              return (
                <div key={page.key} className="flex items-stretch">
                  {isDragMode && dropZone(index)}

                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      data-organizer-page={index}
                      draggable={isDragMode}
                      onDragStart={isDragMode ? () => setDraggingKey(page.key) : undefined}
                      onDragEnd={isDragMode ? () => { setDraggingKey(null); setDropIndex(null) } : undefined}
                      // The page itself is a drop target too, not just the
                      // thin strips between pages — releasing anywhere over a
                      // page snaps to its nearer side. Dropping should never
                      // be a precision exercise.
                      onDragOver={isDragMode ? (e) => {
                        e.preventDefault()
                        const gap = gapForPointerOver(e, index)
                        if (dropIndex !== gap) setDropIndex(gap)
                      } : undefined}
                      onDrop={isDragMode ? (e) => {
                        e.preventDefault()
                        handleDrop(gapForPointerOver(e, index))
                      } : undefined}
                      onClick={() => handlePageClick(index)}
                      className={`group relative flex items-center justify-center overflow-hidden rounded-md border-2 bg-white transition-all ${
                        draggingKey === page.key ? "opacity-40" : ""
                      } ${
                        mode === "delete"
                          ? "border-transparent hover:border-destructive"
                          : mode === "rotate"
                            ? "border-transparent hover:border-primary"
                            : mode === "copy"
                              ? "border-transparent hover:border-primary"
                              : "border-transparent"
                      }`}
                      style={{
                        // Swap the box when the page is on its side, so a
                        // rotated thumbnail doesn't overflow its own slot.
                        width: rotated ? 150 : 112,
                        height: rotated ? 112 : 150,
                        cursor: isDragMode ? "grab" : "pointer",
                        boxShadow: "0 1px 2px rgba(0,0,0,.06), 0 4px 10px rgba(0,0,0,.08)",
                      }}
                    >
                      {thumbnails[page.sourceClientId] ? (
                        <img
                          src={thumbnails[page.sourceClientId]}
                          alt=""
                          draggable={false}
                          className="max-h-full max-w-full object-contain transition-transform"
                          style={{
                            transform: `rotate(${page.rotation}deg)`,
                            // Before rotation the image is laid out against
                            // the SWAPPED box, so it has to be measured
                            // against the un-swapped one or it renders
                            // squashed at 90°/270°.
                            width: rotated ? 150 : "100%",
                            height: rotated ? "auto" : "100%",
                            maxWidth: rotated ? "none" : "100%",
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{index + 1}</span>
                      )}

                      {mode === "delete" && (
                        <span className="absolute inset-0 flex items-center justify-center bg-destructive/0 opacity-0 transition-all group-hover:bg-destructive/15 group-hover:opacity-100">
                          <Trash2Icon className="size-6 text-destructive" />
                        </span>
                      )}
                      {mode === "rotate" && (
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                          <RotateCwIcon className="size-6 text-foreground/70" />
                        </span>
                      )}
                      {mode === "copy" && (
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                          <CopyIcon className="size-6 text-foreground/70" />
                        </span>
                      )}
                    </button>

                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                  </div>
                </div>
              )
            })}

            {/* The gap after the LAST page — every other gap is rendered as
                the next page's leading zone, so between any two pages there
                is exactly one drop target rather than two overlapping ones. */}
            {isDragMode && draft.length > 0 && (
              <div className="flex items-stretch">{dropZone(draft.length)}</div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          {/* Undo sits far from Cancel/Done on purpose: the "oops" button
              should never be adjacent to the "finish" button, where a
              mis-click would throw away the work instead of stepping back
              one action. */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={history.length === 0}
            onClick={undo}
          >
            <Undo2Icon className="size-3.5" />
            {t("common.undo")}
          </Button>

          <div className="ms-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={() => onApply(draft)}>
              {t("common.done")}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
