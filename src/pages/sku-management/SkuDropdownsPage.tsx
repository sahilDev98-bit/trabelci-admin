import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Check, X, ChevronDown, ChevronUp } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  useSkuDropdownsQuery,
  useCreateSkuDropdownValueMutation,
  useUpdateSkuDropdownValueMutation,
  useDeleteSkuDropdownValueMutation,
  useSuggestSkuDropdownLabelsMutation,
} from "@/features/skuManagement/api"
import type { SkuDropdownValue } from "@/features/skuManagement/types"

// Rows visible before a card collapses behind "Show more" — keeps every
// field's card the same fixed height regardless of how many values it has
// (Size has 19, Finish has 7 — without this the grid looked ragged).
const COLLAPSED_ROW_COUNT = 6
const ROW_HEIGHT_PX = 32

// How long to wait after the last keystroke in the canonical Value box
// before asking the AI to suggest labels — long enough that normal typing
// speed never fires a request mid-word, short enough to feel responsive
// once you actually pause.
const LABEL_SUGGEST_DEBOUNCE_MS = 600

// Thin, theme-matched scrollbar for the collapsed value list — same colors
// as the SKU grid's scrollbar (.ceramic-panel) — instead of the browser's
// default light/white one, which stood out against this dark UI.
const SCROLLBAR_CSS = `
  .dropdown-values-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(30,36,60,.25) transparent;
  }
  .dropdown-values-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .dropdown-values-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .dropdown-values-scroll::-webkit-scrollbar-thumb {
    background: rgba(30,36,60,.25);
    border-radius: 8px;
  }
  .dark .dropdown-values-scroll {
    scrollbar-color: rgba(255,255,255,.18) transparent;
  }
  .dark .dropdown-values-scroll::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,.18);
  }
`

