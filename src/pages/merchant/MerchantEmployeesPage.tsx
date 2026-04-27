import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { MoreVerticalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { ErrorMessage } from "@/components/ErrorMessage"
import { ApiError } from "@/lib/apiClient"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ROLE_LABELS, USER_ROLES } from "@/lib/roles"
import {
  useMerchantEmployeesQuery,
  useCreateMerchantEmployeeMutation,
  useUpdateMerchantEmployeeMutation,
  useDeleteMerchantEmployeeMutation,
} from "@/features/merchantEmployees/api"
import type { AdminUser } from "@/features/users/types"

type CreateFormValues = {
  email: string
  displayName: string
  password: string
  confirmPassword: string
}

type EditFormValues = {
  displayName: string
  email: string
  password: string
}

export function MerchantEmployeesPage() {
  const { t } = useTranslation()
  const { data: users, isLoading, isError, error } = useMerchantEmployeesQuery()
  const createMutation = useCreateMerchantEmployeeMutation()
  const updateMutation = useUpdateMerchantEmployeeMutation()
  const deleteMutation = useDeleteMerchantEmployeeMutation()

  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [activeUser, setActiveUser] = useState<AdminUser | null>(null)
  const [dialogMode, setDialogMode] = useState<"view" | "edit" | null>(null)
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AdminUser | null>(null)

  const filtered = useMemo(() => {
    const list = users ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    )
  }, [users, query])

  // Create form
  const createForm = useForm<CreateFormValues>({
    defaultValues: { email: "", displayName: "", password: "", confirmPassword: "" },
  })

  const onCreateSubmit = async (values: CreateFormValues) => {
    if (values.password !== values.confirmPassword) {
      createForm.setError("confirmPassword", { message: t("common.passwordsDoNotMatch") })
      return
    }

    await createMutation.mutateAsync({
      email: values.email,
      password: values.password,
      displayName: values.displayName,
      role: USER_ROLES.EMPLOYEE,
    })

    createForm.reset()
    setCreateOpen(false)
    toast.success(t("employees.employeeCreated"), { description: t("employees.employeeCreatedDesc", { name: values.displayName }) })
  }

  // Edit form
  const editForm = useForm<EditFormValues>({
    defaultValues: { displayName: "", email: "", password: "" },
  })

  useEffect(() => {
    if (activeUser && dialogMode === "edit") {
      editForm.reset({ displayName: activeUser.display_name, email: activeUser.email, password: "" })
    }
  }, [activeUser, dialogMode, editForm])

  const onEditSubmit = async (values: EditFormValues) => {
    if (!activeUser) return
    await updateMutation.mutateAsync({
      uid: activeUser.uid,
      displayName: values.displayName,
      email: values.email !== activeUser.email ? values.email : undefined,
      password: values.password.trim() ? values.password : undefined,
    })
    setDialogMode(null)
    setActiveUser(null)
    toast.success(t("employees.employeeUpdated"), { description: t("employees.employeeUpdatedDesc", { name: activeUser.display_name }) })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>{t("employees.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("employees.description")}
            </p>
          </div>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input
              placeholder={t("employees.searchPlaceholder")}
              aria-label={t("employees.searchEmployees")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("employees.new")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="employees"
            isEmpty={filtered.length === 0}
            emptyMessage={t("employees.noMatch")}
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
                      <Badge variant="secondary">{ROLE_LABELS[u.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t("employees.employeeActions")}>
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

      {/* Create employee dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false)
            createForm.reset()
            createMutation.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("employees.createEmployee")}</DialogTitle>
            <DialogDescription>{t("employees.createEmployeeDesc")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="grid gap-1">
              <Label htmlFor="create-email">{t("common.email")}</Label>
              <Input id="create-email" type="email" autoComplete="email" required {...createForm.register("email")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="create-displayName">{t("common.displayName")}</Label>
              <Input id="create-displayName" required {...createForm.register("displayName")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="create-password">{t("common.password")}</Label>
              <PasswordInput id="create-password" required {...createForm.register("password")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="create-confirmPassword">{t("common.confirmPassword")}</Label>
              <PasswordInput id="create-confirmPassword" required {...createForm.register("confirmPassword")} />
              {createForm.formState.errors.confirmPassword?.message ? (
                <ErrorMessage>{createForm.formState.errors.confirmPassword.message}</ErrorMessage>
              ) : null}
            </div>

            {createMutation.isError ? (
              <ErrorMessage>
                {createMutation.error instanceof ApiError && createMutation.error.i18nKey
                  ? t(createMutation.error.i18nKey)
                  : t("employees.failedToCreateEmployee")}
              </ErrorMessage>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.creating") : t("employees.createEmployeeBtn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View / Edit employee dialog */}
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
              {dialogMode === "edit" ? t("employees.editEmployee") : t("employees.employeeDetails")}
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
            <form className="grid gap-4" onSubmit={editForm.handleSubmit(onEditSubmit)}>
              <div className="grid gap-1">
                <Label htmlFor="edit-displayName">{t("common.displayName")}</Label>
                <Input id="edit-displayName" required {...editForm.register("displayName")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-email">{t("common.email")}</Label>
                <Input id="edit-email" type="email" required {...editForm.register("email")} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="edit-password">{t("common.newPasswordOptional")}</Label>
                <PasswordInput id="edit-password" {...editForm.register("password")} />
              </div>

              {updateMutation.isError ? (
                <ErrorMessage>
                  {updateMutation.error instanceof Error ? updateMutation.error.message : t("employees.failedToUpdateEmployee")}
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

      {/* Delete confirmation */}
      <ConfirmDeleteDialog
        open={Boolean(pendingDeleteUser)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteUser(null)
        }}
        title={t("employees.deleteEmployee")}
        description={
          <>
            This will permanently remove{" "}
            <span className="font-medium text-foreground">
              {pendingDeleteUser?.display_name}
            </span>{" "}
            and delete the account.
          </>
        }
        onConfirm={async () => {
          if (!pendingDeleteUser) return
          await deleteMutation.mutateAsync(pendingDeleteUser.uid)
          toast.success(t("employees.employeeDeleted"), {
            description: t("employees.employeeDeletedDesc", { name: pendingDeleteUser.display_name }),
          })
          setPendingDeleteUser(null)
        }}
        isPending={deleteMutation.isPending}
      />
    </>
  )
}
