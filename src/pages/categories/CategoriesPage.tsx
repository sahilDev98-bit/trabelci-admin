import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, GripVerticalIcon, ImagePlusIcon, ImageUpIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog"
import { ErrorMessage } from "@/components/ErrorMessage"
import { QueryStateWrapper } from "@/components/QueryStateWrapper"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  useCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useDeleteCategoryIconMutation,
  useReorderCategoriesMutation,
  useToggleCategoryVisibilityMutation,
  useUpdateCategoryIconMutation,
} from "@/features/categories/api"
import { toast } from "sonner"
import type { Category } from "@/features/categories/types"

type IconFormValues = { file: FileList }
type CategoryFormValues = { name: string; sapId: string }

export function CategoriesPage() {
  const { t } = useTranslation()
  const { data, isLoading, isError, error } = useCategoriesQuery()
  const updateIconMutation = useUpdateCategoryIconMutation()
  const deleteIconMutation = useDeleteCategoryIconMutation()
  const reorderMutation = useReorderCategoriesMutation()
  const toggleVisibilityMutation = useToggleCategoryVisibilityMutation()
  const createCategoryMutation = useCreateCategoryMutation()
  const updateCategoryMutation = useUpdateCategoryMutation()
  const deleteCategoryMutation = useDeleteCategoryMutation()

  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<Category | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Create / Edit dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<Category | null>(null)

  // Sort state
  const [productCountSort, setProductCountSort] = useState<"asc" | "desc" | null>(null)

  // Drag-and-drop state
  const [localOrder, setLocalOrder] = useState<Category[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Sync local order when server data changes
  useEffect(() => {
    if (data) {
      setLocalOrder([...data])
    }
  }, [data])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  const isSearching = query.trim().length > 0

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q
      ? localOrder.filter((c) => c.name.toLowerCase().includes(q))
      : [...localOrder]
    if (productCountSort) {
      const dir = productCountSort === "asc" ? 1 : -1
      list = [...list].sort((a, b) => (a.productCount - b.productCount) * dir)
    }
    return list
  }, [localOrder, query, productCountSort])

  const iconForm = useForm<IconFormValues>()
  const fileField = iconForm.register("file")

  const categoryForm = useForm<CategoryFormValues>({ defaultValues: { name: "", sapId: "" } })

  // Reset form when opening create dialog
  useEffect(() => {
    if (createDialogOpen) {
      categoryForm.reset({ name: "", sapId: "" })
    }
  }, [createDialogOpen, categoryForm])

  // Reset form when opening edit dialog
  useEffect(() => {
    if (editingCategory) {
      categoryForm.reset({ name: editingCategory.name, sapId: editingCategory.sapId })
    }
  }, [editingCategory, categoryForm])

  const onIconSubmit = async (values: IconFormValues) => {
    if (!activeCategory) return
    const file = values.file?.item(0)
    if (!file) return
    await updateIconMutation.mutateAsync({
      sapId: activeCategory.sapId,
      hasIcon: Boolean(activeCategory.iconUrl),
      file,
    })
    setActiveCategory(null)
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setPreviewUrl(null)
    iconForm.reset()
    toast.success(t("categories.iconUpdated"), {
      description: t("categories.iconUpdatedDesc", { name: activeCategory.name }),
    })
  }

  const onCreateSubmit = async (values: CategoryFormValues) => {
    try {
      await createCategoryMutation.mutateAsync({ name: values.name.trim(), sapId: values.sapId.trim() })
      toast.success(t("categories.categoryCreated"), {
        description: t("categories.categoryCreatedDesc", { name: values.name.trim() }),
      })
      setCreateDialogOpen(false)
      categoryForm.reset()
    } catch {
      toast.error(t("categories.createCategory"))
    }
  }

  const onEditSubmit = async (values: CategoryFormValues) => {
    if (!editingCategory) return
    try {
      await updateCategoryMutation.mutateAsync({ sapId: editingCategory.sapId, name: values.name.trim() })
      toast.success(t("categories.categoryUpdated"), {
        description: t("categories.categoryUpdatedDesc", { name: values.name.trim() }),
      })
      setEditingCategory(null)
      categoryForm.reset()
    } catch {
      toast.error(t("categories.editCategory"))
    }
  }

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback(async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }

    const newOrder = [...localOrder]
    const [moved] = newOrder.splice(dragIndex, 1)
    newOrder.splice(targetIndex, 0, moved)
    setLocalOrder(newOrder)
    setDragIndex(null)
    setDragOverIndex(null)

    const orderedSapIds = newOrder.map((c) => c.sapId)
    try {
      await reorderMutation.mutateAsync(orderedSapIds)
      toast.success("Order saved")
    } catch {
      toast.error("Failed to save order")
    }
  }, [dragIndex, localOrder, reorderMutation])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("categories.title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("categories.description")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-full max-w-sm">
              <Input
                placeholder={t("categories.searchPlaceholder")}
                aria-label={t("categories.searchCategories")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              {t("categories.addCategory")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <QueryStateWrapper
            isLoading={isLoading}
            isError={isError}
            error={error}
            entityName="categories"
            isEmpty={filtered.length === 0}
            emptyMessage={t("categories.noMatch")}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {!isSearching && <TableHead className="w-[48px]" />}
                  <TableHead className="w-[72px]">{t("categories.icon")}</TableHead>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead className="w-[100px]">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mx-auto flex items-center gap-1"
                      onClick={() =>
                        setProductCountSort((prev) =>
                          prev === null ? "asc" : prev === "asc" ? "desc" : null,
                        )
                      }
                    >
                      {t("categories.productCount")}
                      {productCountSort === "asc" ? (
                        <ArrowUpIcon className="size-3" />
                      ) : productCountSort === "desc" ? (
                        <ArrowDownIcon className="size-3" />
                      ) : (
                        <ArrowUpDownIcon className="size-3 text-muted-foreground" />
                      )}
                    </Button>
                  </TableHead>
                  <TableHead className="w-[180px] text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c, index) => (
                  <TableRow
                    key={c.sapId}
                    draggable={!isSearching}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      !isSearching && "cursor-grab active:cursor-grabbing",
                      dragIndex === index && "opacity-50",
                      dragOverIndex === index && dragIndex !== index && "border-t-2 border-t-primary",
                      c.isHidden && "opacity-50",
                    )}
                  >
                    {!isSearching && (
                      <TableCell className="w-[48px] px-2">
                        <GripVerticalIcon className="size-4 text-muted-foreground" />
                      </TableCell>
                    )}
                    <TableCell>
                      {c.iconUrl ? (
                        <button
                          type="button"
                          className="block"
                          onClick={() => setPreviewUrl(c.iconUrl!)}
                        >
                          <img
                            src={c.iconUrl}
                            alt={`${c.name} icon`}
                            className="size-10 rounded-md border border-border object-cover"
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <div className="grid size-10 place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
                          —
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-center text-muted-foreground">{c.productCount}</TableCell>
                    <TableCell className="text-right">
                      <TooltipProvider delayDuration={300}>
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={togglingId === c.sapId}
                                onClick={async () => {
                                  setTogglingId(c.sapId)
                                  try {
                                    await toggleVisibilityMutation.mutateAsync({
                                      sapId: c.sapId,
                                      isHidden: !c.isHidden,
                                    })
                                    toast.success(c.isHidden ? "Category shown" : "Category hidden", {
                                      description: `"${c.name}" is now ${c.isHidden ? "visible" : "hidden"} in the mobile app.`,
                                    })
                                  } catch {
                                    toast.error("Failed to update visibility")
                                  } finally {
                                    setTogglingId(null)
                                  }
                                }}
                              >
                                {c.isHidden ? (
                                  <EyeOffIcon className="size-4 text-muted-foreground" />
                                ) : (
                                  <EyeIcon className="size-4 text-green-600" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {c.isHidden ? t("categories.showInApp") : t("categories.hideFromApp")}
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingCategory(c)}
                              >
                                <PencilIcon className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("categories.editCategory")}
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setActiveCategory(c)
                                  setPreviewUrl(null)
                                  iconForm.reset()
                                }}
                              >
                                {c.iconUrl ? (
                                  <ImageUpIcon className="size-4" />
                                ) : (
                                  <ImagePlusIcon className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {c.iconUrl ? t("categories.replaceIcon") : t("categories.uploadIcon")}
                            </TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setPendingDeleteCategory(c)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2Icon className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("categories.deleteCategory")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryStateWrapper>
        </CardContent>
      </Card>

      {/* Create Category Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("categories.createCategory")}</DialogTitle>
            <DialogDescription>{t("categories.description")}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={categoryForm.handleSubmit(onCreateSubmit)}>
            <div className="grid gap-2">
              <Label htmlFor="create-name">{t("categories.categoryName")}</Label>
              <Input
                id="create-name"
                placeholder={t("categories.categoryName")}
                {...categoryForm.register("name", { required: true })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-sapId">{t("categories.sapId")}</Label>
              <Input
                id="create-sapId"
                placeholder={t("categories.sapId")}
                {...categoryForm.register("sapId", { required: true })}
              />
              <p className="text-xs text-muted-foreground">{t("categories.sapIdHint")}</p>
            </div>
            {createCategoryMutation.isError ? (
              <ErrorMessage>
                {createCategoryMutation.error instanceof Error ? createCategoryMutation.error.message : t("categories.createCategory")}
              </ErrorMessage>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={createCategoryMutation.isPending}>
                {createCategoryMutation.isPending ? t("categories.creating") : t("categories.createCategory")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog
        open={Boolean(editingCategory)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCategory(null)
            categoryForm.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("categories.editCategory")}</DialogTitle>
            <DialogDescription>{editingCategory?.sapId}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={categoryForm.handleSubmit(onEditSubmit)}>
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t("categories.categoryName")}</Label>
              <Input
                id="edit-name"
                placeholder={t("categories.categoryName")}
                {...categoryForm.register("name", { required: true })}
              />
            </div>
            {updateCategoryMutation.isError ? (
              <ErrorMessage>
                {updateCategoryMutation.error instanceof Error ? updateCategoryMutation.error.message : t("categories.editCategory")}
              </ErrorMessage>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingCategory(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={updateCategoryMutation.isPending}>
                {updateCategoryMutation.isPending ? t("categories.updating") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Upload Icon Dialog */}
      <Dialog
        open={Boolean(activeCategory)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveCategory(null)
            setPreviewUrl(null)
            iconForm.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeCategory?.iconUrl ? t("categories.replaceIcon") : t("categories.uploadIcon")}</DialogTitle>
            <DialogDescription>{activeCategory?.name}</DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={iconForm.handleSubmit(onIconSubmit)}>
            <div className="grid gap-2">
              <Label htmlFor="icon">{t("categories.iconImage")}</Label>
              <Input
                id="icon"
                type="file"
                accept="image/*"
                {...fileField}
                onChange={(e) => {
                  fileField.onChange(e)
                  const file = e.target.files?.item(0)
                  if (!file) return
                  if (objectUrlRef.current) {
                    URL.revokeObjectURL(objectUrlRef.current)
                  }
                  const url = URL.createObjectURL(file)
                  objectUrlRef.current = url
                  setPreviewUrl(url)
                }}
              />
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={t("categories.iconPreview")}
                  className="h-32 w-32 rounded-md border object-cover"
                />
              ) : activeCategory?.iconUrl ? (
                <img
                  src={activeCategory.iconUrl}
                  alt={t("categories.currentIcon")}
                  className="h-32 w-32 rounded-md border object-cover"
                />
              ) : null}
            </div>

            {updateIconMutation.isError ? (
              <ErrorMessage>
                {updateIconMutation.error instanceof Error ? updateIconMutation.error.message : t("categories.failedToUpdateIcon")}
              </ErrorMessage>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setActiveCategory(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={updateIconMutation.isPending}>
                {updateIconMutation.isPending ? t("categories.uploading") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Icon Preview Dialog */}
      <Dialog
        open={Boolean(previewUrl && !activeCategory)}
        onOpenChange={(open) => {
          if (!open) setPreviewUrl(null)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("categories.iconPreview")}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <div className="grid place-items-center">
              <img src={previewUrl} alt={t("categories.categoryIcon")} className="max-h-[70vh] rounded-lg border object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Icon Confirm Dialog */}
      <ConfirmDeleteDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t("categories.deleteIconTitle")}
        description={
          <>
            {t("categories.deleteIconDesc").split("<strong>")[0]}
            <span className="font-medium text-foreground">{pendingDelete?.name}</span>
            {"."}
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return
          await deleteIconMutation.mutateAsync(pendingDelete.sapId)
          toast.success(t("categories.iconDeleted"), {
            description: t("categories.iconDeletedDesc", { name: pendingDelete.name }),
          })
          setPendingDelete(null)
        }}
        isPending={deleteIconMutation.isPending}
      />

      {/* Delete Category Confirm Dialog */}
      <ConfirmDeleteDialog
        open={Boolean(pendingDeleteCategory)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteCategory(null)
        }}
        title={t("categories.deleteCategoryTitle")}
        description={
          <>
            {t("categories.deleteCategoryDesc").split("<strong>")[0]}
            <span className="font-medium text-foreground">{pendingDeleteCategory?.name}</span>
            {". "}
            {t("categories.deleteCategoryDesc").split("</strong>")[1] ?? ""}
          </>
        }
        onConfirm={async () => {
          if (!pendingDeleteCategory) return
          try {
            await deleteCategoryMutation.mutateAsync(pendingDeleteCategory.sapId)
            toast.success(t("categories.categoryDeleted"), {
              description: t("categories.categoryDeletedDesc", { name: pendingDeleteCategory.name }),
            })
          } catch {
            toast.error(t("categories.deleteCategory"))
          }
          setPendingDeleteCategory(null)
        }}
        isPending={deleteCategoryMutation.isPending}
      />
    </>
  )
}
