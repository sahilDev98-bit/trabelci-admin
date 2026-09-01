import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Loader2Icon, SaveIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/apiClient"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import {
  useAvailableFieldsQuery,
  useFieldVisibilityForBPQuery,
  useBPUsersFieldVisibilityQuery,
  useUpdateFieldVisibilityMutation,
} from "@/features/fieldVisibility/api"
import type { UserFieldOverride } from "@/features/fieldVisibility/types"
import { FieldCheckboxGrid } from "./components/FieldCheckboxGrid"
import { UserFieldOverrideDialog } from "./components/UserFieldOverrideDialog"

export function FieldVisibilityPage() {
  const { t } = useTranslation()
  const [selectedBpId, setSelectedBpId] = useState<string | null>(null)
  const [bpSelected, setBpSelected] = useState<Set<string>>(new Set())
  const [editingUser, setEditingUser] = useState<UserFieldOverride | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const bpQuery = useBusinessPartnersQuery()
  const fieldsQuery = useAvailableFieldsQuery()
  const bpConfigQuery = useFieldVisibilityForBPQuery(selectedBpId)
  const bpUsersQuery = useBPUsersFieldVisibilityQuery(selectedBpId)
  const updateMutation = useUpdateFieldVisibilityMutation()

  const allFields = fieldsQuery.data ?? []
  const allFieldKeys = allFields.map((f) => f.key)
  const defaultFieldKeys = allFieldKeys.filter((k) => k !== 'latestWarehouseTInventoryPrice')

  // Sync local state when BP config loads, filtering out any stale keys no longer in the defs
  useEffect(() => {
    if (bpConfigQuery.data) {
      const validKeys = new Set(allFieldKeys)
      setBpSelected(new Set(bpConfigQuery.data.visibleFields.filter((k) => validKeys.has(k))))
    } else if (bpConfigQuery.isFetched && !bpConfigQuery.data) {
      // No config yet — inventory price excluded by default
      setBpSelected(new Set(defaultFieldKeys))
    }
  }, [bpConfigQuery.data, bpConfigQuery.isFetched, allFields.length])

  const serverFields = bpConfigQuery.data?.visibleFields ?? defaultFieldKeys
  const isDirty =
    bpSelected.size !== serverFields.length ||
    serverFields.some((k) => !bpSelected.has(k))

  const handleBpChange = (bpId: string) => {
    setSelectedBpId(bpId || null)
    setBpSelected(new Set())
  }

  const handleSaveBP = async () => {
    if (!selectedBpId) return
    try {
      await updateMutation.mutateAsync({
        businessPartnerId: Number(selectedBpId),
        visibleFields: Array.from(bpSelected),
        expectedUpdatedAt: bpConfigQuery.data?.updatedAt ?? null,
      })
      toast.success(t("fieldVisibility.bpSaved", "Merchant field visibility updated"))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else saved a change to this BP's config since we loaded it —
        // refetch so the admin sees the current state before reapplying
        // their edit, instead of silently losing it (BUG-029).
        await bpConfigQuery.refetch()
        toast.error(
          t(
            "fieldVisibility.bpSaveConflict",
            "This configuration was changed by someone else. It's been refreshed below — please reapply your change.",
          ),
        )
        return
      }
      toast.error(t("fieldVisibility.bpSaveError", "Failed to update merchant field visibility"))
    }
  }

  const handleEditUser = (user: UserFieldOverride) => {
    setEditingUser(user)
    setDialogOpen(true)
  }

  const isLoading = bpConfigQuery.isLoading || fieldsQuery.isLoading

  return (
    <div className="grid gap-6">
      {/* Business Partner Selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t("fieldVisibility.title", "Field Visibility")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "fieldVisibility.description",
              "Control which product detail fields are visible to merchants and their users.",
            )}
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium">
              {t("fieldVisibility.selectBP", "Business Partner")}
            </label>
            <Select value={selectedBpId ?? ""} onValueChange={handleBpChange}>
              <SelectTrigger className="w-[320px]">
                <SelectValue
                  placeholder={t(
                    "fieldVisibility.selectBPPlaceholder",
                    "Select a business partner...",
                  )}
                />
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

          {!selectedBpId && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(
                "fieldVisibility.selectBPPrompt",
                "Select a business partner above to configure field visibility.",
              )}
            </p>
          )}

          {selectedBpId && isLoading && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
              <span>{t("common.loading")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Merchant Default Config */}
      {selectedBpId && !isLoading && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {t("fieldVisibility.merchantDefaults", "Merchant Default Fields")}
              </CardTitle>
              <Button
                size="sm"
                disabled={!isDirty || updateMutation.isPending}
                onClick={handleSaveBP}
              >
                {updateMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SaveIcon className="size-4" />
                )}
                {t("common.save")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "fieldVisibility.merchantDefaultsDesc",
                "These fields will be visible to all users under this merchant by default.",
              )}
            </p>
          </CardHeader>
          <CardContent>
            <FieldCheckboxGrid
              fields={allFields}
              selected={bpSelected}
              onChange={setBpSelected}
            />
          </CardContent>
        </Card>
      )}

      {/* User Overrides */}
      {selectedBpId && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("fieldVisibility.userOverrides", "User-Level Overrides")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {t(
                "fieldVisibility.userOverridesDesc",
                "Override field visibility for individual users. Users without an override inherit the merchant defaults above.",
              )}
            </p>
          </CardHeader>
          <CardContent>
            {bpUsersQuery.isLoading && (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                <Loader2Icon className="size-5 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            )}

            {!bpUsersQuery.isLoading && (bpUsersQuery.data?.users ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("fieldVisibility.noUsers", "No users found for this merchant.")}
              </p>
            )}

            {!bpUsersQuery.isLoading && (bpUsersQuery.data?.users ?? []).length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fieldVisibility.userName", "Name")}</TableHead>
                    <TableHead>{t("fieldVisibility.userEmail", "Email")}</TableHead>
                    <TableHead>{t("fieldVisibility.userRole", "Role")}</TableHead>
                    <TableHead>{t("fieldVisibility.overrideStatus", "Status")}</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(bpUsersQuery.data?.users ?? []).map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell className="font-medium">{user.displayName}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell>
                        {user.hasOverride ? (
                          <Badge variant="default">
                            {t("fieldVisibility.customized", "Customized")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t("fieldVisibility.inherited", "Inherited")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditUser(user)}
                        >
                          <PencilIcon className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* User Override Dialog */}
      <UserFieldOverrideDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editingUser}
        fields={allFields}
        bpVisibleFields={bpConfigQuery.data?.visibleFields ?? null}
        onConflict={() => bpUsersQuery.refetch()}
      />
    </div>
  )
}
