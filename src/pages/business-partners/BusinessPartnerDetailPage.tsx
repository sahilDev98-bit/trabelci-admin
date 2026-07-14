import { useMemo, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useForm, useWatch } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ArrowLeft, CheckCircle2, Link2, Loader2, Plus, Users, XCircle } from "lucide-react"

import { ErrorMessage } from "@/components/ErrorMessage"
import { ApiError } from "@/lib/apiClient"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  lookupSapBp,
  useBusinessPartnerQuery,
  useBusinessPartnerUsersQuery,
  useLinkBusinessPartnerToSapMutation,
  useUpdateBusinessPartnerMultiplierMutation,
} from "@/features/businessPartners/api"
import type { SapBpLookupResult } from "@/features/businessPartners/types"
import { businessPartnersQueryKeys } from "@/features/businessPartners/queryKeys"
import { useCreateUserMutation } from "@/features/users/api"
import { formatDate } from "@/lib/formatDate"
import { USER_ROLES } from "@/lib/roles"
import { ROUTES } from "@/lib/routes"
import type { UserRole } from "@/types/auth"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRoleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "MERCHANT") return "default"
  if (role === "EMPLOYEE") return "secondary"
  return "outline"
}

// ---------------------------------------------------------------------------
// Add User Dialog
// ---------------------------------------------------------------------------

type AddUserFormValues = {
  email: string
  displayName: string
  role: UserRole
  password: string
  confirmPassword: string
  parentUserId: string
}

