import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { ArrowLeft, ArrowRight, Plus, Save, Loader2, ChevronUp, ChevronDown, X, PencilLine } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  useSkuTemplatesQuery,
  useCreateSkuTemplateMutation,
  useUpdateSkuTemplateMutation,
} from "@/features/skuManagement/api"
import type { SkuTemplate } from "@/features/skuManagement/types"

const AVAILABLE_FIELDS = [
  "supplier", "series", "color", "size", "finish",
  "country_of_origin", "shade", "tile_type", "price", "buy_unit_msr", "item_group_code",
  "manage_batch_numbers",
  "qty_per_carton", "qty_per_pallet",
  "supplier_code", "supplier_sku", "series_en", "color_en", "supplier_name_en",
  "product_image_urls", "gallery_image_urls",
]

// Fields that store a genuine separate English value on the row (not just a
// display label for a dropdown) — these are the only ones that get a
// Hebrew/English choice in the pattern builder.
interface PatternFieldOption {
  key: string
  enKey?: string
}
const PATTERN_FIELD_OPTIONS: PatternFieldOption[] = [
  { key: "supplier", enKey: "supplier_name_en" },
  { key: "series", enKey: "series_en" },
  { key: "color", enKey: "color_en" },
  { key: "size" },
  { key: "finish" },
  { key: "country_of_origin" },
  { key: "shade" },
  { key: "tile_type" },
  { key: "price" },
  { key: "buy_unit_msr" },
  { key: "qty_per_carton" },
  { key: "qty_per_pallet" },
  { key: "supplier_code" },
  { key: "supplier_sku" },
]

