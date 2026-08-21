import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FileTextIcon, Loader2Icon, PlusIcon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import * as pdfjsLib from "pdfjs-dist"

import { useAppSelector } from "@/store"
import { USER_ROLES } from "@/lib/roles"
import { ROUTES } from "@/lib/routes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  usePdfTemplatesQuery,
  useDeletePdfTemplateMutation,
  useCreatePdfMasterTemplateMutation,
} from "@/features/pdfTemplates/api"
import { pdfTemplatesQueryKeys } from "@/features/pdfTemplates/queryKeys"
import type { PdfTemplate } from "@/features/pdfTemplates/types"

// Manual template creation/editing is disabled for now — PDF upload is the
// only supported way to create templates. Flip this back on to restore the
// "New Template" button and the per-card edit/delete icons.
const SHOW_TEMPLATE_MANAGEMENT = false

// Vite statically detects this `new URL(..., import.meta.url)` pattern and
// bundles the worker as a proper asset (see PdfMasterCustomizer.tsx, which
// sets up the same worker for the same reason).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

// Client-side pre-check only, for fast feedback before even uploading —
// the backend enforces the real, authoritative limit. Keep this in sync with
// MAX_PDF_MASTER_PAGES in trabelci-api-main's services/pdfMasterService.js.
const MAX_PDF_MASTER_PAGES = 15

// Client-side pre-check only — mirrors MAX_MB_PER_PAGE in trabelci-api-main's
// services/pdfMasterService.js (catches a file with very few pages but huge,
// high-resolution images crammed into them, which a page-count check alone misses).
const MAX_MB_PER_PAGE = 5

async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

