import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useForm, useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { MoreVerticalIcon } from "lucide-react"

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { ErrorMessage } from "@/components/ErrorMessage"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_CLASSES, ROLE_LABELS, USER_ROLES } from "@/lib/roles"
import { useDeleteUserMutation, useUpdateUserMutation, useUsersQuery } from "@/features/users/api"
import { ROUTES } from "@/lib/routes"
import { toast } from "sonner"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import type { AdminUser } from "@/features/users/types"
import type { UserRole } from "@/types/auth"

type EditFormValues = {
  displayName: string
  role: UserRole
  password: string
  businessPartnerId: string
  parentUserId: string
}

export function UsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useUsersQuery()
  const { data: businessPartners } = useBusinessPartnersQuery()
  const updateMutation = useUpdateUserMutation()
  const deleteMutation = useDeleteUserMutation()

  const [query, setQuery] = useState("")
  const [activeUser, setActiveUser] = useState<AdminUser | null>(null)
  const [dialogMode, setDialogMode] = useState<"view" | "edit" | null>(null)
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AdminUser | null>(null)

  const filtered = useMemo(() => {
    const list = data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((u) => {
      return (
        u.email.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      )
    })
  }, [data, query])

  const editForm = useForm<EditFormValues>({
    defaultValues: { displayName: "", role: "EMPLOYEE", password: "", businessPartnerId: "", parentUserId: "" },
  })
  const [editRole, editBusinessPartnerId, editParentUserId] = useWatch({
    control: editForm.control,
    name: ["role", "businessPartnerId", "parentUserId"],
  })

  useEffect(() => {
    if (activeUser && dialogMode === "edit") {
      editForm.reset({
        displayName: activeUser.display_name,
        role: activeUser.role,
        password: "",
        businessPartnerId: activeUser.business_partner_id ?? "",
        parentUserId: activeUser.parent_user_id ?? "",
      })
    }
  }, [activeUser, dialogMode, editForm])

  const businessPartnerOptions = businessPartners ?? []
  const merchantRoleUsers = useMemo(
    () => (data ?? []).filter((u) => u.role === USER_ROLES.MERCHANT && u.business_partner_id && u.business_partner_id === editBusinessPartnerId),
    [data, editBusinessPartnerId],
  )

  const onEditSubmit = async (values: EditFormValues) => {
    if (!activeUser) return
    await updateMutation.mutateAsync({
      uid: activeUser.uid,
      displayName: values.displayName,
      role: values.role,
      password: values.password.trim() ? values.password : undefined,
      businessPartnerId: values.role === USER_ROLES.ADMIN ? undefined : values.businessPartnerId || undefined,
      parentUserId: values.role === USER_ROLES.EMPLOYEE ? values.parentUserId || undefined : undefined,
    })
    setDialogMode(null)
    setActiveUser(null)
    toast.success(t("users.userUpdated"), {
      description: t("users.userUpdatedDesc", { name: activeUser.display_name }),
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("users.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("users.description")}
            </p>
          </div>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              placeholder={t("users.searchPlaceholder")}
              aria-label={t("users.searchUsers")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="button" onClick={() => navigate({ to: ROUTES.USERS_NEW })}>
              {t("users.newUser")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="users"
            isEmpty={filtered.length === 0}
            emptyMessage={t("users.noUsersMatch")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("common.role")}</TableHead>
                  <TableHead className="w-[80px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.uid}>
                    <TableCell className="font-medium">{u.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ROLE_BADGE_CLASSES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t("users.userActions")}>
                            <MoreVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setActiveUser(u)
                              setDialogMode("view")
                            }}
                          >
                            {t("common.view")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setActiveUser(u)
                              setDialogMode("edit")
                            }}
                          >
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={cn("text-destructive focus:text-destructive")}
                            onSelect={() => setPendingDeleteUser(u)}
                          >
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(activeUser && dialogMode)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveUser(null)
            setDialogMode(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "edit" ? t("users.editUser") : t("users.userDetails")}
            </DialogTitle>
            <DialogDescription>
              {activeUser ? `${activeUser.display_name} • ${activeUser.email}` : ""}
            </DialogDescription>
          </DialogHeader>

          {dialogMode === "view" && activeUser ? (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label>{t("common.role")}</Label>
                <p className="text-sm">{ROLE_LABELS[activeUser.role]}</p>
              </div>
              <div className="grid gap-1">
                <Label>{t("common.cardCode")}</Label>
                <p className="text-sm text-muted-foreground">{activeUser.card_code ?? "—"}</p>
              </div>
              <div className="grid gap-1">
                <Label>{t("common.lastLogin")}</Label>
                <p className="text-sm text-muted-foreground">
                  {activeUser.metadata?.lastLogin ?? "—"}
                </p>
              </div>
            </div>
          ) : null}

          {dialogMode === "edit" && activeUser ? (
            <form
              className="grid gap-4"
              onSubmit={editForm.handleSubmit(onEditSubmit)}
            >
              <div className="grid gap-1">
                <Label htmlFor="displayName">{t("common.displayName")}</Label>
                <Input id="displayName" required {...editForm.register("displayName")} />
              </div>
              <div className="grid gap-1">
                <Label>{t("common.role")}</Label>
                <Select
                  value={editRole}
                  onValueChange={(v) => editForm.setValue("role", v as UserRole)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.selectRole")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">{t("roles.admin")}</SelectItem>
                    <SelectItem value="MERCHANT">{t("roles.merchant")}</SelectItem>
                    <SelectItem value="EMPLOYEE">{t("roles.employee")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editRole !== USER_ROLES.ADMIN ? (
                <div className="grid gap-1">
                  <Label>{t("common.businessPartner")}</Label>
                  <Select
                    value={editBusinessPartnerId}
                    onValueChange={(v) => editForm.setValue("businessPartnerId", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("common.selectBusinessPartner")} />
                    </SelectTrigger>
                    <SelectContent>
                      {businessPartnerOptions.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {editRole === USER_ROLES.EMPLOYEE ? (
                <div className="grid gap-1">
                  <Label>{t("common.managerParentUser")}</Label>
                  <Select
                    value={editParentUserId ?? ""}
                    onValueChange={(v) => editForm.setValue("parentUserId", v)}
                    disabled={!editBusinessPartnerId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={editBusinessPartnerId ? t("common.selectManager") : t("common.selectBusinessPartnerFirst")} />
                    </SelectTrigger>
                    <SelectContent>
                      {merchantRoleUsers.map((u) => (
                        <SelectItem key={u.uid} value={u.uid}>
                          {u.display_name} • {u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-1">
                <Label htmlFor="password">{t("common.newPasswordOptional")}</Label>
                <PasswordInput id="password" {...editForm.register("password")} />
              </div>

              {updateMutation.isError ? (
                <ErrorMessage>
                  {updateMutation.error instanceof Error ? updateMutation.error.message : t("users.failedToUpdateUser")}
                </ErrorMessage>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setActiveUser(null)
                    setDialogMode(null)
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? t("common.saving") : t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(pendingDeleteUser)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteUser(null)
        }}
        title={t("users.deleteUser")}
        description={
          <>
            This will permanently remove{" "}
            <span className="font-medium text-foreground">
              {pendingDeleteUser?.display_name}
            </span>{" "}
            and delete the Supabase Auth account.
          </>
        }
        onConfirm={async () => {
          if (!pendingDeleteUser) return
          await deleteMutation.mutateAsync(pendingDeleteUser.uid)
          toast.success(t("users.userDeleted"), {
            description: t("users.userDeletedDesc", { name: pendingDeleteUser.display_name }),
          })
          setPendingDeleteUser(null)
        }}
        isPending={deleteMutation.isPending}
      />
    </>
  )
}
