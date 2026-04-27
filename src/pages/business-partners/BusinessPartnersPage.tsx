import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { useForm } from "react-hook-form"
import { MoreVerticalIcon, RefreshCwIcon } from "lucide-react"
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
} from "@/features/businessPartners/api"
import type { BusinessPartner, CreateBusinessPartnerInput } from "@/features/businessPartners/types"

type FormValues = CreateBusinessPartnerInput

export function BusinessPartnersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const createForm = useForm<FormValues>({
    defaultValues: { name: "", email: "" },
  })

  const editForm = useForm<FormValues>({
    defaultValues: { name: "", email: "" },
  })

  const { data, isLoading, isError, error, refetch, isFetching } = useBusinessPartnersQuery()
  const createMutation = useCreateBusinessPartnerMutation()
  const updateMutation = useUpdateBusinessPartnerMutation()
  const deleteMutation = useDeleteBusinessPartnerMutation()
  const toggleActiveMutation = useToggleBusinessPartnerActiveMutation()

  const [editTarget, setEditTarget] = useState<BusinessPartner | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BusinessPartner | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const onCreateSubmit = async (values: FormValues) => {
    await createMutation.mutateAsync({ name: values.name, email: values.email })
    createForm.reset({ name: "", email: "" })
    toast.success(t("businessPartners.bpCreated"))
  }

  const openEdit = (bp: BusinessPartner) => {
    setEditTarget(bp)
    editForm.reset({ name: bp.name, email: bp.email ?? "" })
  }

  const onEditSubmit = async (values: FormValues) => {
    if (!editTarget) return
    await updateMutation.mutateAsync({ id: editTarget.id, name: values.name, email: values.email })
    setEditTarget(null)
    toast.success(t("businessPartners.bpUpdated"))
  }

  const onConfirmDelete = async () => {
    if (!pendingDelete) return
    await deleteMutation.mutateAsync(pendingDelete.id)
    toast.success(t("businessPartners.bpDeleted"))
    setPendingDelete(null)
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
            <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={createForm.handleSubmit(onCreateSubmit)}>
              <div className="flex-1">
                <Label htmlFor="name" className="mb-4">{t("businessPartners.bpName")}</Label>
                <Input id="name" required autoComplete="organization" {...createForm.register("name")} />
              </div>
              <div className="flex-1">
                <Label htmlFor="email" className="mb-4">{t("common.email")}</Label>
                <Input id="email" type="email" required autoComplete="email" {...createForm.register("email")} />
              </div>
              <div className="flex gap-2">
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
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
              <span className="sr-only">{t("common.refresh")}</span>
            </Button>
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
                        <Badge variant={bp.sapSyncStatus === "synced" ? "default" : "secondary"}>
                          {bp.sapSyncStatus === "synced" ? t("common.synced") : t("common.pending")}
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
    </>
  )
}