function AddUserDialog({
  open,
  onOpenChange,
  bpId,
  merchants,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bpId: string
  merchants: { userId: string; displayName: string; email: string }[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const createMutation = useCreateUserMutation()

  const bpRoleOptions = useMemo(() => [
    { value: "MERCHANT" as UserRole, label: t("roles.merchant") },
    { value: "EMPLOYEE" as UserRole, label: t("roles.employee") },
  ], [t])

  const form = useForm<AddUserFormValues>({
    defaultValues: {
      email: "",
      displayName: "",
      role: "MERCHANT",
      password: "",
      confirmPassword: "",
      parentUserId: "",
    },
  })

  const [role, parentUserId] = useWatch({ control: form.control, name: ["role", "parentUserId"] })

  const handleClose = () => {
    onOpenChange(false)
    form.reset()
    createMutation.reset()
  }

  const onSubmit = async (values: AddUserFormValues) => {
    if (values.password !== values.confirmPassword) {
      form.setError("confirmPassword", { message: t("common.passwordsDoNotMatch") })
      return
    }

    await createMutation.mutateAsync(
      {
        email: values.email,
        password: values.password,
        displayName: values.displayName,
        role: values.role,
        businessPartnerId: bpId,
        parentUserId: values.role === USER_ROLES.EMPLOYEE ? values.parentUserId || undefined : undefined,
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: businessPartnersQueryKeys.users(bpId) })
          handleClose()
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("businessPartners.addUser")}</DialogTitle>
          <DialogDescription>
            {t("businessPartners.addUserDesc")}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid gap-1">
            <Label htmlFor="add-email">{t("common.email")}</Label>
            <Input id="add-email" type="email" autoComplete="email" required {...form.register("email")} />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="add-displayName">{t("common.displayName")}</Label>
            <Input id="add-displayName" required {...form.register("displayName")} />
          </div>

          <div className="grid gap-1">
            <Label>{t("common.role")}</Label>
            <Select value={role} onValueChange={(v) => form.setValue("role", v as UserRole)}>
              <SelectTrigger>
                <SelectValue placeholder={t("common.selectRole")} />
              </SelectTrigger>
              <SelectContent>
                {bpRoleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {role === USER_ROLES.EMPLOYEE ? (
            <div className="grid gap-1">
              <Label>{t("common.managerParentUser")}</Label>
              <Select
                value={parentUserId}
                onValueChange={(v) => form.setValue("parentUserId", v)}
                disabled={merchants.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={merchants.length > 0 ? t("common.selectManager") : t("businessPartners.noMerchantsAvailable")} />
                </SelectTrigger>
                <SelectContent>
                  {merchants.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.displayName} &bull; {m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="grid gap-1">
            <Label htmlFor="add-password">{t("common.password")}</Label>
            <PasswordInput id="add-password" required {...form.register("password")} />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="add-confirmPassword">{t("common.confirmPassword")}</Label>
            <PasswordInput id="add-confirmPassword" required {...form.register("confirmPassword")} />
            {form.formState.errors.confirmPassword?.message ? (
              <ErrorMessage>{form.formState.errors.confirmPassword.message}</ErrorMessage>
            ) : null}
          </div>

          {createMutation.isError ? (
            <ErrorMessage>
              {createMutation.error instanceof ApiError && createMutation.error.i18nKey
                ? t(createMutation.error.i18nKey)
                : t("businessPartners.failedToCreateUser")}
            </ErrorMessage>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t("common.creating") : t("businessPartners.createUser")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Link to SAP customer
// ---------------------------------------------------------------------------

function LinkSapCard({ bpId }: { bpId: string }) {
  const { t } = useTranslation()
  const [codeInput, setCodeInput] = useState("")
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResult, setLookupResult] = useState<SapBpLookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const linkMutation = useLinkBusinessPartnerToSapMutation()

  const handleLookup = async () => {
    const code = codeInput.trim()
    if (!code) return
    setLookupLoading(true)
    setLookupResult(null)
    setLookupError(null)
    linkMutation.reset()
    try {
      const result = await lookupSapBp(code)
      setLookupResult(result)
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : "SAP lookup failed")
    } finally {
      setLookupLoading(false)
    }
  }

  const handleConnect = () => {
    if (!lookupResult) return
    linkMutation.mutate({ id: bpId, cardCode: lookupResult.CardCode })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-5" />
          {t("businessPartners.linkSapTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">{t("businessPartners.linkSapDesc")}</p>

        <div className="flex items-center gap-2">
          <Input
            placeholder={t("businessPartners.sapCardCodePlaceholder")}
            className="max-w-[240px]"
            value={codeInput}
            onChange={(e) => {
              setCodeInput(e.target.value)
              setLookupResult(null)
              setLookupError(null)
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleLookup() } }}
          />
          <Button type="button" variant="outline" onClick={handleLookup} disabled={lookupLoading || !codeInput.trim()}>
            {lookupLoading ? <Loader2 className="size-4 animate-spin" /> : t("businessPartners.checkSap")}
          </Button>
        </div>

        {lookupError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircle className="size-4 shrink-0" />
            <span>{lookupError}</span>
          </div>
        ) : null}

        {lookupResult ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              {t("businessPartners.sapCustomerFound")}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t("common.name")}</span><span>{lookupResult.CardName}</span>
              <span className="font-medium text-foreground">{t("businessPartners.cardCode")}</span><span>{lookupResult.CardCode}</span>
              {lookupResult.Phone1 ? (
                <>
                  <span className="font-medium text-foreground">{t("businessPartners.phone")}</span><span>{lookupResult.Phone1}</span>
                </>
              ) : null}
              {lookupResult.EMail ? (
                <>
                  <span className="font-medium text-foreground">{t("common.email")}</span><span>{lookupResult.EMail}</span>
                </>
              ) : null}
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("businessPartners.sapNameOverrideNote")}</p>
            <Button type="button" size="sm" onClick={handleConnect} disabled={linkMutation.isPending}>
              {linkMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("businessPartners.linkToThisCustomer")}
            </Button>
            {linkMutation.isError ? (
              <ErrorMessage>
                {linkMutation.error instanceof ApiError && linkMutation.error.i18nKey
                  ? t(linkMutation.error.i18nKey)
                  : linkMutation.error instanceof Error
                    ? linkMutation.error.message
                    : t("businessPartners.failedToLinkSap")}
              </ErrorMessage>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BusinessPartnerDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams({ from: "/_app/business-partners/$id" })
  const navigate = useNavigate()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [customMultiplier, setCustomMultiplier] = useState("")
  const [showCustomMultiplierInput, setShowCustomMultiplierInput] = useState(false)
  const multiplierMutation = useUpdateBusinessPartnerMultiplierMutation()

  const MULTIPLIER_PRESETS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]

  const handleMultiplierChange = (value: string) => {
    if (!id) return
    if (value === "custom") {
      setShowCustomMultiplierInput(true)
      return
    }
    setShowCustomMultiplierInput(false)
    multiplierMutation.mutate({ id, priceMultiplier: Number(value) })
  }

  const handleCustomMultiplierSubmit = () => {
    if (!id) return
    const val = parseFloat(customMultiplier)
    if (Number.isFinite(val) && val >= 1.0 && val <= 10.0) {
      multiplierMutation.mutate({ id, priceMultiplier: val })
      setShowCustomMultiplierInput(false)
      setCustomMultiplier("")
    }
  }

  const {
    data: bp,
    isLoading: bpLoading,
    isError: bpError,
    error: bpErrorObj,
  } = useBusinessPartnerQuery(id ?? null)

  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErrorObj,
  } = useBusinessPartnerUsersQuery(id ?? null)

  const merchants = useMemo(
    () => (users ?? []).filter((u) => u.role === USER_ROLES.MERCHANT),
    [users],
  )

  return (
    <div className="grid gap-6">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate({ to: ROUTES.BUSINESS_PARTNERS })}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">{bpLoading ? t("common.loading") : bp?.name ?? t("common.businessPartner")}</h1>
          <p className="text-sm text-muted-foreground">
            {bp?.email ?? ""}
          </p>
        </div>
      </div>

      {/* BP Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("businessPartners.details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={bpLoading}
            isError={bpError}
            error={bpErrorObj}
            entityName="business partner"
            isEmpty={!bp}
            emptyMessage={t("businessPartners.notFound")}
          >
            {bp ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div>
                  <p className="text-xs text-muted-foreground">{t("businessPartners.cardCode")}</p>
                  <p className="text-sm font-medium">{bp.cardCode ?? t("common.noData")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("businessPartners.cardName")}</p>
                  <p className="text-sm font-medium">{bp.cardName ?? t("common.noData")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("businessPartners.sapSync")}</p>
                  <Badge variant={bp.cardCode ? "default" : "secondary"}>
                    {bp.cardCode
                      ? (bp.sapSyncStatus === "manually_linked" ? t("businessPartners.manuallyLinked") : t("common.synced"))
                      : t("businessPartners.notLinked")}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("common.status")}</p>
                  <Badge variant={bp.isActive ? "default" : "destructive"}>
                    {bp.isActive ? t("common.active") : t("common.inactive")}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t("businessPartners.created")}</p>
                  <p className="text-sm font-medium">{formatDate(bp.createdAt)}</p>
                </div>
                <div className="col-span-2 sm:col-span-5">
                  <p className="text-xs text-muted-foreground mb-1">Price Multiplier</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={
                        MULTIPLIER_PRESETS.includes(bp.priceMultiplier)
                          ? String(bp.priceMultiplier)
                          : "custom"
                      }
                      onValueChange={handleMultiplierChange}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Select multiplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {MULTIPLIER_PRESETS.map((preset) => (
                          <SelectItem key={preset} value={String(preset)}>
                            {preset}x
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {(showCustomMultiplierInput || !MULTIPLIER_PRESETS.includes(bp.priceMultiplier)) && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="1"
                          max="10"
                          placeholder="1.0 - 10.0"
                          className="w-[120px]"
                          value={customMultiplier || (!MULTIPLIER_PRESETS.includes(bp.priceMultiplier) ? String(bp.priceMultiplier) : "")}
                          onChange={(e) => setCustomMultiplier(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleCustomMultiplierSubmit() }}
                        />
                        <Button size="sm" onClick={handleCustomMultiplierSubmit} disabled={multiplierMutation.isPending}>
                          {multiplierMutation.isPending ? "..." : "Apply"}
                        </Button>
                      </div>
                    )}
                    {!showCustomMultiplierInput && MULTIPLIER_PRESETS.includes(bp.priceMultiplier) && (
                      <p className="text-sm text-muted-foreground">
                        Current: <span className="font-medium text-foreground">{bp.priceMultiplier}x</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </QueryStateWrapper>
        </CardContent>
      </Card>

      {/* Link to SAP Card — only for BPs not yet connected to a SAP customer */}
      {bp && !bp.cardCode && id ? <LinkSapCard bpId={id} /> : null}

      {/* Users Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="size-5" />
            <CardTitle>{t("nav.users")}</CardTitle>
            {users ? (
              <Badge variant="secondary">{users.length}</Badge>
            ) : null}
          </div>
          {id ? (
            <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
              <Plus className="size-4" />
              <span>{t("businessPartners.addUser")}</span>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={usersLoading}
            isError={usersError}
            error={usersErrorObj}
            entityName="users"
            isEmpty={!users || users.length === 0}
            emptyMessage={t("businessPartners.noUsersLinked")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead>{t("common.role")}</TableHead>
                  <TableHead>{t("businessPartners.created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">{u.displayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(u.role)}>{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      {id ? (
        <AddUserDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          bpId={id}
          merchants={merchants}
        />
      ) : null}
    </div>
  )
}
