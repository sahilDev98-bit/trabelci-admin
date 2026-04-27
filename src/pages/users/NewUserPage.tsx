import { useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { ErrorMessage } from "@/components/ErrorMessage"
import { ApiError } from "@/lib/apiClient"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCreateUserMutation, useUsersQuery } from "@/features/users/api"
import { useBusinessPartnersQuery } from "@/features/businessPartners/api"
import type { CreateUserInput } from "@/features/users/types"
import { USER_ROLES } from "@/lib/roles"
import { ROUTES } from "@/lib/routes"
import type { UserRole } from "@/types/auth"

type FormValues = CreateUserInput & { confirmPassword: string }

export function NewUserPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createMutation = useCreateUserMutation()
  const { data: users } = useUsersQuery()
  const { data: businessPartners } = useBusinessPartnersQuery()

  const form = useForm<FormValues>({
    defaultValues: {
      email: "",
      displayName: "",
      role: "EMPLOYEE",
      password: "",
      confirmPassword: "",
      businessPartnerId: "",
      parentUserId: "",
    },
  })
  const [role, businessPartnerId, parentUserId] = useWatch({
    control: form.control,
    name: ["role", "businessPartnerId", "parentUserId"],
  })

  const businessPartnerOptions = businessPartners ?? []
  const merchantRoleUsers = useMemo(
    () => (users ?? []).filter((u) => u.role === USER_ROLES.MERCHANT && u.business_partner_id && u.business_partner_id === businessPartnerId),
    [users, businessPartnerId],
  )

  const onSubmit = async (values: FormValues) => {
    if (values.password !== values.confirmPassword) {
      form.setError("confirmPassword", { message: t("common.passwordsDoNotMatch") })
      return
    }

    await createMutation.mutateAsync({
      email: values.email,
      password: values.password,
      displayName: values.displayName,
      role: values.role,
      businessPartnerId: values.role === USER_ROLES.ADMIN ? undefined : values.businessPartnerId || undefined,
      parentUserId: values.role === USER_ROLES.EMPLOYEE ? values.parentUserId || undefined : undefined,
    })

    navigate({ to: ROUTES.USERS, replace: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("users.createUser")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-1">
            <Label htmlFor="email">{t("common.email")}</Label>
            <Input id="email" type="email" autoComplete="email" required {...form.register("email")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="displayName">{t("common.displayName")}</Label>
            <Input id="displayName" required {...form.register("displayName")} />
          </div>
          <div className="grid gap-1">
            <Label>{t("common.role")}</Label>
            <Select
              value={role}
              onValueChange={(v) => form.setValue("role", v as UserRole)}
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
          {role !== USER_ROLES.ADMIN ? (
            <div className="grid gap-1">
              <Label>{t("common.businessPartner")}</Label>
              <Select
                value={businessPartnerId}
                onValueChange={(v) => form.setValue("businessPartnerId", v)}
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
          {role === USER_ROLES.EMPLOYEE ? (
            <div className="grid gap-1">
              <Label>{t("common.managerParentUser")}</Label>
              <Select
                value={parentUserId ?? ""}
                onValueChange={(v) => form.setValue("parentUserId", v)}
                disabled={!businessPartnerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={businessPartnerId ? t("common.selectManager") : t("common.selectBusinessPartnerFirst")} />
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
            <Label htmlFor="password">{t("common.password")}</Label>
            <PasswordInput id="password" required {...form.register("password")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="confirmPassword">{t("common.confirmPassword")}</Label>
            <PasswordInput
              id="confirmPassword"
              required
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword?.message ? (
              <ErrorMessage>{form.formState.errors.confirmPassword.message}</ErrorMessage>
            ) : null}
          </div>

          {createMutation.isError ? (
            <ErrorMessage>
              {createMutation.error instanceof ApiError && createMutation.error.i18nKey
                ? t(createMutation.error.i18nKey)
                : t("users.failedToCreateUser")}
            </ErrorMessage>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => navigate({ to: ROUTES.USERS })}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t("common.creating") : t("users.createUserBtn")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
