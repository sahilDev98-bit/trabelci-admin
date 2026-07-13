import { useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { FileTextIcon, Loader2Icon, PlusIcon, PencilIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

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
  useCreatePdfTemplateFromPdfMutation,
} from "@/features/pdfTemplates/api"
import type { PdfTemplate } from "@/features/pdfTemplates/types"

function countSlots(html: string): number {
  const matches = html.match(/data-pdf-slot=/g)
  return matches ? matches.length : 0
}

function MiniPreview({ html }: { html: string }) {
  return (
    <div className="relative h-32 w-full overflow-hidden rounded-md border bg-white">
      <iframe
        srcDoc={html}
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
  onUse: (id: string) => void
}) {
  const { t } = useTranslation()
  const slotCount = countSlots(template.html_content)

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm font-medium">{template.name}</CardTitle>
            {template.description && (
              <CardDescription className="mt-0.5 line-clamp-2 text-xs">
                {template.description}
              </CardDescription>
            )}
          </div>
          {isAdmin && (
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
        <MiniPreview html={template.html_content} />
        <div className="flex items-center justify-between gap-2">
          {slotCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("pdfTemplates.slotsCount", { count: slotCount })}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {t("pdfTemplates.lastUpdated", {
              date: new Date(template.updated_at).toLocaleDateString(),
            })}
          </span>
        </div>
        <Button size="sm" className="w-full" onClick={() => onUse(template.id)}>
          {t("pdfTemplates.useTemplate")}
        </Button>
      </CardContent>
    </Card>
  )
}

export function CreatePdfPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const profile = useAppSelector((s) => s.auth.profile)
  const isAdmin = profile?.role === USER_ROLES.ADMIN

  const { data: templates, isLoading, isError } = usePdfTemplatesQuery()
  const deleteMutation = useDeletePdfTemplateMutation()
  const fromPdfMutation = useCreatePdfTemplateFromPdfMutation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [toDelete, setToDelete] = useState<PdfTemplate | null>(null)

  async function handlePdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file) return
    try {
      const template = await fromPdfMutation.mutateAsync(file)
      toast.success(t("pdfTemplates.pdfConverted", { name: template.name }))
    } catch {
      toast.error(t("pdfTemplates.pdfConvertFailed"))
    }
  }

  function handleEdit(id: string) {
    void navigate({ to: ROUTES.CREATE_PDF_TEMPLATE_EDIT.replace("$templateId", id) })
  }

  function handleUse(id: string) {
    void navigate({ to: ROUTES.CREATE_PDF_CUSTOMIZE.replace("$templateId", id) })
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
            <Button onClick={() => void navigate({ to: ROUTES.CREATE_PDF_TEMPLATE_NEW })}>
              <PlusIcon className="size-4" />
              {t("pdfTemplates.newTemplate")}
            </Button>
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
                {isAdmin && (
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
