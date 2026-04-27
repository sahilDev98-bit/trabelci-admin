import { useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { Plus, Trash2 } from "lucide-react"

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { ErrorMessage } from "@/components/ErrorMessage"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useProductGroupsQuery,
  useCreateProductGroupMutation,
  useDeleteProductGroupMutation,
} from "@/features/productGroups/api"
import type { ProductGroup } from "@/features/productGroups/types"
import { toast } from "sonner"

// ---------- Types ----------

type GroupFormValues = {
  name: string
}

// ---------- Helpers ----------

const filterGroups = (groups: ProductGroup[] | undefined, query: string): ProductGroup[] => {
  const list = groups ?? []
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((g) => g.name.toLowerCase().includes(q))
}

// ---------- Create Dialog ----------

function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const createMutation = useCreateProductGroupMutation()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<GroupFormValues>({
    defaultValues: { name: "" },
  })

  const resetAndClose = () => {
    form.reset({ name: "" })
    setSubmitError(null)
    onOpenChange(false)
  }

  const handleSubmit = async (values: GroupFormValues) => {
    setSubmitError(null)
    const trimmedName = values.name.trim()
    if (!trimmedName) {
      setSubmitError(t("productGroups.nameRequired"))
      return
    }

    try {
      await createMutation.mutateAsync({ name: trimmedName })
      toast.success(t("productGroups.groupCreated"), {
        description: t("productGroups.groupCreatedDesc", { name: trimmedName }),
      })
      resetAndClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("productGroups.failedToCreateGroup"))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetAndClose()
        else onOpenChange(true)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("productGroups.createGroup")}</DialogTitle>
          <DialogDescription>{t("productGroups.createGroupDesc")}</DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="grid gap-1">
            <Label htmlFor="group-name">{t("common.name")}</Label>
            <Input
              id="group-name"
              autoFocus
              placeholder={t("productGroups.enterGroupName")}
              {...form.register("name", { required: true })}
            />
          </div>

          {submitError ? <ErrorMessage>{submitError}</ErrorMessage> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? t("common.creating") : t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Main Page ----------

export function ProductGroupsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useProductGroupsQuery()
  const deleteMutation = useDeleteProductGroupMutation()

  const [query, setQuery] = useState("")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProductGroup | null>(null)

  const filtered = useMemo(() => filterGroups(data, query), [data, query])

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("productGroups.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("productGroups.description")}
            </p>
          </div>
          <div className="flex w-full max-w-md items-center gap-2">
            <Input
              placeholder={t("productGroups.searchPlaceholder")}
              aria-label={t("productGroups.searchProductGroups")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="button" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="me-1.5 size-4" />
              {t("productGroups.createGroup")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="product groups"
            isEmpty={filtered.length === 0}
            emptyMessage={t("productGroups.noGroupsFound")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("productGroups.productCount")}</TableHead>
                  <TableHead className="w-[100px] text-end">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((g) => (
                  <TableRow
                    key={g.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: "/product-groups/$id", params: { id: g.id } })}
                  >
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{g.productCount ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("common.delete")}
                        onClick={(e) => { e.stopPropagation(); setPendingDelete(g) }}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
        </CardContent>
      </Card>

      <CreateGroupDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t("productGroups.deleteGroup")}
        description={
          <>
            {t("productGroups.deleteGroupDesc").split("<strong>")[0]}
            <span className="font-medium text-foreground">{pendingDelete?.name}</span>
            {t("productGroups.deleteGroupDesc").split("</strong>")[1]}
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteMutation.mutateAsync(pendingDelete.id)
          toast.success(t("productGroups.groupDeleted"), {
            description: t("productGroups.groupDeletedDesc", { name: pendingDelete.name }),
          })
          setPendingDelete(null)
        }}
        isPending={deleteMutation.isPending}
      />
    </>
  )
}
