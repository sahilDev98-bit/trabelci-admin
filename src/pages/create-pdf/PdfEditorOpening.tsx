import { useNavigate, useParams } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"

import { ROUTES } from "@/lib/routes"
import { pdfTemplatesQueryKeys } from "@/features/pdfTemplates/queryKeys"
import type { PdfTemplate } from "@/features/pdfTemplates/types"
import { PdfEditorLoadingScreen } from "./PdfEditorLoadingScreen"

/**
 * What the router shows while the PDF editor's code is still downloading.
 *
 * The point of it is that it is not a SECOND loading screen. The first time
 * a template is opened in a session there are two genuine waits back to back
 * — the editor's JavaScript bundle, then the PDF — and showing a bare
 * spinner for the first and a proper editor screen for the second made one
 * click look like the app stalling twice. This is the same screen the editor
 * itself shows, so the wait simply gains a percentage when the code arrives
 * instead of being replaced by something that looks different.
 *
 * It can even name the document, because opening a template hands the record
 * to the cache before navigating (see CreatePdfPage) — so the title is
 * already known even though the code that would normally read it is still on
 * its way. If it is not there, the screen renders without a name rather than
 * inventing one.
 *
 * Lives outside engine-editor/ on purpose: anything the router imports for
 * this must be in the main bundle, and pulling it from the editor's folder
 * would drag the editor into the main bundle with it — which would fix the
 * flicker by making every page in the app slower to load.
 */
export function PdfEditorOpening() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { templateId } = useParams({ strict: false }) as { templateId?: string }

  const cached = templateId
    ? queryClient.getQueryData<PdfTemplate>(pdfTemplatesQueryKeys.byId(templateId))
    : undefined

  return (
    <PdfEditorLoadingScreen
      documentName={cached?.name ?? ""}
      phase="downloading"
      downloadPercent={null}
      error={null}
      onBack={() => void navigate({ to: ROUTES.CREATE_PDF })}
    />
  )
}