function MiniPreview({ template }: { template: PdfTemplate }) {
  if (template.template_type === "pdf_master") {
    return (
      <div className="relative h-32 w-full overflow-hidden rounded-md border bg-white">
        {template.preview_image_url ? (
          <img
            src={template.preview_image_url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <FileTextIcon className="size-8" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-32 w-full overflow-hidden rounded-md border bg-white">
      <iframe
        srcDoc={template.html_content ?? ""}
        className="pointer-events-none absolute inset-0 h-150 w-200 origin-top-left"
        style={{ transform: "scale(0.18)", transformOrigin: "0 0" }}
        sandbox=""
        title="preview"
      />
    </div>
  )
}

function TemplateCard({
  template,
  isAdmin,
  onEdit,
  onDelete,
  onUse,
}: {
  template: PdfTemplate
  isAdmin: boolean
  onEdit: (id: string) => void
  onDelete: (t: PdfTemplate) => void
  onUse: (template: PdfTemplate) => void
}) {
  const { t } = useTranslation()

  /**
   * Start downloading the editor while the pointer is still on its way to
   * the button.
   *
   * The editor is a separate chunk, so the very first time anyone opens a
   * template the click is followed by a wait for that code to arrive. There
   * is a fallback for it, but the better answer is not to need one: hovering
   * is a reliable half-second of warning, and by the time the click lands
   * the code is usually already here. Harmless if the pointer moves away —
   * the browser keeps what it fetched, and the same import is what the route
   * asks for, so nothing is downloaded twice.
   */
  const preloadEditor = () => { void import("./PdfCustomizerPage") }

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        {/* Fixed height (title + up to 2 description lines) so every card's
            image starts at the same y position regardless of text length */}
        <div className="flex min-h-13 items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-medium">{template.name}</CardTitle>
            {template.description && (
              <CardDescription className="mt-0.5 line-clamp-2 text-xs">
                {template.description}
              </CardDescription>
            )}
          </div>
          {isAdmin && SHOW_TEMPLATE_MANAGEMENT && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => onEdit(template.id)}
                title={t("pdfTemplates.editTemplate")}
              >
                <PencilIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive hover:text-destructive"
                onClick={() => onDelete(template)}
                title={t("pdfTemplates.deleteTemplate")}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <MiniPreview template={template} />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onPointerEnter={preloadEditor}
            onFocus={preloadEditor}
            onClick={() => onUse(template)}
          >
            {t("pdfTemplates.useTemplate")}
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(template)}
            >
              <Trash2Icon className="size-3.5" />
              {t("pdfTemplates.deleteTemplate")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function CreatePdfPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  /**
   * Fetch the editor's code as soon as this list is on screen.
   *
   * Anyone looking at this page is one click from opening a template, and
   * the editor ships as a separate bundle that is not downloaded until it is
   * asked for. Starting it here means the click almost never has to wait for
   * it — the button also warms it on hover, but that only helps if the
   * pointer pauses, and a decisive click does not.
   *
   * A background fetch that blocks nothing. If the template is opened before
   * it finishes, the wait shown is the editor's own loading screen, so it
   * still reads as one screen rather than two.
   */
  useEffect(() => { void import("./PdfCustomizerPage") }, [])
  const profile = useAppSelector((s) => s.auth.profile)
  const isAdmin = profile?.role === USER_ROLES.ADMIN

  const { data: templates, isLoading, isError } = usePdfTemplatesQuery()
  const deleteMutation = useDeletePdfTemplateMutation()
  const fromPdfMutation = useCreatePdfMasterTemplateMutation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [toDelete, setToDelete] = useState<PdfTemplate | null>(null)

  async function handlePdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file) return

    try {
      const pageCount = await getPdfPageCount(file)
      if (pageCount > MAX_PDF_MASTER_PAGES) {
        toast.error(t("pdfTemplates.pdfTooManyPages", { count: pageCount, max: MAX_PDF_MASTER_PAGES }))
        return
      }

      const mbPerPage = file.size / (1024 * 1024) / pageCount
      if (mbPerPage > MAX_MB_PER_PAGE) {
        toast.error(t("pdfTemplates.pdfTooHeavyPerPage", { mb: mbPerPage.toFixed(1), max: MAX_MB_PER_PAGE }))
        return
      }
    } catch {
      // Couldn't even read the page count client-side — don't block the
      // upload on that; the backend enforces the real limit regardless.
    }

    try {
      const template = await fromPdfMutation.mutateAsync(file)
      toast.success(t("pdfTemplates.pdfConverted", { name: template.name }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pdfTemplates.pdfConvertFailed"))
    }
  }

  function handleEdit(id: string) {
    void navigate({ to: ROUTES.CREATE_PDF_TEMPLATE_EDIT.replace("$templateId", id) })
  }

  function handleUse(template: PdfTemplate) {
    // Handed to the editor before navigating, not fetched again once it gets
    // there. The whole template is already on this card, and without this the
    // editor opens on a spinner INSIDE the admin shell — sidebar, breadcrumbs
    // and all — while it re-asks the server for something the browser is
    // already holding. Seeding it means the editor knows what it is opening
    // in the same frame it mounts, and goes straight to its own full page.
    queryClient.setQueryData(pdfTemplatesQueryKeys.byId(template.id), template)
    void navigate({ to: ROUTES.CREATE_PDF_CUSTOMIZE.replace("$templateId", template.id) })
  }

  async function handleDeleteConfirm() {
    if (!toDelete) return
    try {
      await deleteMutation.mutateAsync(toDelete.id)
      toast.success(t("pdfTemplates.templateDeleted"))
    } catch {
      toast.error(t("common.error"))
    } finally {
      setToDelete(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("pdfTemplates.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pdfTemplates.subtitle")}</p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handlePdfSelected}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={fromPdfMutation.isPending}
            >
              {fromPdfMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <UploadIcon className="size-4" />
              )}
              {fromPdfMutation.isPending
                ? t("pdfTemplates.converting")
                : t("pdfTemplates.uploadPdf")}
            </Button>
            {SHOW_TEMPLATE_MANAGEMENT && (
              <Button onClick={() => void navigate({ to: ROUTES.CREATE_PDF_TEMPLATE_NEW })}>
                <PlusIcon className="size-4" />
                {t("pdfTemplates.newTemplate")}
              </Button>
            )}
          </div>
        )}
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm text-destructive">{t("common.error")}</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (
        <>
          {templates && templates.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  isAdmin={isAdmin}
                  onEdit={handleEdit}
                  onDelete={setToDelete}
                  onUse={handleUse}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <div className="grid size-12 place-items-center rounded-full bg-muted">
                  <FileTextIcon className="size-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("pdfTemplates.noTemplates")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("pdfTemplates.noTemplatesDesc")}
                  </p>
                </div>
                {isAdmin && SHOW_TEMPLATE_MANAGEMENT && (
                  <Button
                    size="sm"
                    onClick={() => void navigate({ to: ROUTES.CREATE_PDF_TEMPLATE_NEW })}
                  >
                    <PlusIcon className="size-4" />
                    {t("pdfTemplates.newTemplate")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pdfTemplates.deleteTemplateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pdfTemplates.deleteTemplateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                t("pdfTemplates.deleteTemplate")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
