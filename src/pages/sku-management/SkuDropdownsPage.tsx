import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react"
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
} from "@/features/skuManagement/api"
import type { SkuDropdownValue } from "@/features/skuManagement/types"

export function SkuDropdownsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: dropdowns = {}, isLoading } = useSkuDropdownsQuery()
  const create = useCreateSkuDropdownValueMutation()
  const update = useUpdateSkuDropdownValueMutation()
  const del = useDeleteSkuDropdownValueMutation()

  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newValue, setNewValue] = useState("")
  const [newLabelEn, setNewLabelEn] = useState("")
  const [newLabelHe, setNewLabelHe] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editLabelEn, setEditLabelEn] = useState("")
  const [editLabelHe, setEditLabelHe] = useState("")

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

      <div className="grid gap-4 md:grid-cols-2">
        {fieldKeys.map((fieldKey) => {
          const values: SkuDropdownValue[] = dropdowns[fieldKey] ?? []
          const fieldLabel = t(`sku.fieldLabels.${fieldKey}`, fieldKey)
          return (
            <Card key={fieldKey}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{fieldLabel}</CardTitle>
                  <Badge variant="secondary">{values.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
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
                    <Input
                      className="h-7 w-24 text-xs"
                      placeholder={t("sku.dropdowns.enLabel")}
                      value={newLabelEn}
                      onChange={(e) => setNewLabelEn(e.target.value)}
                    />
                    <Input
                      className="h-7 w-20 text-xs"
                      placeholder={t("sku.dropdowns.heLabel")}
                      value={newLabelHe}
                      onChange={(e) => setNewLabelHe(e.target.value)}
                    />
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
                      onClick={() => setAddingTo(null)}
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
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("sku.dropdowns.addValue")}
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
