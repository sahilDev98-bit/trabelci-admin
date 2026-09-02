import { useTranslation } from "react-i18next"
import { LayoutTemplateIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { usePdfPageTemplatesQuery } from "@/features/pdfPageTemplates/api"
import type { PdfPageTemplate } from "@/features/pdfPageTemplates/types"
import { productFieldLabel } from "./productSlots"

/**
 * The library of saved page designs — Point 5, step 3 of the brief.
 *
 * Clicking one inserts it after the page in view, with its product slots
 * already marked. That is the whole point: a page laid out once, reused a
 * hundred times, and ready to be filled from any product the moment it lands.
 *
 * Each row shows what the template actually IS rather than just its name: a
 * picture of the page and the details it can hold. A library of twenty
 * "Product page 3" entries is a library nobody can choose from.
 */

/** Same width as the asset library, so the two panels do not resize the
 * document as you switch between them. */
const PANEL_WIDTH_PX = 320

interface PdfTemplatePanelProps {
  onApplyTemplate: (template: PdfPageTemplate) => void
  /** The page a template will be inserted after, 1-based, so the panel can
   * say where it is about to land. */
  afterPageNumber: number
  applyingId: string | null
  onClose: () => void
}

export function PdfTemplatePanel({
  onApplyTemplate, afterPageNumber, applyingId, onClose,
}: PdfTemplatePanelProps) {
  const { t } = useTranslation()
  const query = usePdfPageTemplatesQuery()
  const templates = query.data ?? []

  return (
    <aside
      data-pdf-template-panel
      // border-e, not border-r: this panel sits on the start side, which in
      // Hebrew is the other edge.
      className="flex shrink-0 flex-col border-e bg-background"
      style={{ width: PANEL_WIDTH_PX }}
      aria-label={t("pdfTemplates.templatePanelTitle", "Page templates")}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <LayoutTemplateIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sm font-medium">
          {t("pdfTemplates.templatePanelTitle", "Page templates")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          onClick={onClose}
          aria-label={t("pdfTemplates.templatePanelClose", "Close template panel")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {/* Where a template will land, said before it is clicked rather than
          discovered afterwards — a page arriving somewhere unexpected in a
          forty-page catalogue is a real nuisance to undo. */}
      <p className="shrink-0 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t("pdfTemplates.templateInsertsAfter", "Inserts a new page after page {{n}}.", {
          n: afterPageNumber,
        })}
      </p>

      <div className="themed-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {query.isLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("pdfTemplates.templateLoading", "Loading templates…")}
          </p>
        )}

        {query.isError && !query.isLoading && (
          <p className="text-xs text-destructive">
            {t(
              "pdfTemplates.templateLoadFailed",
              "Could not load the template library. Check your connection and try again.",
            )}
          </p>
        )}

        {!query.isLoading && !query.isError && templates.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t(
              "pdfTemplates.templateLibraryEmpty",
              "No templates yet. Lay out a page, mark its product slots, then use \"Save page as template\".",
            )}
          </p>
        )}

        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                data-pdf-template-item={template.id}
                disabled={applyingId !== null}
                onClick={() => onApplyTemplate(template)}
                className="flex w-full gap-2 rounded-md border p-2 text-start transition enabled:hover:border-primary enabled:hover:bg-muted/60 disabled:opacity-50"
              >
                {/* Straight at the stored preview. Displaying an image needs
                    no CORS — only reading its bytes does, which is why the
                    PAGE itself comes through the API and this does not. */}
                {template.previewUrl ? (
                  <img
                    src={template.previewUrl}
                    alt=""
                    draggable={false}
                    className="h-20 w-14 shrink-0 rounded-sm border bg-white object-contain"
                  />
                ) : (
                  <span className="flex h-20 w-14 shrink-0 items-center justify-center rounded-sm border bg-muted">
                    <LayoutTemplateIcon className="size-4 text-muted-foreground" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{template.name}</p>
                  {template.supplier && (
                    <p className="truncate text-xs text-muted-foreground">{template.supplier}</p>
                  )}

                  {/* What this template can hold. The reason to pick one
                      template over another is what it fills, not its name. */}
                  {template.slots.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("pdfTemplates.templateNoSlots", "No product slots")}
                    </p>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {template.slots.slice(0, 4).map((slot, i) => (
                        <span
                          key={`${slot.fieldId}-${i}`}
                          className="rounded-sm bg-emerald-600 px-1 text-[9px] font-medium leading-4 text-white"
                        >
                          {productFieldLabel(t, slot.fieldId)}
                        </span>
                      ))}
                      {template.slots.length > 4 && (
                        <span className="text-[9px] leading-4 text-muted-foreground">
                          +{template.slots.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {applyingId === template.id && (
                  <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
