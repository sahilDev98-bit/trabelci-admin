import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, SaveIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  useUpdateFieldVisibilityMutation,
  useDeleteUserFieldVisibilityMutation,
} from "@/features/fieldVisibility/api"
import type { FieldDefinition, UserFieldOverride } from "@/features/fieldVisibility/types"
import { FieldCheckboxGrid } from "./FieldCheckboxGrid"

interface UserFieldOverrideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserFieldOverride | null
  fields: FieldDefinition[]
  bpVisibleFields: string[] | null
}

export function UserFieldOverrideDialog({
  open,
  onOpenChange,
  user,
  fields,
  bpVisibleFields,
}: UserFieldOverrideDialogProps) {
  const { t } = useTranslation()
  const updateMutation = useUpdateFieldVisibilityMutation()
  const deleteMutation = useDeleteUserFieldVisibilityMutation()

  const allFieldKeys = fields.map((f) => f.key)
  const defaultFieldKeys = allFieldKeys.filter((k) => k !== 'latestWarehouseTInventoryPrice')
  const validKeys = new Set(allFieldKeys)
  const effectiveFields = (user?.visibleFields ?? bpVisibleFields ?? defaultFieldKeys).filter((k) => validKeys.has(k))
  const [selected, setSelected] = useState<Set<string>>(new Set(effectiveFields))

  useEffect(() => {
    if (user) {
      const valid = new Set(fields.map((f) => f.key))
      const effective = (user.visibleFields ?? bpVisibleFields ?? defaultFieldKeys).filter((k) => valid.has(k))
      setSelected(new Set(effective))
    }
  }, [user, bpVisibleFields])

  if (!user) return null

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        userId: user.userId,
        visibleFields: Array.from(selected),
      })
      toast.success(t("fieldVisibility.userSaved", "User field visibility updated"))
      onOpenChange(false)
    } catch {
      toast.error(t("fieldVisibility.userSaveError", "Failed to update user field visibility"))
    }
  }

  const handleReset = async () => {
    try {
      await deleteMutation.mutateAsync(user.userId)
      toast.success(t("fieldVisibility.userReset", "User override removed, inheriting merchant defaults"))
      onOpenChange(false)
    } catch {
      toast.error(t("fieldVisibility.userResetError", "Failed to reset user field visibility"))
    }
  }

  const isPending = updateMutation.isPending || deleteMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("fieldVisibility.editUser", "Edit Field Visibility")}: {user.displayName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </DialogHeader>

        <FieldCheckboxGrid fields={fields} selected={selected} onChange={setSelected} />

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {user.hasOverride && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleReset}
            >
              {deleteMutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RotateCcwIcon className="size-4" />
              )}
              {t("fieldVisibility.resetToDefault", "Reset to Merchant Default")}
            </Button>
          )}
          <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
            {updateMutation.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SaveIcon className="size-4" />
            )}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
