import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus, Save, Star, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  useSkuTemplatesQuery,
  useCreateSkuTemplateMutation,
  useUpdateSkuTemplateMutation,
} from "@/features/skuManagement/api"
import type { SkuTemplate } from "@/features/skuManagement/types"

const AVAILABLE_FIELDS = [
  "company", "series", "color", "size", "finish",
  "country_of_origin", "thickness", "r_rating", "surface_type",
  "supplier", "model", "subcategory", "product_type",
]

const SAMPLE_ROW: Record<string, string> = {
  company: "La Fabbrica",
  series: "Onice",
  color: "Ghiaccio",
  size: "60x120",
  finish: "Polished",
  country_of_origin: "Italy",
  thickness: "10mm",
}

function NamePreview({ pattern }: { pattern: string }) {
  const preview = pattern.replace(/\{(\w+)\}/g, (_, key) =>
    SAMPLE_ROW[key] ? SAMPLE_ROW[key].toUpperCase() : `[${key.toUpperCase()}]`
  )
  return (
    <div className="rounded-md border bg-muted/30 p-2 font-mono text-xs">
      {preview || "—"}
    </div>
  )
}

interface TemplateFormProps {
  initial?: Partial<SkuTemplate>
  onSave: (data: Omit<SkuTemplate, "id" | "created_at">) => Promise<void>
  onCancel: () => void
  isSaving: boolean
}

function TemplateForm({ initial = {}, onSave, onCancel, isSaving }: TemplateFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial.name ?? "")
  const [description, setDescription] = useState(initial.description ?? "")
  const [pattern, setPattern] = useState(
    initial.name_pattern ?? "{company} | {series} {color} | {size} | {finish}"
  )
  const [requiredFields, setRequiredFields] = useState<string[]>(
    initial.required_fields ?? ["company", "series", "color", "size", "finish"]
  )
  const [recommendedFields, setRecommendedFields] = useState<string[]>(
    initial.recommended_fields ?? ["country_of_origin", "thickness", "r_rating"]
  )

  const toggleField = (field: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(field) ? list.filter((f) => f !== field) : [...list, field])
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("sku.templates.templateName"))
      return
    }
    await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      name_pattern: pattern.trim(),
      required_fields: requiredFields,
      recommended_fields: recommendedFields,
      is_default: initial.is_default ?? false,
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t("sku.templates.templateName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Porcelain Tile"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("sku.templates.description")}</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("sku.templates.pattern")}</Label>
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="{company} | {series} {color} | {size} | {finish}"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("sku.templates.patternHelp")}{" "}
          {AVAILABLE_FIELDS.map((f) => `{${f}}`).join(", ")}
        </p>
      </div>

      <div>
        <Label className="text-xs">{t("sku.templates.preview")}</Label>
        <div className="mt-1">
          <NamePreview pattern={pattern} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-red-600">{t("sku.templates.required")}</Label>
          <div className="flex flex-wrap gap-1">
            {AVAILABLE_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f, requiredFields, setRequiredFields)}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  requiredFields.includes(f)
                    ? "bg-red-100 text-red-700 ring-1 ring-red-300"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t(`sku.fields.${f}`, f)}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-amber-600">{t("sku.templates.recommended")}</Label>
          <div className="flex flex-wrap gap-1">
            {AVAILABLE_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f, recommendedFields, setRecommendedFields)}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  recommendedFields.includes(f)
                    ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t(`sku.fields.${f}`, f)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          <Save className="mr-1 h-3 w-3" />
          {t("sku.templates.saveTemplate")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  )
}

export function SkuTemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: templates = [], isLoading } = useSkuTemplatesQuery()
  const create = useCreateSkuTemplateMutation()
  const update = useUpdateSkuTemplateMutation()

  const [showNew, setShowNew] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const handleCreate = async (data: Omit<SkuTemplate, "id" | "created_at">) => {
    try {
      await create.mutateAsync(data)
      setShowNew(false)
      toast.success(t("sku.templates.created"))
    } catch {
      toast.error(t("sku.templates.failedToCreate"))
    }
  }

  const handleUpdate = async (id: number, data: Partial<SkuTemplate>) => {
    try {
      await update.mutateAsync({ id, payload: data })
      setEditingId(null)
      toast.success(t("sku.templates.saved"))
    } catch {
      toast.error(t("sku.templates.failedToSave"))
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/sku-management" })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{t("sku.templates.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("sku.templates.subtitle")}</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowNew(true)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("sku.templates.newTemplate")}
        </Button>
      </div>

      {showNew && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("sku.templates.newTemplate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateForm
              onSave={handleCreate}
              onCancel={() => setShowNew(false)}
              isSaving={create.isPending}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((tmpl) => (
            <Card key={tmpl.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tmpl.is_default && (
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    )}
                    <CardTitle className="text-sm">{tmpl.name}</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(editingId === tmpl.id ? null : tmpl.id)}
                  >
                    {editingId === tmpl.id
                      ? t("sku.templates.cancel")
                      : t("sku.templates.edit")}
                  </Button>
                </div>
                {tmpl.description && (
                  <p className="text-xs text-muted-foreground">{tmpl.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {editingId === tmpl.id ? (
                  <TemplateForm
                    initial={tmpl}
                    onSave={(data) => handleUpdate(tmpl.id, data)}
                    onCancel={() => setEditingId(null)}
                    isSaving={update.isPending}
                  />
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("sku.templates.pattern")}</p>
                      <p className="font-mono text-xs">{tmpl.name_pattern}</p>
                    </div>
                    <NamePreview pattern={tmpl.name_pattern ?? ""} />
                    <div className="flex flex-wrap gap-1">
                      {tmpl.required_fields.map((f) => (
                        <Badge key={f} variant="outline" className="border-red-200 text-xs text-red-600">
                          {t(`sku.fields.${f}`, f)}
                        </Badge>
                      ))}
                      {tmpl.recommended_fields.map((f) => (
                        <Badge key={f} variant="outline" className="border-amber-200 text-xs text-amber-600">
                          {t(`sku.fields.${f}`, f)}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