const SAMPLE_ROW: Record<string, string> = {
  supplier: "La Fabbrica",
  series: "Onice",
  color: "Ghiaccio",
  size: "60x120",
  finish: "Polished",
  country_of_origin: "Italy",
  shade: "Light",
  supplier_name_en: "La Fabbrica",
  series_en: "Onyx",
  color_en: "Ice",
  buy_unit_msr: "SQM",
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

// Patterns are always a space-separated sequence of {field} placeholders in
// every real template today — this parses that into an ordered field-key
// list for the structured picker. Returns null if the pattern has anything
// else in it (literal text, malformed tokens), so the caller can fall back
// to raw text editing instead of silently mangling something unusual.
function parsePatternToFields(pattern: string): string[] | null {
  const trimmed = pattern.trim()
  if (!trimmed) return []
  const tokens = trimmed.split(/\s+/)
  const fields: string[] = []
  for (const tok of tokens) {
    const m = tok.match(/^\{(\w+)\}$/)
    if (!m) return null
    fields.push(m[1])
  }
  return fields
}

function fieldsToPattern(fields: string[]): string {
  return fields.map((f) => `{${f}}`).join(" ")
}

function describeField(fieldKey: string, t: TFunction): { label: string; isEnglish: boolean } {
  const enMatch = PATTERN_FIELD_OPTIONS.find((o) => o.enKey === fieldKey)
  if (enMatch) return { label: t(`sku.fields.${enMatch.key}`, enMatch.key), isEnglish: true }
  return { label: t(`sku.fields.${fieldKey}`, fieldKey), isEnglish: false }
}

interface PatternFieldPickerProps {
  fields: string[]
  onChange: (fields: string[]) => void
}

function PatternFieldPicker({ fields, onChange }: PatternFieldPickerProps) {
  const { t } = useTranslation()
  const [selectedKey, setSelectedKey] = useState<string>(PATTERN_FIELD_OPTIONS[0].key)
  const [useEnglish, setUseEnglish] = useState(false)

  const selectedOption = PATTERN_FIELD_OPTIONS.find((o) => o.key === selectedKey) ?? PATTERN_FIELD_OPTIONS[0]

  const handleAdd = () => {
    const fieldToAdd = useEnglish && selectedOption.enKey ? selectedOption.enKey : selectedOption.key
    onChange([...fields, fieldToAdd])
  }

  const handleRemove = (index: number) => {
    onChange(fields.filter((_, i) => i !== index))
  }

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-10 flex-wrap gap-1.5 rounded-md border bg-muted/20 p-2">
        {fields.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("sku.templates.noFieldsYet")}</span>
        )}
        {fields.map((field, i) => {
          const { label, isEnglish } = describeField(field, t)
          return (
            <Badge key={`${field}-${i}`} variant="secondary" className="gap-1 py-1 pr-1">
              {label}
              {isEnglish && <span className="text-[10px] font-semibold text-muted-foreground">EN</span>}
              <button
                type="button"
                onClick={() => handleMove(i, -1)}
                disabled={i === 0}
                className="rounded hover:bg-black/10 disabled:opacity-30"
                aria-label={t("sku.templates.moveFieldLeft")}
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => handleMove(i, 1)}
                disabled={i === fields.length - 1}
                className="rounded hover:bg-black/10 disabled:opacity-30"
                aria-label={t("sku.templates.moveFieldRight")}
              >
                <ChevronDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                className="rounded hover:bg-black/10"
                aria-label={t("sku.templates.removeField")}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedKey} onValueChange={setSelectedKey}>
          <SelectTrigger className="h-8 w-50 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PATTERN_FIELD_OPTIONS.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {t(`sku.fields.${opt.key}`, opt.key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedOption.enKey && (
          <div className="flex overflow-hidden rounded-md border">
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${!useEnglish ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setUseEnglish(false)}
            >
              {t("sku.templates.hebrew")}
            </button>
            <button
              type="button"
              className={`px-2 py-1 text-xs transition-colors ${useEnglish ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
              onClick={() => setUseEnglish(true)}
            >
              {t("sku.templates.english")}
            </button>
          </div>
        )}

        <Button type="button" size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="mr-1 h-3 w-3" />
          {t("sku.templates.addField")}
        </Button>
      </div>
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

  const initialPattern = initial.name_pattern ?? "{supplier} {series} {color} {size} {finish}"
  const initialParsed = parsePatternToFields(initialPattern)
  const [rawMode, setRawMode] = useState(initialParsed === null)
  const [patternFields, setPatternFields] = useState<string[]>(initialParsed ?? [])
  const [rawPattern, setRawPattern] = useState(initialPattern)

  const pattern = rawMode ? rawPattern : fieldsToPattern(patternFields)

  const [sapFieldName, setSapFieldName] = useState(initial.sap_field_name ?? "")
  const [requiredFields, setRequiredFields] = useState<string[]>(
    initial.required_fields ?? ["supplier", "series", "color", "size", "finish"]
  )
  const [recommendedFields, setRecommendedFields] = useState<string[]>(
    initial.recommended_fields ?? ["country_of_origin", "shade"]
  )

  const toggleField = (field: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(field) ? list.filter((f) => f !== field) : [...list, field])
  }

  const switchToRaw = () => {
    setRawPattern(fieldsToPattern(patternFields))
    setRawMode(true)
  }

  const switchToPicker = () => {
    const parsed = parsePatternToFields(rawPattern)
    setPatternFields(parsed ?? [])
    setRawMode(false)
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
      sap_field_name: sapFieldName.trim() || undefined,
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
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("sku.templates.pattern")}</Label>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={rawMode ? switchToPicker : switchToRaw}
          >
            <PencilLine className="h-3 w-3" />
            {rawMode ? t("sku.templates.usePicker") : t("sku.templates.editRaw")}
          </button>
        </div>

        {rawMode ? (
          <>
            <Input
              value={rawPattern}
              onChange={(e) => setRawPattern(e.target.value)}
              placeholder="{supplier} {series} {color} {size} {finish}"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              {t("sku.templates.patternHelp")}{" "}
              {AVAILABLE_FIELDS.map((f) => `{${f}}`).join(", ")}
            </p>
          </>
        ) : (
          <PatternFieldPicker fields={patternFields} onChange={setPatternFields} />
        )}
      </div>

      <div>
        <Label className="text-xs">{t("sku.templates.preview")}</Label>
        <div className="mt-1">
          <NamePreview pattern={pattern} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("sku.templates.sapFieldName")}</Label>
        <Input
          value={sapFieldName}
          onChange={(e) => setSapFieldName(e.target.value)}
          placeholder="ItemName"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t("sku.templates.sapFieldNameHelp")}
        </p>
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
                  <CardTitle className="text-sm">{tmpl.name}</CardTitle>
                  <div className="flex items-center gap-1">
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
                </div>
                {tmpl.description && (
                  <p className="text-xs text-muted-foreground">{tmpl.description}</p>
                )}
                <div className="flex items-center gap-1 pt-1 text-xs">
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  {tmpl.sap_field_name ? (
                    <>
                      <span className="text-muted-foreground">{t("sku.templates.targetsLabel")}</span>
                      <span className="font-mono font-medium">{tmpl.sap_field_name}</span>
                    </>
                  ) : (
                    <span className="text-amber-600">{t("sku.templates.noTargetField")}</span>
                  )}
                </div>
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
