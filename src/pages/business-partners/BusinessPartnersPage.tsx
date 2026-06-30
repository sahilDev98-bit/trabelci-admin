import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { ArrowRightLeft, CheckCircle2Icon, ChevronDownIcon, ChevronUpIcon, Loader2Icon, MoreVerticalIcon, RefreshCwIcon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { ErrorMessage } from "@/components/ErrorMessage"
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { formatDate } from "@/lib/formatDate"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useBusinessPartnersQuery,
  useCreateBusinessPartnerMutation,
  useUpdateBusinessPartnerMutation,
  useDeleteBusinessPartnerMutation,
  useToggleBusinessPartnerActiveMutation,
  lookupSapBp,
} from "@/features/businessPartners/api"
import type { BusinessPartner, CreateBusinessPartnerInput, SapBpLookupResult } from "@/features/businessPartners/types"
import { BusinessPartnerSapSyncModal } from "./components/BusinessPartnerSapSyncModal"

type FormValues = CreateBusinessPartnerInput

type EditFormValues = {
  name: string
  email: string
  skuDefaultCountry: string
  skuDefaultDisplayNameEn: string
  skuDefaultSupplierSku: string
}

export function BusinessPartnersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const createForm = useForm<FormValues>({
    defaultValues: { name: "", email: "" },
  })

  const editForm = useForm<EditFormValues>({
    defaultValues: { name: "", email: "", skuDefaultCountry: "", skuDefaultDisplayNameEn: "", skuDefaultSupplierSku: "" },
  })

  const { data, isLoading, isError, error, refetch, isFetching } = useBusinessPartnersQuery()
  const createMutation = useCreateBusinessPartnerMutation()
  const updateMutation = useUpdateBusinessPartnerMutation()
  const deleteMutation = useDeleteBusinessPartnerMutation()
  const toggleActiveMutation = useToggleBusinessPartnerActiveMutation()

  const [editTarget, setEditTarget] = useState<BusinessPartner | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BusinessPartner | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [sapSyncModalOpen, setSapSyncModalOpen] = useState(false)

  // SAP link state
  const [sapSectionOpen, setSapSectionOpen] = useState(false)
  const [sapCodeInput, setSapCodeInput] = useState("")
  const [sapLookupLoading, setSapLookupLoading] = useState(false)
  const [sapLookupResult, setSapLookupResult] = useState<SapBpLookupResult | null>(null)
  const [sapLookupError, setSapLookupError] = useState<string | null>(null)
  const [linkedSapBp, setLinkedSapBp] = useState<SapBpLookupResult | null>(null)

  const resetSapState = () => {
    setSapCodeInput("")
    setSapLookupResult(null)
    setSapLookupError(null)
    setLinkedSapBp(null)
    setSapSectionOpen(false)
  }

  const handleSapLookup = async () => {
    const code = sapCodeInput.trim()
    if (!code) return
    setSapLookupLoading(true)
    setSapLookupResult(null)
    setSapLookupError(null)
    try {
      const result = await lookupSapBp(code)
      setSapLookupResult(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "SAP lookup failed"
      setSapLookupError(msg)
    } finally {
      setSapLookupLoading(false)
    }
  }

  const onCreateSubmit = async (values: FormValues) => {
    const payload: CreateBusinessPartnerInput = { name: values.name, email: values.email }
    if (linkedSapBp) {
      payload.card_code = linkedSapBp.CardCode
      payload.card_name = linkedSapBp.CardName
    }
    await createMutation.mutateAsync(payload)
    createForm.reset({ name: "", email: "" })
    resetSapState()
    toast.success(t("businessPartners.bpCreated"))
  }

  const openEdit = (bp: BusinessPartner) => {
    setEditTarget(bp)
    editForm.reset({
      name: bp.name,
      email: bp.email ?? "",
      skuDefaultCountry: bp.skuDefaultCountry ?? "",
      skuDefaultDisplayNameEn: bp.skuDefaultDisplayNameEn ?? "",
      skuDefaultSupplierSku: bp.skuDefaultSupplierSku ?? "",
    })
  }

  const onEditSubmit = async (values: EditFormValues) => {
    if (!editTarget) return
    await updateMutation.mutateAsync({
      id: editTarget.id,
      name: values.name,
      email: values.email,
      sku_default_country: values.skuDefaultCountry.trim() || null,
      sku_default_display_name_en: values.skuDefaultDisplayNameEn.trim() || null,
      sku_default_supplier_sku: values.skuDefaultSupplierSku.trim() || null,
    })
    setEditTarget(null)
    toast.success(t("businessPartners.bpUpdated"))
  }

  const onConfirmDelete = async () => {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.id)
    toast.success(t("businessPartners.bpDeleted"))
    setPendingDelete(null)
  }

  const handleSyncWithSap = () => {
    setSapSyncModalOpen(true)
  }

  const handleToggleActive = async (bp: BusinessPartner) => {
    setTogglingId(bp.id)
    try {
      await toggleActiveMutation.mutateAsync({ id: bp.id, isActive: !bp.isActive })
      toast.success(bp.isActive ? t("businessPartners.deactivated") : t("businessPartners.activated"))
    } catch {
      toast.error(t("businessPartners.failedToToggleStatus"))
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <>
      <div className="grid gap-6">
        {/* Create Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("businessPartners.createTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={createForm.handleSubmit(onCreateSubmit)}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="name" className="mb-2 block">{t("businessPartners.bpName")}</Label>
                  <Input id="name" required autoComplete="organization" {...createForm.register("name")} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="email" className="mb-2 block">{t("common.email")}</Label>
                  <Input id="email" type="email" required autoComplete="email" {...createForm.register("email")} />
                </div>
              </div>

              {/* SAP Link Section */}
              <div className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setSapSectionOpen((v) => !v)}
                >
                  <span>{t("businessPartners.sapLinkTitle")}</span>
                  {sapSectionOpen ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                </button>

                {sapSectionOpen && (
                  <div className="border-t px-4 pb-4 pt-3 flex flex-col gap-3">
                    <p className="text-xs text-muted-foreground">{t("businessPartners.sapLinkHint")}</p>

                    {linkedSapBp ? (
                      <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
                        <CheckCircle2Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">
                          {t("businessPartners.willLinkTo")}: <strong>{linkedSapBp.CardName}</strong> ({linkedSapBp.CardCode})
                        </span>
                        <button
                          type="button"
                          className="text-xs underline"
                          onClick={() => { setLinkedSapBp(null); setSapLookupResult(null) }}
                        >
                          {t("businessPartners.removeLink")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Input
                            placeholder={t("businessPartners.sapCardCodePlaceholder")}
                            value={sapCodeInput}
                            onChange={(e) => { setSapCodeInput(e.target.value); setSapLookupResult(null); setSapLookupError(null) }}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSapLookup() } }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!sapCodeInput.trim() || sapLookupLoading}
                            onClick={handleSapLookup}
                          >
                            {sapLookupLoading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : t("businessPartners.checkSap")}
                          </Button>
                        </div>

                        {sapLookupError && (
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <XCircleIcon className="h-4 w-4 shrink-0" />
                            <span>{sapLookupError}</span>
                          </div>
                        )}

                        {sapLookupResult && (
                          <div className="rounded-md border bg-muted/40 p-3 text-sm flex flex-col gap-2">
                            <div className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
                              <CheckCircle2Icon className="h-4 w-4" />
                              {t("businessPartners.sapCustomerFound")}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{t("common.name")}</span><span>{sapLookupResult.CardName}</span>
                              <span className="font-medium text-foreground">{t("businessPartners.cardCode")}</span><span>{sapLookupResult.CardCode}</span>
                            </div>
                            <p className="text-xs text-amber-600 dark:text-amber-400">{t("businessPartners.sapNameOverrideNote")}</p>
                            <Button type="button" size="sm" onClick={() => setLinkedSapBp(sapLookupResult)}>
                              {t("businessPartners.linkToThisCustomer")}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? t("common.creating") : t("common.create")}
                </Button>
              </div>
            </form>
            {createMutation.isError ? (
              <ErrorMessage className="mt-2">
                {createMutation.error instanceof Error ? createMutation.error.message : t("businessPartners.failedToCreate")}
              </ErrorMessage>
            ) : null}
          </CardContent>
        </Card>

        {/* List Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{t("businessPartners.title")}</CardTitle>
            <div className="flex items-center gap-2">
              <Button onClick={handleSyncWithSap}>
                <ArrowRightLeft className="h-4 w-4" />
                {t("businessPartners.syncWithSap")}
              </Button>
              <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
                <span className="sr-only">{t("common.refresh")}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <QueryStateWrapper
              isLoading={isLoading}
              isError={isError}
              error={error}
              entityName="business partners"
              isEmpty={!data || data.length === 0}
              emptyMessage={t("businessPartners.noPartnersYet")}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("common.email")}</TableHead>
                    <TableHead>{t("businessPartners.cardCode")}</TableHead>
                    <TableHead>{t("businessPartners.sapSync")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("businessPartners.createdAt")}</TableHead>
                    <TableHead className="w-[80px] text-right">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.map((bp) => (
                    <TableRow key={bp.id} className="cursor-pointer" onClick={() => navigate({ to: "/business-partners/$id", params: { id: bp.id } })}>
                      <TableCell className="font-medium">{bp.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{bp.email ?? t("common.noData")}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{bp.cardCode ?? t("common.noData")}</TableCell>
                      <TableCell>
                        <Badge variant={bp.sapSyncStatus === "synced" || bp.sapSyncStatus === "manually_linked" ? "default" : "secondary"}>
                          {bp.sapSyncStatus === "synced" ? t("common.synced") : bp.sapSyncStatus === "manually_linked" ? t("businessPartners.manuallyLinked") : t("common.pending")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bp.isActive ? "default" : "destructive"}>
                          {bp.isActive ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(bp.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("common.actions")}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(bp) }}>
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={togglingId === bp.id}
                              onClick={(e) => { e.stopPropagation(); handleToggleActive(bp) }}
                            >
                              {bp.isActive ? t("common.deactivate") : t("common.activate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => { e.stopPropagation(); setPendingDelete(bp) }}
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
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => { if (!open) setEditTarget(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("businessPartners.editTitle")}</DialogTitle>
            <DialogDescription>{t("businessPartners.editDesc")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={editForm.handleSubmit(onEditSubmit)}>
            <div className="grid gap-1">
              <Label htmlFor="edit-name">{t("businessPartners.bpName")}</Label>
              <Input id="edit-name" required {...editForm.register("name")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-email">{t("common.email")}</Label>
              <Input id="edit-email" type="email" required {...editForm.register("email")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-sku-country">SKU Default Country</Label>
              <Input id="edit-sku-country" placeholder="e.g. Spain" {...editForm.register("skuDefaultCountry")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-sku-display-name">SKU Default Display Name (EN)</Label>
              <Input id="edit-sku-display-name" placeholder="e.g. La Fabrica Tile" {...editForm.register("skuDefaultDisplayNameEn")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-sku-supplier-sku">SKU Default Supplier SKU</Label>
              <Input id="edit-sku-supplier-sku" placeholder="e.g. LF-001" {...editForm.register("skuDefaultSupplierSku")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title={t("businessPartners.deleteTitle")}
        description={
          <>
            {t("businessPartners.deleteDesc")}{" "}
            <span className="font-medium text-foreground">
              {pendingDelete?.name}
            </span>
          </>
        }
        onConfirm={onConfirmDelete}
        isPending={deleteMutation.isPending}
      />

      {/* Sync with SAP Modal */}
      <BusinessPartnerSapSyncModal
        open={sapSyncModalOpen}
        onClose={() => setSapSyncModalOpen(false)}
      />
    </>
  )
}