export function SkuDropdownsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: dropdowns = {}, isLoading } = useSkuDropdownsQuery()
  const create = useCreateSkuDropdownValueMutation()
  const update = useUpdateSkuDropdownValueMutation()
  const del = useDeleteSkuDropdownValueMutation()
  const suggestLabels = useSuggestSkuDropdownLabelsMutation()

  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newValue, setNewValue] = useState("")
  const [newLabelEn, setNewLabelEn] = useState("")
  const [newLabelHe, setNewLabelHe] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editLabelEn, setEditLabelEn] = useState("")
  const [editLabelHe, setEditLabelHe] = useState("")
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())
  // True once the user types directly into either label box themselves —
  // distinguishes "the AI suggested this" (safe to replace if the value
  // changes again) from "the user typed this" (never overwrite). Without
  // this, checking "are the labels non-empty" alone would also block
  // re-suggesting after the FIRST AI suggestion already filled them in.
  const [labelsManuallyEdited, setLabelsManuallyEdited] = useState(false)

  const toggleExpanded = (fieldKey: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) next.delete(fieldKey)
      else next.add(fieldKey)
      return next
    })
  }

  // Field keys that have managed dropdown values
  const fieldKeys = Object.keys(
    t("sku.fieldLabels", { returnObjects: true }) as Record<string, string>
  )

  const handleAdd = async (fieldKey: string) => {
    if (!newValue.trim()) return
    try {
      await create.mutateAsync({
        field_key: fieldKey,
        value: newValue.trim(),
        label_en: newLabelEn.trim() || newValue.trim(),
        label_he: newLabelHe.trim() || undefined,
        sort_order: (dropdowns[fieldKey]?.length ?? 0) * 10 + 10,
        is_active: true,
      })
      setNewValue("")
      setNewLabelEn("")
      setNewLabelHe("")
      setLabelsManuallyEdited(false)
      setAddingTo(null)
      toast.success(t("sku.dropdowns.added"))
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status
      const message = (err as { message?: string })?.message ?? ""
      if (status === 409 || message.includes("already exists")) {
        toast.error(t("sku.dropdowns.alreadyExists"))
      } else {
        toast.error(t("sku.dropdowns.failedToAdd"))
      }
    }
  }

  // Debounced auto-suggest: waits for a pause in typing the canonical value
  // (not every keystroke — that would spam the AI mid-word) before asking
  // for label suggestions. Re-arms on every change to newValue; the cleanup
  // function cancels the previous timer, so only the LAST pause within
  // LABEL_SUGGEST_DEBOUNCE_MS actually fires a request. Skips entirely once
  // the user has typed into either label box directly (labelsManuallyEdited)
  // — but as long as that hasn't happened, it keeps re-suggesting every time
  // the value changes, even overwriting an EARLIER AI suggestion, since that
  // earlier suggestion was never something the user actually asked to keep.
  useEffect(() => {
    if (!addingTo || !newValue.trim() || labelsManuallyEdited) return

    const timer = setTimeout(() => {
      suggestLabels.mutate(
        { value: newValue.trim(), fieldKey: addingTo },
        {
          onSuccess: (suggestion) => {
            setNewLabelEn(suggestion.label_en)
            setNewLabelHe(suggestion.label_he)
          },
        }
      )
    }, LABEL_SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newValue, addingTo, labelsManuallyEdited])

  const handleUpdate = async (id: number) => {
    try {
      await update.mutateAsync({
        id,
        payload: { value: editValue, label_en: editLabelEn, label_he: editLabelHe },
      })
      setEditingId(null)
      toast.success(t("sku.dropdowns.updated"))
    } catch {
      toast.error(t("sku.dropdowns.failedToUpdate"))
    }
  }

  const handleDelete = async (id: number, value: string) => {
    if (!confirm(t("sku.dropdowns.removeConfirm", { value }))) return
    try {
      await del.mutateAsync(id)
      toast.success(t("sku.dropdowns.removed"))
    } catch {
      toast.error(t("sku.dropdowns.failedToRemove"))
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <style>{SCROLLBAR_CSS}</style>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/sku-management" })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{t("sku.dropdowns.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sku.dropdowns.subtitle")}</p>
        </div>
      </div>

      {/* items-start: without it, CSS Grid stretches every card in a row to
          match the tallest one — so expanding one card's "Show more" also
          visually grew its row-neighbor, even though that neighbor's own
          state never changed. Each card now sizes to its own content only. */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {fieldKeys.map((fieldKey) => {
          const values: SkuDropdownValue[] = dropdowns[fieldKey] ?? []
          const fieldLabel = t(`sku.fieldLabels.${fieldKey}`, fieldKey)
          const isExpanded = expandedFields.has(fieldKey)
          const isCollapsible = values.length > COLLAPSED_ROW_COUNT
          return (
            <Card key={fieldKey} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{fieldLabel}</CardTitle>
                  <Badge variant="secondary">{values.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col">
                <div
                  className="dropdown-values-scroll space-y-1 overflow-y-auto transition-[max-height] duration-200"
                  style={{
                    maxHeight: isCollapsible && !isExpanded ? COLLAPSED_ROW_COUNT * ROW_HEIGHT_PX : undefined,
                  }}
                >
                {values.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
                  >
                    {editingId === v.id ? (
                      <>
                        <Input
                          className="h-7 flex-1 text-xs"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder={t("sku.dropdowns.canonical")}
                        />
                        <Input
                          className="h-7 w-28 text-xs"
                          value={editLabelEn}
                          onChange={(e) => setEditLabelEn(e.target.value)}
                          placeholder={t("sku.dropdowns.enLabel")}
                        />
                        <Input
                          className="h-7 w-24 text-xs"
                          value={editLabelHe}
                          onChange={(e) => setEditLabelHe(e.target.value)}
                          placeholder={t("sku.dropdowns.heLabel")}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleUpdate(v.id)}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 font-mono text-xs">{v.value}</span>
                        {v.label_en && v.label_en !== v.value && (
                          <span className="text-xs text-muted-foreground">{v.label_en}</span>
                        )}
                        {v.label_he && (
                          <span className="text-xs text-muted-foreground" dir="rtl">
                            {v.label_he}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            setEditingId(v.id)
                            setEditValue(v.value)
                            setEditLabelEn(v.label_en ?? "")
                            setEditLabelHe(v.label_he ?? "")
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => handleDelete(v.id, v.value)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
                </div>

                {addingTo === fieldKey ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Input
                      className="h-7 flex-1 text-xs"
                      placeholder={t("sku.dropdowns.canonical")}
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd(fieldKey)
                        if (e.key === "Escape") setAddingTo(null)
                      }}
                    />
                    <div className="relative">
                      <Input
                        className={`h-7 w-24 text-xs ${suggestLabels.isPending ? "animate-pulse pe-5" : ""}`}
                        placeholder={t("sku.dropdowns.enLabel")}
                        value={newLabelEn}
                        disabled={suggestLabels.isPending}
                        onChange={(e) => {
                          setNewLabelEn(e.target.value)
                          setLabelsManuallyEdited(true)
                        }}
                      />
                      {suggestLabels.isPending && (
                        <Loader2 className="absolute inset-e-1.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        className={`h-7 w-20 text-xs ${suggestLabels.isPending ? "animate-pulse pe-5" : ""}`}
                        placeholder={t("sku.dropdowns.heLabel")}
                        value={newLabelHe}
                        disabled={suggestLabels.isPending}
                        onChange={(e) => {
                          setNewLabelHe(e.target.value)
                          setLabelsManuallyEdited(true)
                        }}
                      />
                      {suggestLabels.isPending && (
                        <Loader2 className="absolute inset-e-1.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleAdd(fieldKey)}
                      disabled={create.isPending}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setAddingTo(null)
                        setLabelsManuallyEdited(false)
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 w-full justify-start text-xs text-muted-foreground"
                    onClick={() => {
                      setAddingTo(fieldKey)
                      setNewValue("")
                      setNewLabelEn("")
                      setNewLabelHe("")
                      setLabelsManuallyEdited(false)
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("sku.dropdowns.addValue")}
                  </Button>
                )}

                {isCollapsible && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 w-full justify-center text-xs text-muted-foreground"
                    onClick={() => toggleExpanded(fieldKey)}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="mr-1 h-3 w-3" />
                        {t("sku.dropdowns.showLess")}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-1 h-3 w-3" />
                        {t("sku.dropdowns.showMore", { count: values.length - COLLAPSED_ROW_COUNT })}
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
