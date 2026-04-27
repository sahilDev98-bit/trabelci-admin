import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SaveIcon, Loader2Icon, TrashIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import {
  useWhatsappDefaultTemplateQuery,
  useWhatsappTemplatesListQuery,
  useWhatsappMerchantTemplateQuery,
  useUpsertDefaultTemplateMutation,
  useUpsertMerchantTemplateMutation,
  useDeleteMerchantTemplateMutation,
} from "@/features/whatsappTemplates/api"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import { PLACEHOLDERS, renderPreview } from "@/features/whatsappTemplates/placeholders"

type Lang = "en" | "he"

// ── Template Editor ──────────────────────────────────────────────────────────

function TemplateEditor({
  templateEn,
  templateHe,
  onChangeEn,
  onChangeHe,
  onSave,
  isSaving,
  t,
}: {
  templateEn: string
  templateHe: string
  onChangeEn: (v: string) => void
  onChangeHe: (v: string) => void
  onSave: () => void
  isSaving: boolean
  t: (key: string) => string
}) {
  const [lang, setLang] = useState<Lang>("en")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currentTemplate = lang === "en" ? templateEn : templateHe
  const setCurrentTemplate = lang === "en" ? onChangeEn : onChangeHe
  const isRtl = lang === "he"

  const preview = useMemo(() => renderPreview(currentTemplate), [currentTemplate])

  function insertPlaceholder(key: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart ?? currentTemplate.length
    const end = ta.selectionEnd ?? start
    const placeholder = `{{${key}}}`
    const newValue = currentTemplate.slice(0, start) + placeholder + currentTemplate.slice(end)
    setCurrentTemplate(newValue)
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + placeholder.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="space-y-4">
      {/* Language toggle */}
      <div className="flex gap-2">
        <Button
          variant={lang === "en" ? "default" : "outline"}
          size="sm"
          onClick={() => setLang("en")}
        >
          {t("whatsappTemplates.english")}
        </Button>
        <Button
          variant={lang === "he" ? "default" : "outline"}
          size="sm"
          onClick={() => setLang("he")}
        >
          {t("whatsappTemplates.hebrew")}
        </Button>
      </div>

      {/* Placeholder buttons */}
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">
          {t("whatsappTemplates.insertPlaceholder")}
        </Label>
        <div className="flex flex-wrap gap-1">
          {PLACEHOLDERS.map((p) => (
            <Button
              key={p.key}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => insertPlaceholder(p.key)}
            >
              {t(p.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      {/* Textarea */}
      <div>
        <Label className="mb-2 block">{t("whatsappTemplates.templateBody")}</Label>
        <Textarea
          ref={textareaRef}
          value={currentTemplate}
          onChange={(e) => setCurrentTemplate(e.target.value)}
          rows={8}
          className="font-mono text-sm"
          dir={isRtl ? "rtl" : "ltr"}
        />
      </div>

      {/* Preview */}
      <div>
        <Label className="mb-2 block">{t("whatsappTemplates.preview")}</Label>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("whatsappTemplates.previewDescription")}
        </p>
        <div
          className="rounded-lg bg-emerald-50 p-4 dark:bg-emerald-950/30"
          dir={isRtl ? "rtl" : "ltr"}
        >
          <div className="inline-block max-w-md rounded-lg bg-emerald-100 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-emerald-900/50">
            {preview}
          </div>
        </div>
      </div>

      {/* Save */}
      <Button onClick={onSave} disabled={isSaving}>
        {isSaving ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <SaveIcon className="mr-2 size-4" />
        )}
        {isSaving ? t("whatsappTemplates.savingTemplate") : t("whatsappTemplates.saveTemplate")}
      </Button>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function WhatsAppTemplatesPage() {
  const { t } = useTranslation()

  // Queries
  const defaultQuery = useWhatsappDefaultTemplateQuery()
  const listQuery = useWhatsappTemplatesListQuery()
  const bpQuery = useBusinessPartnersQuery()

  // Mutations
  const upsertDefaultMut = useUpsertDefaultTemplateMutation()
  const upsertMerchantMut = useUpsertMerchantTemplateMutation()
  const deleteMerchantMut = useDeleteMerchantTemplateMutation()

  // ── Default template state ────────────────────────────────────────────────
  const [defaultEn, setDefaultEn] = useState("")
  const [defaultHe, setDefaultHe] = useState("")

  useEffect(() => {
    if (defaultQuery.data) {
      setDefaultEn(defaultQuery.data.templateEn ?? "")
      setDefaultHe(defaultQuery.data.templateHe ?? "")
    }
  }, [defaultQuery.data])

  function saveDefault() {
    upsertDefaultMut.mutate(
      { template_en: defaultEn, template_he: defaultHe },
      { onSuccess: () => toast.success(t("whatsappTemplates.savedSuccessfully")) },
    )
  }

  // ── Merchant template state ───────────────────────────────────────────────
  const [selectedBpId, setSelectedBpId] = useState<string | null>(null)
  const [merchantEn, setMerchantEn] = useState("")
  const [merchantHe, setMerchantHe] = useState("")

  const merchantQuery = useWhatsappMerchantTemplateQuery(selectedBpId)

  useEffect(() => {
    if (selectedBpId && merchantQuery.data) {
      setMerchantEn(merchantQuery.data.templateEn ?? "")
      setMerchantHe(merchantQuery.data.templateHe ?? "")
    } else if (selectedBpId && !merchantQuery.data && !merchantQuery.isLoading) {
      // No custom template — pre-fill with default
      setMerchantEn(defaultEn)
      setMerchantHe(defaultHe)
    }
  }, [selectedBpId, merchantQuery.data, merchantQuery.isLoading, defaultEn, defaultHe])

  function saveMerchant() {
    if (!selectedBpId) return
    upsertMerchantMut.mutate(
      { bpId: selectedBpId, payload: { template_en: merchantEn, template_he: merchantHe } },
      { onSuccess: () => toast.success(t("whatsappTemplates.savedSuccessfully")) },
    )
  }

  function deleteMerchant(bpId: string) {
    deleteMerchantMut.mutate(bpId, {
      onSuccess: () => {
        toast.success(t("whatsappTemplates.deletedSuccessfully"))
        if (selectedBpId === bpId) {
          setSelectedBpId(null)
          setMerchantEn("")
          setMerchantHe("")
        }
      },
    })
  }

  // Merchant overrides from list (exclude default)
  const overrides = useMemo(
    () => (listQuery.data ?? []).filter((tmpl) => !tmpl.isDefault && tmpl.businessPartnerId),
    [listQuery.data],
  )

  if (defaultQuery.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold">{t("whatsappTemplates.title")}</h1>
        <p className="text-muted-foreground">{t("whatsappTemplates.description")}</p>
      </div>

      {/* ── Default Template ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("whatsappTemplates.defaultTemplate")}</CardTitle>
          <CardDescription>{t("whatsappTemplates.defaultTemplateDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateEditor
            templateEn={defaultEn}
            templateHe={defaultHe}
            onChangeEn={setDefaultEn}
            onChangeHe={setDefaultHe}
            onSave={saveDefault}
            isSaving={upsertDefaultMut.isPending}
            t={t}
          />
        </CardContent>
      </Card>

      {/* ── Merchant Templates ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("whatsappTemplates.merchantTemplates")}</CardTitle>
          <CardDescription>{t("whatsappTemplates.merchantTemplatesDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Merchant selector */}
          <div>
            <Label className="mb-2 block">{t("whatsappTemplates.selectMerchant")}</Label>
            <Select
              value={selectedBpId ?? ""}
              onValueChange={(v) => setSelectedBpId(v || null)}
            >
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder={t("whatsappTemplates.selectMerchant")} />
              </SelectTrigger>
              <SelectContent>
                {(bpQuery.data ?? []).map((bp) => (
                  <SelectItem key={bp.id} value={String(bp.id)}>
                    {bp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Merchant editor */}
          {selectedBpId && (
            <div className="space-y-4">
              {!merchantQuery.data && !merchantQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  {t("whatsappTemplates.noCustomTemplate")}
                </p>
              )}
              <TemplateEditor
                templateEn={merchantEn}
                templateHe={merchantHe}
                onChangeEn={setMerchantEn}
                onChangeHe={setMerchantHe}
                onSave={saveMerchant}
                isSaving={upsertMerchantMut.isPending}
                t={t}
              />
              {merchantQuery.data && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <TrashIcon className="mr-2 size-4" />
                      {t("whatsappTemplates.deleteOverride")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("whatsappTemplates.deleteOverrideTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("whatsappTemplates.deleteOverrideConfirm")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteMerchant(selectedBpId)}>
                        {t("common.delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {/* Overrides table */}
          <div>
            <h3 className="mb-2 text-sm font-medium">
              {t("whatsappTemplates.merchantsWithOverrides")}
            </h3>
            {overrides.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("whatsappTemplates.noOverrides")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead className="w-32">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrides.map((tmpl) => (
                    <TableRow key={tmpl.id}>
                      <TableCell>
                        {tmpl.businessPartner?.name ?? `BP #${tmpl.businessPartnerId}`}
                        <Badge variant="secondary" className="ml-2">
                          custom
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedBpId(String(tmpl.businessPartnerId))}
                          >
                            <PencilIcon className="mr-1 size-3" />
                            {t("whatsappTemplates.editOverride")}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive">
                                <TrashIcon className="size-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("whatsappTemplates.deleteOverrideTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("whatsappTemplates.deleteOverrideConfirm")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMerchant(String(tmpl.businessPartnerId))}>
                                  {t("common.delete")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
