import { ArrowLeftIcon, Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

/**
 * The one screen shown on the way into the PDF editor.
 *
 * Deliberately lives OUTSIDE the editor's own folder, because it has to be
 * usable before any of the editor's code has arrived. Opening a template for
 * the first time in a session waits twice — once for the editor's JavaScript
 * bundle, then again for the PDF itself — and those were two different
 * looking screens in a row, which read as the app stalling rather than
 * loading. The router shows this while the bundle downloads and the editor
 * shows the same thing while the document does, so it is one screen that
 * gains a filename and a percentage rather than two that replace each other.
 *
 * That is also why it is plain: it must render with nothing but a name, and
 * sometimes not even that. It is deliberately NOT the editor's real toolbar
 * with everything disabled — there is no document yet, so every tool on it
 * would be a lie. A name and a way back is the honest amount of chrome for a
 * screen that cannot do anything.
 */

export type PdfEditorLoadingPhase = "downloading" | "opening" | "error" | "idle"

interface PdfEditorLoadingScreenProps {
  documentName: string
  phase: PdfEditorLoadingPhase
  /** How much of the file has arrived, when the server reports a size. */
  downloadPercent: number | null
  error: string | null
  onBack: () => void
}

export function PdfEditorLoadingScreen({
  documentName, phase, downloadPercent, error, onBack,
}: PdfEditorLoadingScreenProps) {
  const { t } = useTranslation()

  return (
    <div
      data-pdf-loading-shell
      // The same marker the ready editor carries. "Which editor opened this
      // template?" has to be answerable while it is still loading — that is
      // exactly when the switchover test asks, because the harness has no
      // auth and the document never finishes arriving.
      data-pdf-editor="engine"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeftIcon className="size-4" />
          {t("pdfTemplates.engineBackToTemplates", "Templates")}
        </Button>
        {documentName && (
          <span className="min-w-0 truncate text-sm font-medium">{documentName}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40">
        {phase === "error" ? (
          <p className="px-6 text-center text-sm text-destructive">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
            {phase === "opening"
              ? t("pdfTemplates.engineOpening", "Preparing editor")
              : (
                <>
                  {t("pdfTemplates.engineDownloading", "Loading PDF")}
                  {downloadPercent !== null ? ` ${downloadPercent}%` : ""}
                </>
              )}
          </p>
        )}
      </div>
    </div>
  )
}
