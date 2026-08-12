import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeftIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { usePdfTemplateQuery } from "@/features/pdfTemplates/api"
import { ROUTES } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { EngineTextLine } from "@/lib/pdf-engine"

import { usePdfEngineDocument } from "./usePdfEngineDocument"
import { PdfEnginePage } from "./PdfEnginePage"

/**
 * PDF Master editor, rebuilt on the PDFium engine.
 *
 * Runs at its own route alongside the existing editor rather than
 * replacing it, so the current one keeps working untouched while this is
 * brought up to parity. Nothing here calls the Python edit service: the
 * PDF is fetched straight from storage, edited in the browser, and saved
 * by the same engine that rendered it.
 */

/** Page width on screen. Wide enough to read catalogue body text without
 * making a 14-page document unmanageably tall. */
const PAGE_DISPLAY_WIDTH = 820

interface SelectedLine {
  pageIndex: number
  line: EngineTextLine
}

export function PdfEngineEditorPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { templateId } = useParams({ strict: false }) as { templateId?: string }
  const templateQuery = usePdfTemplateQuery(templateId ?? "")
  const template = templateQuery.data

  // Loaded through the API by id, not from template.source_pdf_url — see
  // usePdfEngineDocument for why a direct R2 fetch cannot work.
  const doc = usePdfEngineDocument(template?.template_type === "pdf_master" ? templateId : null)

  const [selected, setSelected] = useState<SelectedLine | null>(null)
  const [draft, setDraft] = useState("")
  const [downloading, setDownloading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** Opens the editor for one line. The draft is seeded HERE rather than in
   * an effect keyed on `selected`: deriving it in an effect means an extra
   * render where the textarea still holds the previous line's text, and it
   * trips the project's set-state-in-effect rule for exactly that reason. */
  const openLine = (pageIndex: number, line: EngineTextLine) => {
    setSelected({ pageIndex, line })
    setDraft(line.text)
  }

  useEffect(() => {
    if (!selected) return
    // Selected on the next frame: the dialog is still animating in on this
    // one, and focusing a not-yet-visible element is ignored.
    const id = requestAnimationFrame(() => textareaRef.current?.select())
    return () => cancelAnimationFrame(id)
  }, [selected])

  const containerWidth = PAGE_DISPLAY_WIDTH

  const commitEdit = async () => {
    if (!selected) return
    const { pageIndex, line } = selected
    const newText = draft
    setSelected(null)
    if (newText === line.text) return
    try {
      await doc.editText(pageIndex, line.lineIndex, newText)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await doc.save()
      const safeName = (template?.name || "document").replace(/[^\w.\-֐-׿ ]+/g, "_").trim() || "document"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${safeName}.pdf`
      a.click()
      // Revoked on the next tick rather than immediately: revoking before
      // the browser has started reading the blob cancels the download.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const editableCount = useMemo(
    () => Object.values(doc.pageText).reduce((n, p) => n + (p?.lines.length ?? 0), 0),
    [doc.pageText],
  )

  if (templateQuery.isLoading) {
    return <CenteredMessage><Loader2Icon className="size-5 animate-spin" /></CenteredMessage>
  }
  if (templateQuery.isError || !template) {
    return <CenteredMessage>{t("pdfTemplates.notFound", "Template not found")}</CenteredMessage>
  }
  if (template.template_type !== "pdf_master") {
    return <CenteredMessage>{t("pdfTemplates.engineEditorOnlyMaster", "This editor only supports uploaded PDF templates.")}</CenteredMessage>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: ROUTES.CREATE_PDF })}
          className="gap-1.5"
        >
          <ArrowLeftIcon className="size-4" />
          {t("common.back", "Back")}
        </Button>

        <span className="min-w-0 truncate text-sm font-medium">{template.name}</span>

        {doc.phase === "ready" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("pdfTemplates.engineEditableSlots", "{{count}} editable slots", { count: editableCount })}
          </span>
        )}

        <div className="ms-auto flex items-center gap-2">
          {doc.busy && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={doc.phase !== "ready" || downloading || doc.busy}
            className="gap-1.5"
          >
            {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {t("pdfTemplates.masterDownload", "Download PDF")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6">
        {doc.phase === "downloading" && (
          <CenteredMessage>
            <Loader2Icon className="size-5 animate-spin" />
            <span>
              {t("pdfTemplates.engineDownloading", "Loading PDF")}
              {doc.downloadPercent !== null ? ` ${doc.downloadPercent}%` : ""}
            </span>
          </CenteredMessage>
        )}
        {doc.phase === "opening" && (
          <CenteredMessage>
            <Loader2Icon className="size-5 animate-spin" />
            <span>{t("pdfTemplates.engineOpening", "Preparing editor")}</span>
          </CenteredMessage>
        )}
        {doc.phase === "error" && (
          <CenteredMessage>
            <span className="text-destructive">{doc.error}</span>
          </CenteredMessage>
        )}

        {doc.phase === "ready" && (
          <div className="flex flex-col items-center gap-6">
            {doc.pages.map((page, index) => (
              <PdfEnginePage
                key={index}
                page={page}
                pageIndex={index}
                displayWidth={containerWidth}
                text={doc.pageText[index]}
                revision={doc.revision}
                renderPage={doc.renderPage}
                loadPageText={doc.loadPageText}
                onSelectLine={openLine}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter saves, matching the existing editor's shortcut.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              void commitEdit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("pdfTemplates.masterEditTextTitle", "Edit text")}</DialogTitle>
          </DialogHeader>

          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            dir={selected?.line.direction === "rtl" ? "rtl" : "ltr"}
            className="resize-none"
          />

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void commitEdit()} disabled={doc.busy}>
              {t("common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      {children}
    </div>
  )
}
